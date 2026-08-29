import "@tanstack/react-start/server-only";

import { createProviderClient } from "@/lib/translation/provider-client";
import { generateJsonCompletion } from "@/lib/translation/json-completion";
import { retryTranslationOperation } from "@/lib/translation/retry";
import { normalizePair } from "@/lib/translation/prompts";
import { canRunJob, isNextChunk } from "@/lib/translation/job-state";
import {
  applyRelationshipAnalysis,
  loadApprovedTermsForContext,
  loadJobChunk,
  loadPrevChapterForContext,
} from "@/lib/translation/job-store";
import type { RelationshipPromptContext, RelationshipActivePairInput } from "./map";
import {
  buildRelationshipPromptContext,
  emptyRelationshipMap,
  mergeAutomaticRelationshipAnalysis,
  parseRelationshipMap,
} from "./map";
import {
  buildRelationshipAnalysisPrompt,
  buildRelationshipAnalysisUserMessage,
  parseRelationshipAnalysis,
} from "./analysis-prompt";
import { MAX_RELATIONSHIP_PROMPT_ITEMS, normalizeIdentity } from "./schemas";
import type { AIProviderClient } from "@/lib/translation/translation.types";
import type {
  ApprovedCharacterMapping,
  RelationshipAnalysis,
  RelationshipAnalysisCharacter,
  RelationshipAnalysisRelationship,
  RelationshipMapV1,
} from "./schemas";

interface ResolvedIdentity {
  sourceName: string;
  id: string;
}

export interface ChunkRelationshipAnalysis {
  context: RelationshipPromptContext | null;
  warning: string | null;
  promptTokens: number;
  completionTokens: number;
}

