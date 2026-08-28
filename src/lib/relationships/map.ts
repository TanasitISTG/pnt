import {
  MAX_CHARACTER_ALIASES,
  MAX_RELATIONSHIPS,
  MAX_RELATIONSHIP_CHARACTERS,
  MAX_RELATIONSHIP_PROMPT_ITEMS,
  normalizeIdentity,
  normalizeOptionalText,
  relationshipMapSchema,
  type ApprovedCharacterMapping,
  type CharacterProfile,
  type CharacterRelationship,
  type Familiarity,
  type RelationshipAnalysis,
  type RelationshipAnalysisActivePair,
  type RelationshipAnalysisRelationship,
  type RelationshipGender,
  type RelationshipMapV1,
  type SpeakerStatus,
} from "./schemas";

export interface RelationshipMergeResult {
  map: RelationshipMapV1;
  warnings: string[];
}

export interface RelationshipPromptPair {
  speakerId: string;
  listenerId: string;
  relationshipId?: string;
}

export interface RelationshipActivePairInput extends Partial<
  Pick<
    CharacterRelationship,
    | "relationship"
    | "speakerStatus"
    | "familiarity"
    | "selfPronoun"
    | "addresseeTerm"
    | "sentenceParticles"
    | "register"
    | "notes"
    | "evidence"
  >
> {
  speaker: string;
  listener: string;
  relationshipId?: string;
}

export interface RelationshipPromptContext {
  characters: CharacterProfile[];
  relationships: CharacterRelationship[];
  activePairs: RelationshipPromptPair[];
}

const UNKNOWN_GENDER: RelationshipGender = "unknown";
const UNKNOWN_STATUS: SpeakerStatus = "unknown";
const UNKNOWN_FAMILIARITY: Familiarity = "unknown";

export function emptyRelationshipMap(): RelationshipMapV1 {
  return { version: 1, characters: [], relationships: [] };
}

