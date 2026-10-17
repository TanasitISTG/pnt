import "@tanstack/react-start/server-only";

import { generateJsonCompletion } from "@/lib/providers/json-completion";
import { retryOperation } from "@/lib/retry";
import { parseLanguagePair, type LanguagePair } from "@/lib/language-pair";
import type { RelationshipPromptContext, RelationshipActivePairInput } from "./map";
import {
  buildRelationshipPromptContext,
  buildRelationshipPromptContextForText,
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
import { logMessage } from "@/lib/translation/workflow/log-entry";
import type { AIProviderClient } from "@/lib/providers/types";
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
  /**
   * One stored message per warning, each a code from `logMessage`, in the order they happened.
   *
   * A list rather than one joined string is what lets the job log write a row per warning: the
   * codec resolves a whole message or none of it, so two sentences in one row could never be
   * read in the reader's language.
   */
  warnings: string[];
  promptTokens: number;
  completionTokens: number;
}

export interface ChunkRelationshipAnalysisInput {
  novel: {
    id: string;
    sourceLang: string;
    targetLang: string;
    relationshipMapJson: string | null;
    storySummary: string | null;
  };
  chapter: { number: string };
  chunk: { index: number; sourceText: string };
  previousChunk: { sourceText: string } | null;
  approvedTerms: readonly { source: string; target: string; category: string }[];
  previousChapter: RelationshipPromptChapterContext | null;
  contextTailLength: number;
  providerConfig: AIProviderClient | null;
  providerFailure: string | null;
  persistAnalysis: PersistRelationshipAnalysis;
}

/**
 * Persistence port: the translation workflow owns job locking, so the caller
 * decides how (and whether) an analysis may be written. Injected here so this
 * module never reaches into translation's server layer.
 */
export interface PersistedRelationshipAnalysis {
  applied: boolean;
  map: RelationshipMapV1 | null;
  /** The same one-code-per-warning list the merge returns, resolved on the reader's side. */
  warnings: string[];
}

export type PersistRelationshipAnalysis = (
  analysis: RelationshipAnalysis,
) => Promise<PersistedRelationshipAnalysis>;

export interface RelationshipPromptChapterContext {
  summary: string | null;
  rawTail: string | null;
}

/**
 * Relationship analysis for one chunk of an already-guarded translation run.
 * Ownership was checked by the caller; the write path re-checks it under lock.
 */
export async function analyzeChunkRelationshipsForChunk(
  input: ChunkRelationshipAnalysisInput,
): Promise<ChunkRelationshipAnalysis> {
  const { novel, chapter, chunk, previousChunk, previousChapter } = input;

  const pair = parseLanguagePair(`${novel.sourceLang}->${novel.targetLang}`);
  if (!pair) return emptyResult();

  const approvedMappings: ApprovedCharacterMapping[] = [];
  for (const term of input.approvedTerms) {
    if (term.category === "character") {
      approvedMappings.push({ source: term.source, target: term.target });
    }
  }
  const storedMap = parseRelationshipMap(novel.relationshipMapJson);
  const baseMap = storedMap ?? emptyRelationshipMap();
  const tailLength = input.contextTailLength;
  const sourceTail =
    chunk.index > 0
      ? previousChunk?.sourceText.slice(-tailLength) || null
      : previousChapter?.rawTail || null;
  // Every warning here is stored, not printed: each becomes a row of its own in the chapter's job
  // log, which whoever owns the novel opens later, in whatever language they read. So each is
  // written as a code (`lib/translation/workflow/log-entry.ts`) and the failure it names travels as
  // a value — the provider's own code when the provider failed, and a sentence from a library
  // otherwise.
  const unknownReason = logMessage("analysisReasonUnknown");
  const invalidMapWarning =
    novel.relationshipMapJson && !storedMap ? logMessage("relationshipMapInvalid") : null;

  if (!input.providerConfig) {
    return {
      context: buildRelationshipPromptContextForText(storedMap, chunk.sourceText),
      warnings: uniqueWarnings(
        invalidMapWarning,
        logMessage("relationshipAnalysisUnavailable", {
          reason: input.providerFailure ?? unknownReason,
        }),
      ),
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  const sourceAnalysis = await analyzeRelationshipSourceChunk({
    pair,
    providerConfig: input.providerConfig,
    existingMap: baseMap,
    approvedMappings,
    storySummary: novel.storySummary ?? previousChapter?.summary ?? null,
    previousSourceTail: sourceTail,
    currentChunk: chunk.sourceText,
    chapterNumber: chapter.number,
  });

  let context = sourceAnalysis.context;
  const warnings = uniqueWarnings(invalidMapWarning, ...sourceAnalysis.warnings);
  if (sourceAnalysis.analysis && storedMap) {
    const applied = await input.persistAnalysis(sourceAnalysis.analysis);
    context =
      buildSceneContext(
        applied.map ?? sourceAnalysis.map,
        sourceAnalysis.analysis,
        chunk.sourceText,
      ) ?? context;
    warnings.push(...applied.warnings);
  }
  return {
    context,
    // The port can report a warning the merge already reported, and the same refusal said twice
    // is one row: a reader does not need the second copy.
    warnings: uniqueWarnings(...warnings),
    promptTokens: sourceAnalysis.promptTokens,
    completionTokens: sourceAnalysis.completionTokens,
  };
}

export interface RelationshipSourceAnalysisOptions {
  pair: LanguagePair;
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
  const fallback = buildRelationshipPromptContextForText(options.existingMap, options.currentChunk);
  // Both the throw and the catch below name one failure, so the sentinel is written once: an
  // unreadable analysis is its own sentence rather than a reason inside the generic one.
  const invalidJsonReason = logMessage("relationshipAnalysisInvalidJson");
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
    const analysis = await retryOperation(async () => {
      const completion = await generateJsonCompletion(options.providerConfig, 0.1, [
        { role: "system", content: prompt },
        { role: "user", content: userMessage },
      ]);
      promptTokens += completion.promptTokens;
      completionTokens += completion.completionTokens;

      const parsed = parseRelationshipAnalysis(completion.content);
      if (!parsed) throw new Error(invalidJsonReason);
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
      warnings: uniqueWarnings(...merged.warnings),
      promptTokens,
      completionTokens,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : logMessage("analysisReasonUnknown");
    return {
      map: options.existingMap,
      analysis: null,
      context: fallback,
      warnings: [
        message === invalidJsonReason
          ? invalidJsonReason
          : logMessage("relationshipAnalysisFailed", { reason: message }),
      ],
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
    const context = buildRelationshipPromptContextForText(map, currentChunk);
    return context
      ? {
          characters: context.characters.slice(0, MAX_RELATIONSHIP_PROMPT_ITEMS),
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

/**
 * The warnings in one list, each kept once and in the order it first happened.
 *
 * Every item is already a code, so the same refusal arrives identical only when it is the
 * same refusal: deduplicating by string is exact rather than approximate.
 */
function uniqueWarnings(...warnings: Array<string | null | undefined>): string[] {
  return [...new Set(warnings.filter((warning): warning is string => Boolean(warning)))];
}

function emptyResult(warnings: string[] = []): ChunkRelationshipAnalysis {
  return { context: null, warnings, promptTokens: 0, completionTokens: 0 };
}