export async function analyzeChunkRelationships(
  jobId: string,
  chunkIndex: number,
  generation: number,
): Promise<ChunkRelationshipAnalysis> {
  const row = await loadJobChunk(jobId, chunkIndex);
  if (!row || !row.chunk) return emptyResult("Relationship analysis skipped: chunk not found.");

  const pair = normalizePair(`${row.novel.sourceLang}->${row.novel.targetLang}`);
  if (pair !== "zh->th") return emptyResult(null);
  if (
    row.job.status !== "running" ||
    !canRunJob(row.job, row.chapter, generation) ||
    !isNextChunk(row.job, chunkIndex)
  ) {
    return emptyResult("Relationship analysis skipped: job is no longer runnable.");
  }

  const [terms, previousChapter] = await Promise.all([
    loadApprovedTermsForContext(row.novel.id),
    loadPrevChapterForContext(row.novel.id, row.chapter.number),
  ]);
  const approvedMappings: ApprovedCharacterMapping[] = terms
    .filter((term) => term.category === "character")
    .map((term) => ({ source: term.source, target: term.target }));
  const storedMap = parseRelationshipMap(row.novel.relationshipMapJson);
  const baseMap = storedMap ?? emptyRelationshipMap();
  const sourceTail =
    chunkIndex > 0
      ? row.previousChunk?.sourceText.slice(-(row.novel.contextTailLength || 500)) || null
      : previousChapter?.rawContent?.slice(-(row.novel.contextTailLength || 500)) || null;
  const invalidMapWarning =
    row.novel.relationshipMapJson && !storedMap
      ? "Stored relationship map is invalid; automatic facts were not written."
      : null;

  let providerConfig: AIProviderClient;
  try {
    providerConfig = await retryTranslationOperation(() => createProviderClient(row.novel.userId));
  } catch (error) {
    return {
      context: buildFallbackContext(storedMap, row.chunk.sourceText),
      warning: joinWarnings(
        invalidMapWarning,
        `Relationship analysis unavailable: ${error instanceof Error ? error.message : "provider error"}.`,
      ),
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  const sourceAnalysis = await analyzeRelationshipSourceChunk({
    pair,
    providerConfig,
    existingMap: baseMap,
    approvedMappings,
    storySummary: row.novel.storySummary ?? previousChapter?.summary ?? null,
    previousSourceTail: sourceTail,
    currentChunk: row.chunk.sourceText,
    chapterNumber: row.chapter.number,
  });

  let context = sourceAnalysis.context;
  const warnings = [invalidMapWarning, sourceAnalysis.warning];
  if (sourceAnalysis.analysis && storedMap) {
    const applied = await applyRelationshipAnalysis(
      jobId,
      generation,
      chunkIndex,
      sourceAnalysis.analysis,
    );
    context =
      buildSceneContext(
        applied.map ?? sourceAnalysis.map,
        sourceAnalysis.analysis,
        row.chunk.sourceText,
      ) ?? context;
    warnings.push(...applied.warnings);
  }
  return {
    context,
    warning: joinWarnings(...warnings),
    promptTokens: sourceAnalysis.promptTokens,
    completionTokens: sourceAnalysis.completionTokens,
  };
}

export interface RelationshipSourceAnalysisOptions {
  pair: string;
  providerConfig: AIProviderClient;
  existingMap: RelationshipMapV1;
  approvedMappings: readonly ApprovedCharacterMapping[];
  storySummary?: string | null;
  previousSourceTail?: string | null;
  currentChunk: string;
  chapterNumber: number | string | null;
}

export interface RelationshipSourceAnalysis extends ChunkRelationshipAnalysis {
  map: RelationshipMapV1;
  analysis: RelationshipAnalysis | null;
}

export async function analyzeRelationshipSourceChunk(
  options: RelationshipSourceAnalysisOptions,
): Promise<RelationshipSourceAnalysis> {
  const fallback = buildFallbackContext(options.existingMap, options.currentChunk);
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const prompt = buildRelationshipAnalysisPrompt({
      pair: options.pair,
      existingMap: options.existingMap,
      approvedMappings: options.approvedMappings,
      storySummary: options.storySummary,
      previousSourceTail: options.previousSourceTail,
      currentChunk: options.currentChunk,
    });
    const userMessage = buildRelationshipAnalysisUserMessage({
      previousSourceTail: options.previousSourceTail,
      currentChunk: options.currentChunk,
    });
    const analysis = await retryTranslationOperation(async () => {
      const completion = await generateJsonCompletion(options.providerConfig, 0.1, [
        { role: "system", content: prompt },
        { role: "user", content: userMessage },
      ]);
      promptTokens += completion.promptTokens;
      completionTokens += completion.completionTokens;

      const parsed = parseRelationshipAnalysis(completion.content);
      if (!parsed) throw new Error("Relationship analysis returned invalid JSON");
      return parsed;
    });

    const validated = validateAnalysis(
      analysis,
      options.currentChunk,
      options.existingMap,
      options.approvedMappings,
    );
    const merged = mergeAutomaticRelationshipAnalysis(
      options.existingMap,
      validated,
      options.approvedMappings,
      options.chapterNumber,
      new Date().toISOString(),
    );
    const context = buildSceneContext(merged.map, validated, options.currentChunk);
    return {
      map: merged.map,
      analysis: validated,
      context: context ?? fallback,
      warning: joinWarnings(...merged.warnings),
      promptTokens,
      completionTokens,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "analysis error";
    return {
      map: options.existingMap,
      analysis: null,
      context: fallback,
      warning:
        message === "Relationship analysis returned invalid JSON"
          ? "Relationship analysis returned invalid JSON."
          : `Relationship analysis failed: ${message}.`,
      promptTokens,
      completionTokens,
    };
  }
}

function validateAnalysis(
  analysis: RelationshipAnalysis,
  currentChunk: string,
  map: RelationshipMapV1 | null,
  approvedMappings: readonly ApprovedCharacterMapping[],
): RelationshipAnalysis {
  const knownCharacters = map?.characters ?? [];
  const glossaryNames = new Set(
    approvedMappings.map((mapping) => normalizeIdentity(mapping.source)),
  );
  const identities = new Map<string, ResolvedIdentity>();
  for (const character of knownCharacters) {
    const resolved = { sourceName: character.sourceName, id: character.id };
    identities.set(normalizeIdentity(character.sourceName), resolved);
    for (const alias of character.aliases) identities.set(normalizeIdentity(alias), resolved);
  }

  const characters: RelationshipAnalysisCharacter[] = [];
  const acceptedNames = new Set<string>();
  for (const character of analysis.characters) {
    const sourceName = character.sourceName.trim();
    const normalizedName = normalizeIdentity(sourceName);
    const known = identities.get(normalizedName);
    const nameAllowed =
      currentChunk.includes(sourceName) || Boolean(known) || glossaryNames.has(normalizedName);
    const evidenceAllowed = currentChunk.includes(character.evidence);
    if (!nameAllowed || !evidenceAllowed || acceptedNames.has(normalizedName)) continue;

    const aliases = character.aliases.filter((alias) => {
      const normalized = normalizeIdentity(alias);
      return (
        normalized !== normalizedName &&
        (currentChunk.includes(alias) ||
          Boolean(identities.get(normalized)) ||
          glossaryNames.has(normalized))
      );
    });
    characters.push({ ...character, sourceName, aliases });
    acceptedNames.add(normalizedName);
    const resolved = known ?? { sourceName, id: `analysis:${normalizedName}` };
    identities.set(normalizedName, resolved);
    for (const alias of aliases) identities.set(normalizeIdentity(alias), resolved);
  }

  const resolveIdentity = (value: string): ResolvedIdentity | null => {
    return identities.get(normalizeIdentity(value)) ?? null;
  };
  const relationships: RelationshipAnalysisRelationship[] = [];
  const acceptedPairs = new Set<string>();
  for (const relationship of analysis.relationships) {
    const speaker = resolveIdentity(relationship.speaker);
    const listener = resolveIdentity(relationship.listener);
    if (!speaker || !listener || speaker.id === listener.id) continue;
    if (!currentChunk.includes(relationship.evidence)) continue;
    const pair = `${speaker.id}\u0000${listener.id}`;
    if (acceptedPairs.has(pair)) continue;
    relationships.push({
      ...relationship,
      speaker: speaker.sourceName,
      listener: listener.sourceName,
    });
    acceptedPairs.add(pair);
  }

  const activePairs: RelationshipAnalysis["activePairs"] = [];
  const acceptedActivePairs = new Set<string>();
  for (const active of analysis.activePairs) {
    const speaker = resolveIdentity(active.speaker);
    const listener = resolveIdentity(active.listener);
    if (
      !speaker ||
      !listener ||
      speaker.id === listener.id ||
      !currentChunk.includes(active.evidence)
    ) {
      continue;
    }
    const pair = `${speaker.id}\u0000${listener.id}`;
    if (acceptedActivePairs.has(pair)) continue;
    activePairs.push({
      ...active,
      speaker: speaker.sourceName,
      listener: listener.sourceName,
    });
    acceptedActivePairs.add(pair);
  }
  return { characters, relationships, activePairs };
}

function buildSceneContext(
  map: RelationshipMapV1,
  analysis: RelationshipAnalysis,
  currentChunk: string,
): RelationshipPromptContext | null {
  const relationshipsByPair = new Map<string, RelationshipAnalysisRelationship>();
  for (const relationship of analysis.relationships) {
    relationshipsByPair.set(
      identityPairKey(relationship.speaker, relationship.listener),
      relationship,
    );
  }

  const scenePairs: RelationshipActivePairInput[] = [];
  for (const active of analysis.activePairs) {
    const relation = relationshipsByPair.get(identityPairKey(active.speaker, active.listener));
    scenePairs.push(relation ?? { speaker: active.speaker, listener: active.listener });
  }
  if (scenePairs.length === 0) {
    const profiles = map.characters.filter(
      (character) =>
        character.enabled &&
        [character.sourceName, ...character.aliases].some((identity) =>
          currentChunk.includes(identity),
        ),
    );
    return profiles.length > 0
      ? {
          characters: profiles.slice(0, MAX_RELATIONSHIP_PROMPT_ITEMS),
          relationships: [],
          activePairs: [],
        }
      : null;
  }
  const context = buildRelationshipPromptContext(map, scenePairs);
  return context.activePairs.length > 0 ? context : null;
}

function identityPairKey(speaker: string, listener: string): string {
  return `${normalizeIdentity(speaker)}\u0000${normalizeIdentity(listener)}`;
}

function buildFallbackContext(
  map: RelationshipMapV1 | null,
  currentChunk: string,
): RelationshipPromptContext | null {
  if (!map) return null;
  const matchedCharacters = map.characters.filter(
    (character) =>
      character.enabled &&
      [character.sourceName, ...character.aliases].some((identity) =>
        currentChunk.includes(identity),
      ),
  );
  const matchedIds = new Set(matchedCharacters.map((character) => character.id));
  const matchedRelationships = map.relationships.filter(
    (relationship) =>
      relationship.enabled &&
      matchedIds.has(relationship.speakerId) &&
      matchedIds.has(relationship.listenerId),
  );
  return {
    characters: matchedCharacters,
    relationships: matchedRelationships,
    activePairs: matchedRelationships.map((relationship) => ({
      speakerId: relationship.speakerId,
      listenerId: relationship.listenerId,
      relationshipId: relationship.id,
    })),
  };
}

function joinWarnings(...warnings: Array<string | null | undefined>): string | null {
  const unique = [...new Set(warnings.filter((warning): warning is string => Boolean(warning)))];
  return unique.length > 0 ? unique.join(" ") : null;
}

function emptyResult(warning: string | null): ChunkRelationshipAnalysis {
  return { context: null, warning, promptTokens: 0, completionTokens: 0 };
}
