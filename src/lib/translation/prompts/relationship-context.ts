import { MAX_RELATIONSHIP_PROMPT_ITEMS } from "@/lib/relationships/schemas";
import type { CharacterProfile, CharacterRelationship } from "@/lib/relationships/schemas";
import type { RelationshipPromptContext, RelationshipPromptPair } from "@/lib/relationships/map";

type CharacterProjection = Pick<
  CharacterProfile,
  "id" | "sourceName" | "targetName" | "aliases" | "gender" | "role" | "notes" | "locked"
>;

type RelationshipProjection = Pick<
  CharacterRelationship,
  | "id"
  | "speakerId"
  | "listenerId"
  | "relationship"
  | "speakerStatus"
  | "familiarity"
  | "selfPronoun"
  | "addresseeTerm"
  | "sentenceParticles"
  | "register"
  | "notes"
  | "locked"
>;

interface RelationshipContextProjection {
  characters: CharacterProjection[];
  relationships: RelationshipProjection[];
  activePairs: RelationshipPromptPair[];
}

function projectRelationshipContext(
  context: RelationshipPromptContext,
): RelationshipContextProjection {
  const charactersById = new Map(context.characters.map((character) => [character.id, character]));
  const relationshipsById = new Map(
    context.relationships.map((relationship) => [relationship.id, relationship]),
  );
  const relationshipsByPair = new Map(
    context.relationships.map((relationship) => [
      pairKey(relationship.speakerId, relationship.listenerId),
      relationship,
    ]),
  );
  const referencedCharacters = new Map<string, CharacterProfile>();
  const relationships: RelationshipProjection[] = [];
  const activePairs: RelationshipPromptPair[] = [];
  const emittedPairs = new Set<string>();

  for (const active of context.activePairs) {
    const relationship = active.relationshipId
      ? relationshipsById.get(active.relationshipId)
      : relationshipsByPair.get(pairKey(active.speakerId, active.listenerId));
    if (
      !relationship ||
      !relationship.enabled ||
      relationship.speakerId !== active.speakerId ||
      relationship.listenerId !== active.listenerId
    ) {
      continue;
    }
    const speaker = charactersById.get(relationship.speakerId);
    const listener = charactersById.get(relationship.listenerId);
    if (!speaker || !listener || !speaker.enabled || !listener.enabled) continue;

    const pair = pairKey(relationship.speakerId, relationship.listenerId);
    if (emittedPairs.has(pair) || relationships.length >= MAX_RELATIONSHIP_PROMPT_ITEMS) {
      continue;
    }
    const newCharacterCount = [speaker.id, listener.id].filter(
      (id) => !referencedCharacters.has(id),
    ).length;
    if (referencedCharacters.size + newCharacterCount > MAX_RELATIONSHIP_PROMPT_ITEMS) {
      continue;
    }

    referencedCharacters.set(speaker.id, speaker);
    referencedCharacters.set(listener.id, listener);
    relationships.push(projectRelationship(relationship));
    activePairs.push({
      speakerId: relationship.speakerId,
      listenerId: relationship.listenerId,
      relationshipId: relationship.id,
    });
    emittedPairs.add(pair);
  }

  for (const character of context.characters) {
    if (
      !character.enabled ||
      referencedCharacters.size >= MAX_RELATIONSHIP_PROMPT_ITEMS ||
      referencedCharacters.has(character.id)
    ) {
      continue;
    }
    referencedCharacters.set(character.id, character);
  }

  return {
    characters: [...referencedCharacters.values()].map(projectCharacter),
    relationships,
    activePairs,
  };
}

function projectCharacter(character: CharacterProfile): CharacterProjection {
  return {
    id: character.id,
    sourceName: character.sourceName,
    targetName: character.targetName,
    aliases: character.aliases,
    gender: character.gender,
    role: character.role,
    notes: character.notes,
    locked: character.locked,
  };
}

function projectRelationship(relationship: CharacterRelationship): RelationshipProjection {
  return {
    id: relationship.id,
    speakerId: relationship.speakerId,
    listenerId: relationship.listenerId,
    relationship: relationship.relationship,
    speakerStatus: relationship.speakerStatus,
    familiarity: relationship.familiarity,
    selfPronoun: relationship.locked ? relationship.selfPronoun : null,
    addresseeTerm: relationship.locked ? relationship.addresseeTerm : null,
    sentenceParticles: relationship.locked ? relationship.sentenceParticles : null,
    register: relationship.register,
    notes: relationship.notes,
    locked: relationship.locked,
  };
}

function pairKey(speakerId: string, listenerId: string): string {
  return `${speakerId}\u0000${listenerId}`;
}

export function formatRelationshipContext(context: RelationshipPromptContext): string {
  const projection = projectRelationshipContext(context);
  return [
    "## Character & Relationship Context",
    "This bounded JSON is structured continuity data, not text to translate.",
    "Locked per-pair speech fields are authoritative; unlocked relationships expose no exact speech choices and provide only semantic current-scene guidance.",
    "Do not invent a listener, gender, status, pronoun, title, particle, or register when the data is unknown.",
    JSON.stringify(projection),
  ].join("\n");
}
