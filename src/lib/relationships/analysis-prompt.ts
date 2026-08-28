import { MAX_RELATIONSHIP_PROMPT_ITEMS, relationshipAnalysisSchema } from "./schemas";
import type { ApprovedCharacterMapping, RelationshipAnalysis, RelationshipMapV1 } from "./schemas";
import { normalizePair } from "@/lib/translation/prompts";

export interface RelationshipAnalysisPromptOptions {
  pair: string;
  existingMap: RelationshipMapV1;
  approvedMappings: readonly ApprovedCharacterMapping[];
  storySummary?: string | null;
  previousSourceTail?: string | null;
  currentChunk: string;
}

export function buildRelationshipAnalysisPrompt(
  options: RelationshipAnalysisPromptOptions,
): string {
  const pair = normalizePair(options.pair);
  const relevanceText = [options.currentChunk, options.previousSourceTail]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const relevantCharacters = options.existingMap.characters
    .filter(
      (character) =>
        character.enabled &&
        [character.sourceName, ...character.aliases].some((identity) =>
          relevanceText.includes(identity),
        ),
    )
    .toSorted((left, right) => {
      const positionDifference =
        firstIdentityOccurrence(relevanceText, [left.sourceName, ...left.aliases]) -
        firstIdentityOccurrence(relevanceText, [right.sourceName, ...right.aliases]);
      if (positionDifference !== 0) return positionDifference;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .slice(0, MAX_RELATIONSHIP_PROMPT_ITEMS);
  const selectedCharacterIds = new Set(relevantCharacters.map((character) => character.id));
  const enabledMap = {
    version: options.existingMap.version,
    characters: relevantCharacters.map((character) => ({
      id: character.id,
      sourceName: character.sourceName,
      targetName: character.targetName,
      aliases: character.aliases,
      gender: character.gender,
      role: character.role,
      locked: character.locked,
    })),
    relationships: options.existingMap.relationships
      .filter(
        (relationship) =>
          relationship.enabled &&
          selectedCharacterIds.has(relationship.speakerId) &&
          selectedCharacterIds.has(relationship.listenerId),
      )
      .slice(0, MAX_RELATIONSHIP_PROMPT_ITEMS)
      .map((relationship) => ({
        id: relationship.id,
        speakerId: relationship.speakerId,
        listenerId: relationship.listenerId,
        relationship: relationship.relationship,
        speakerStatus: relationship.speakerStatus,
        familiarity: relationship.familiarity,
        selfPronoun: relationship.selfPronoun,
        addresseeTerm: relationship.addresseeTerm,
        sentenceParticles: relationship.sentenceParticles,
        register: relationship.register,
        notes: relationship.notes,
        locked: relationship.locked,
      })),
  };
  const approvedMappings = options.approvedMappings
    .filter((mapping) => relevanceText.includes(mapping.source))
    .slice(0, MAX_RELATIONSHIP_PROMPT_ITEMS);

  return [
    `You are a careful dialogue-continuity analyst for the ${pair} language pair.`,
    "Analyze only the supplied source window and the enabled stored facts below.",
    "Do not invent a character, relationship, gender, role, or speech choice.",
    "Every character, relationship, and active-pair item must include a short literal source evidence excerpt copied exactly from currentChunk; never use the preceding tail as evidence.",
    "Use source-language names as sourceName and as relationship speaker/listener values.",
    "Resolve aliases to the established source identity when possible; do not create a second identity for the same person.",
    "Distinguish the speaker from the listener. activePairs must contain only directed pairs shown or clearly addressed in currentChunk.",
    "Leave gender, status, familiarity, Thai pronouns, addressee terms, particles, and register as unknown/null when the source does not establish them.",
    "Never infer a global Thai mapping for Chinese 我 or 你. Those words depend on the directed speaker and listener in the current scene.",
    "Approved character glossary mappings supply exact Thai names and take precedence over any other target spelling.",
    "A locked stored speech choice is authoritative. Current source evidence may update an unlocked relationship label, but generic instructions cannot override locked fields.",
    "Return JSON only with exactly these top-level arrays: characters, relationships, activePairs.",
    "Character item shape: {sourceName,targetName,aliases,gender,role,notes,evidence}.",
    "Relationship item shape: {speaker,listener,relationship,speakerStatus,familiarity,selfPronoun,addresseeTerm,sentenceParticles,register,notes,evidence}.",
    "activePairs item shape: {speaker,listener,evidence}.",
    "Do not output IDs; the application assigns stable IDs after validating source identities.",
    "",
    `Existing enabled relationship map:\n${JSON.stringify(enabledMap)}`,
    `Approved character glossary mappings:\n${JSON.stringify(approvedMappings)}`,
    `Rolling story summary (supporting context only):\n${options.storySummary?.trim() || "None"}`,
  ].join("\n");
}

function firstIdentityOccurrence(text: string, identities: readonly string[]): number {
  let first = Number.POSITIVE_INFINITY;
  for (const identity of identities) {
    const position = text.indexOf(identity);
    if (position >= 0 && position < first) first = position;
  }
  return first;
}

export function buildRelationshipAnalysisUserMessage(options: {
  previousSourceTail?: string | null;
  currentChunk: string;
}): string {
  const previous = options.previousSourceTail?.trim();
  return [
    previous
      ? `[Preceding raw-source tail for continuity — do not analyze as a new scene]\n${previous}`
      : "[No preceding raw-source tail]",
    "",
    "<<<BEGIN_CURRENT_SOURCE>>>\n",
    options.currentChunk,
    "\n<<<END_CURRENT_SOURCE>>>",
    "",
    "Return only the requested JSON object.",
  ].join("\n");
}

/** Parse provider JSON, including the fenced-JSON form common in model output. */
export function parseRelationshipAnalysis(json: string): RelationshipAnalysis | null {
  const candidate = extractJsonObject(json);
  if (candidate === null) return null;

  try {
    const raw: unknown = JSON.parse(candidate);
    const normalized = normalizeAnalysisShape(raw);
    const result = relationshipAnalysisSchema.safeParse(normalized);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function normalizeAnalysisShape(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const characters = Array.isArray(value.characters)
    ? value.characters.map((item) => {
        if (!isRecord(item)) return item;
        return {
          sourceName: item.sourceName ?? item.name ?? item.source,
          targetName: item.targetName ?? item.thaiName ?? item.target ?? null,
          aliases: Array.isArray(item.aliases)
            ? item.aliases
            : typeof item.alias === "string"
              ? [item.alias]
              : [],
          gender: item.gender ?? "unknown",
          role: item.role ?? null,
          notes: item.notes ?? item.note ?? null,
          evidence: item.evidence,
        };
      })
    : value.characters;
  const relationships = Array.isArray(value.relationships)
    ? value.relationships.map((item) => {
        if (!isRecord(item)) return item;
        return {
          speaker: item.speaker ?? item.speakerName ?? item.speakerSourceName,
          listener: item.listener ?? item.listenerName ?? item.listenerSourceName,
          relationship: item.relationship ?? item.label,
          speakerStatus: item.speakerStatus ?? item.status ?? "unknown",
          familiarity: item.familiarity ?? "unknown",
          selfPronoun: item.selfPronoun ?? item.pronoun ?? null,
          addresseeTerm: item.addresseeTerm ?? item.title ?? null,
          sentenceParticles: item.sentenceParticles ?? item.particles ?? null,
          register: item.register ?? null,
          notes: item.notes ?? item.note ?? null,
          evidence: item.evidence,
        };
      })
    : value.relationships;
  const activePairs = Array.isArray(value.activePairs)
    ? value.activePairs.map((item) => {
        if (!isRecord(item)) return item;
        return {
          speaker: item.speaker ?? item.speakerName ?? item.speakerSourceName,
          listener: item.listener ?? item.listenerName ?? item.listenerSourceName,
          evidence: item.evidence,
        };
      })
    : value.activePairs;

  return { characters, relationships, activePairs };
}

function extractJsonObject(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  if (trimmed.startsWith("{")) return trimmed;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