/** Parse persisted JSON without ever throwing or returning a partial document. */
export function parseRelationshipMap(json: string | null | undefined): RelationshipMapV1 | null {
  if (!json?.trim()) return null;

  try {
    const value: unknown = JSON.parse(json);
    const result = relationshipMapSchema.safeParse(value);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function serializeRelationshipMap(map: RelationshipMapV1): string {
  return JSON.stringify(relationshipMapSchema.parse(map));
}

/**
 * Merge one source-window analysis into the durable map.
 *
 * The returned map is a new value. Existing locked rows are copied byte-for-byte;
 * unlocked rows accept only non-empty, known automatic values. Caps are additive:
 * automatic suggestions are discarded rather than evicting existing facts.
 */
export function mergeAutomaticRelationshipAnalysis(
  map: RelationshipMapV1,
  analysis: RelationshipAnalysis,
  glossaryMappings: readonly ApprovedCharacterMapping[],
  chapterNumber: number | string | null,
  updatedAt = new Date().toISOString(),
): RelationshipMergeResult {
  const warnings: string[] = [];
  const next: RelationshipMapV1 = {
    version: 1,
    characters: map.characters.map((character) => ({
      ...character,
      aliases: [...character.aliases],
    })),
    relationships: map.relationships.map((relationship) => ({ ...relationship })),
  };
  const chapter = normalizeChapterNumber(chapterNumber);
  const glossaryBySource = new Map<string, string>();
  for (const mapping of glossaryMappings) {
    const source = normalizeIdentity(mapping.source);
    const target = mapping.target.trim();
    if (source && target && !glossaryBySource.has(source)) glossaryBySource.set(source, target);
  }

  const characterByIdentity = buildCharacterIdentityIndex(next.characters);
  const reservedCharacterIds = new Set(next.characters.map((character) => character.id));
  const timestamp = validTimestamp(updatedAt);

  for (const suggestion of analysis.characters) {
    const existing = resolveCharacter(next.characters, characterByIdentity, suggestion.sourceName);
    if (!existing) {
      if (next.characters.length >= MAX_RELATIONSHIP_CHARACTERS) {
        warnings.push(
          `Relationship character cap reached; skipped automatic character “${suggestion.sourceName}”.`,
        );
        continue;
      }

      const character: CharacterProfile = {
        id: uniqueStableId("character", suggestion.sourceName, reservedCharacterIds),
        sourceName: suggestion.sourceName.trim(),
        targetName:
          glossaryBySource.get(normalizeIdentity(suggestion.sourceName)) ??
          automaticText(suggestion.targetName),
        aliases: [],
        gender: suggestion.gender,
        role: automaticText(suggestion.role),
        notes: automaticText(suggestion.notes),
        enabled: true,
        locked: false,
        evidence: automaticText(suggestion.evidence),
        lastSeenChapter: chapter,
        updatedAt: timestamp,
      };
      addAutomaticAliases(character, suggestion.aliases, characterByIdentity, warnings);
      next.characters.push(character);
      indexCharacter(character, characterByIdentity);
      continue;
    }

    if (existing.locked || !existing.enabled) continue;

    const glossaryTarget = glossaryBySource.get(normalizeIdentity(existing.sourceName));
    const targetName = glossaryTarget ?? knownText(existing.targetName, suggestion.targetName);
    const gender = knownEnum(existing.gender, suggestion.gender, UNKNOWN_GENDER);
    const role = knownText(existing.role, suggestion.role);
    const notes = knownText(existing.notes, suggestion.notes);
    const evidence = knownText(existing.evidence, suggestion.evidence);
    const lastSeenChapter = maxChapterNumber(existing.lastSeenChapter, chapter);
    let changed = false;
    if (existing.targetName !== targetName) {
      existing.targetName = targetName;
      changed = true;
    }
    if (existing.gender !== gender) {
      existing.gender = gender;
      changed = true;
    }
    if (existing.role !== role) {
      existing.role = role;
      changed = true;
    }
    if (existing.notes !== notes) {
      existing.notes = notes;
      changed = true;
    }
    if (existing.evidence !== evidence) {
      existing.evidence = evidence;
      changed = true;
    }
    if (existing.lastSeenChapter !== lastSeenChapter) {
      existing.lastSeenChapter = lastSeenChapter;
      changed = true;
    }
    const aliasesChanged = addAutomaticAliases(
      existing,
      suggestion.aliases,
      characterByIdentity,
      warnings,
    );
    changed ||= aliasesChanged;
    if (changed) existing.updatedAt = timestamp;
    indexCharacter(existing, characterByIdentity);
  }

  const relationshipByPair = new Map<string, CharacterRelationship>();
  const reservedRelationshipIds = new Set([
    ...next.characters.map((character) => character.id),
    ...next.relationships.map((relationship) => relationship.id),
  ]);
  for (const relationship of next.relationships) {
    relationshipByPair.set(pairKey(relationship.speakerId, relationship.listenerId), relationship);
  }

  for (const suggestion of analysis.relationships) {
    const speaker = resolveCharacter(next.characters, characterByIdentity, suggestion.speaker);
    const listener = resolveCharacter(next.characters, characterByIdentity, suggestion.listener);
    if (!speaker || !listener || speaker.id === listener.id) {
      warnings.push(
        `Skipped automatic relationship with unresolved endpoint(s): “${suggestion.speaker}” → “${suggestion.listener}”.`,
      );
      continue;
    }

    const key = pairKey(speaker.id, listener.id);
    const existing = relationshipByPair.get(key);
    if (!existing) {
      if (next.relationships.length >= MAX_RELATIONSHIPS) {
        warnings.push(
          `Relationship cap reached; skipped automatic pair “${suggestion.speaker}” → “${suggestion.listener}”.`,
        );
        continue;
      }

      const relationship: CharacterRelationship = {
        id: uniqueStableId(
          "relationship",
          `${speaker.id}\u0000${listener.id}`,
          reservedRelationshipIds,
        ),
        speakerId: speaker.id,
        listenerId: listener.id,
        relationship: automaticText(suggestion.relationship) ?? "unknown",
        speakerStatus: suggestion.speakerStatus,
        familiarity: suggestion.familiarity,
        selfPronoun: automaticText(suggestion.selfPronoun),
        addresseeTerm: automaticText(suggestion.addresseeTerm),
        sentenceParticles: automaticText(suggestion.sentenceParticles),
        register: automaticText(suggestion.register),
        notes: automaticText(suggestion.notes),
        enabled: true,
        locked: false,
        evidence: automaticText(suggestion.evidence),
        lastSeenChapter: chapter,
        updatedAt: timestamp,
      };
      next.relationships.push(relationship);
      relationshipByPair.set(key, relationship);
      continue;
    }

    if (existing.locked || !existing.enabled) continue;

    mergeAutomaticRelationship(existing, suggestion, chapter, timestamp);
  }

  const validated = relationshipMapSchema.safeParse(next);
  if (!validated.success) {
    warnings.push(
      "Automatic relationship analysis produced an invalid map; no map changes were applied.",
    );
    return { map, warnings };
  }
  return { map: validated.data, warnings };
}

/**
 * Build the small prompt-visible projection for the current scene. Stored locked
 * values win over scene analysis; unlocked stored values are overlaid by known
 * scene fields. Disabled durable rows are never surfaced as active relationships.
 */
export function buildRelationshipPromptContext(
  map: RelationshipMapV1,
  activePairs: readonly (RelationshipAnalysisActivePair | RelationshipActivePairInput)[],
): RelationshipPromptContext {
  const charactersByIdentity = buildCharacterIdentityIndex(map.characters);
  const relationshipsById = new Map(
    map.relationships.map((relationship) => [relationship.id, relationship]),
  );
  const relationshipsByPair = new Map(
    map.relationships.map((relationship) => [
      pairKey(relationship.speakerId, relationship.listenerId),
      relationship,
    ]),
  );
  const referencedCharacters = new Map<string, CharacterProfile>();
  const relationships: CharacterRelationship[] = [];
  const pairs: RelationshipPromptPair[] = [];

  for (const active of activePairs) {
    const speaker = resolveCharacter(map.characters, charactersByIdentity, active.speaker);
    const listener = resolveCharacter(map.characters, charactersByIdentity, active.listener);
    if (
      !speaker ||
      !listener ||
      !speaker.enabled ||
      !listener.enabled ||
      speaker.id === listener.id
    ) {
      continue;
    }
    const activeRelationshipId = "relationshipId" in active ? active.relationshipId : undefined;
    const stored = activeRelationshipId
      ? relationshipsById.get(activeRelationshipId)
      : relationshipsByPair.get(pairKey(speaker.id, listener.id));
    if (
      stored &&
      (!stored.enabled || stored.speakerId !== speaker.id || stored.listenerId !== listener.id)
    ) {
      continue;
    }

    const effective = stored
      ? stored.locked
        ? { ...stored }
        : overlayRelationship(stored, active)
      : makeSceneRelationship(speaker.id, listener.id, active);
    if (!effective) continue;

    referencedCharacters.set(speaker.id, speaker);
    referencedCharacters.set(listener.id, listener);
    relationships.push(effective);
    pairs.push({ speakerId: speaker.id, listenerId: listener.id, relationshipId: effective.id });
  }

  if (pairs.length === 0) {
    return {
      characters: map.characters
        .filter((character) => character.enabled)
        .slice(0, MAX_RELATIONSHIP_PROMPT_ITEMS),
      relationships: [],
      activePairs: [],
    };
  }

  return {
    characters: [...referencedCharacters.values()],
    relationships,
    activePairs: pairs,
  };
}

function mergeAutomaticRelationship(
  target: CharacterRelationship,
  suggestion: RelationshipAnalysisRelationship,
  chapter: number | null,
  updatedAt: string,
): boolean {
  const relationship = knownRequiredText(target.relationship, suggestion.relationship, "unknown");
  const speakerStatus = knownEnum(target.speakerStatus, suggestion.speakerStatus, UNKNOWN_STATUS);
  const familiarity = knownEnum(target.familiarity, suggestion.familiarity, UNKNOWN_FAMILIARITY);
  const selfPronoun = knownText(target.selfPronoun, suggestion.selfPronoun);
  const addresseeTerm = knownText(target.addresseeTerm, suggestion.addresseeTerm);
  const sentenceParticles = knownText(target.sentenceParticles, suggestion.sentenceParticles);
  const register = knownText(target.register, suggestion.register);
  const notes = knownText(target.notes, suggestion.notes);
  const evidence = knownText(target.evidence, suggestion.evidence);
  const lastSeenChapter = maxChapterNumber(target.lastSeenChapter, chapter);
  let changed = false;
  if (target.relationship !== relationship) {
    target.relationship = relationship;
    changed = true;
  }
  if (target.speakerStatus !== speakerStatus) {
    target.speakerStatus = speakerStatus;
    changed = true;
  }
  if (target.familiarity !== familiarity) {
    target.familiarity = familiarity;
    changed = true;
  }
  if (target.selfPronoun !== selfPronoun) {
    target.selfPronoun = selfPronoun;
    changed = true;
  }
  if (target.addresseeTerm !== addresseeTerm) {
    target.addresseeTerm = addresseeTerm;
    changed = true;
  }
  if (target.sentenceParticles !== sentenceParticles) {
    target.sentenceParticles = sentenceParticles;
    changed = true;
  }
  if (target.register !== register) {
    target.register = register;
    changed = true;
  }
  if (target.notes !== notes) {
    target.notes = notes;
    changed = true;
  }
  if (target.evidence !== evidence) {
    target.evidence = evidence;
    changed = true;
  }
  if (target.lastSeenChapter !== lastSeenChapter) {
    target.lastSeenChapter = lastSeenChapter;
    changed = true;
  }
  if (changed) target.updatedAt = updatedAt;
  return changed;
}

function addAutomaticAliases(
  character: CharacterProfile,
  aliases: readonly string[],
  index: Map<string, CharacterProfile>,
  warnings: string[],
): boolean {
  let changed = false;
  for (const alias of aliases) {
    const trimmed = alias.trim();
    const normalized = normalizeIdentity(trimmed);
    if (!normalized || normalized === normalizeIdentity(character.sourceName)) continue;
    const owner = index.get(normalized);
    if (owner && owner.id !== character.id) continue;
    if (character.aliases.some((item) => normalizeIdentity(item) === normalized)) continue;
    if (character.aliases.length >= MAX_CHARACTER_ALIASES) {
      warnings.push(
        `Alias cap reached for automatic character “${character.sourceName}”; discarded “${trimmed}”.`,
      );
      continue;
    }
    character.aliases.push(trimmed);
    index.set(normalized, character);
    changed = true;
  }
  return changed;
}

function overlayRelationship(
  stored: CharacterRelationship,
  active: RelationshipActivePairInput | RelationshipAnalysisActivePair,
): CharacterRelationship {
  const candidate = active as RelationshipActivePairInput;
  return {
    ...stored,
    relationship: knownRequiredText(stored.relationship, candidate.relationship, "unknown"),
    speakerStatus: knownEnum(stored.speakerStatus, candidate.speakerStatus, UNKNOWN_STATUS),
    familiarity: knownEnum(stored.familiarity, candidate.familiarity, UNKNOWN_FAMILIARITY),
    selfPronoun: knownText(stored.selfPronoun, candidate.selfPronoun),
    addresseeTerm: knownText(stored.addresseeTerm, candidate.addresseeTerm),
    sentenceParticles: knownText(stored.sentenceParticles, candidate.sentenceParticles),
    register: knownText(stored.register, candidate.register),
    notes: knownText(stored.notes, candidate.notes),
    evidence: knownText(stored.evidence, candidate.evidence),
  };
}

function makeSceneRelationship(
  speakerId: string,
  listenerId: string,
  active: RelationshipActivePairInput | RelationshipAnalysisActivePair,
): CharacterRelationship | null {
  const candidate = active as RelationshipActivePairInput;
  const relationship = automaticText(candidate.relationship);
  if (!relationship) return null;
  return {
    id:
      candidate.relationshipId ?? stableId("scene-relationship", `${speakerId}\u0000${listenerId}`),
    speakerId,
    listenerId,
    relationship,
    speakerStatus: candidate.speakerStatus ?? UNKNOWN_STATUS,
    familiarity: candidate.familiarity ?? UNKNOWN_FAMILIARITY,
    selfPronoun: automaticText(candidate.selfPronoun),
    addresseeTerm: automaticText(candidate.addresseeTerm),
    sentenceParticles: automaticText(candidate.sentenceParticles),
    register: automaticText(candidate.register),
    notes: automaticText(candidate.notes),
    enabled: true,
    locked: false,
    evidence: automaticText(candidate.evidence),
    lastSeenChapter: null,
    updatedAt: new Date().toISOString(),
  };
}

function buildCharacterIdentityIndex(
  characters: readonly CharacterProfile[],
): Map<string, CharacterProfile> {
  const index = new Map<string, CharacterProfile>();
  for (const character of characters) indexCharacter(character, index);
  return index;
}

function indexCharacter(character: CharacterProfile, index: Map<string, CharacterProfile>): void {
  index.set(normalizeIdentity(character.sourceName), character);
  for (const alias of character.aliases) index.set(normalizeIdentity(alias), character);
}

function resolveCharacter(
  characters: readonly CharacterProfile[],
  index: Map<string, CharacterProfile>,
  identity: string,
): CharacterProfile | null {
  const trimmed = identity.trim();
  if (!trimmed) return null;
  const byIdentity = index.get(normalizeIdentity(trimmed));
  if (byIdentity) return byIdentity;
  return characters.find((character) => character.id === trimmed) ?? null;
}

function knownText(current: string | null, incoming: string | null | undefined): string | null {
  return automaticText(incoming) ?? automaticText(current);
}

function knownRequiredText(
  current: string,
  incoming: string | null | undefined,
  fallback: string,
): string {
  return automaticText(incoming) ?? automaticText(current) ?? fallback;
}

function automaticText(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized && normalizeIdentity(normalized) !== "unknown" ? normalized : null;
}

function knownEnum<T extends string>(current: T, incoming: T | null | undefined, unknown: T): T {
  return incoming && incoming !== unknown ? incoming : current !== unknown ? current : unknown;
}

function normalizeChapterNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function maxChapterNumber(current: number | null, incoming: number | null): number | null {
  if (current === null) return incoming;
  if (incoming === null) return current;
  return Math.max(current, incoming);
}
function validTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : new Date().toISOString();
}

function pairKey(speakerId: string, listenerId: string): string {
  return `${speakerId}\u0000${listenerId}`;
}

function stableId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (const character of normalizeIdentity(value)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function uniqueStableId(prefix: string, value: string, reserved: Set<string>): string {
  const base = stableId(prefix, value);
  let candidate = base;
  let suffix = 2;
  while (reserved.has(candidate)) candidate = `${base}-${suffix++}`;
  reserved.add(candidate);
  return candidate;
}
