import { z } from "zod";

export const RELATIONSHIP_MAP_VERSION = 1 as const;
export const MAX_RELATIONSHIP_CHARACTERS = 200;
export const MAX_RELATIONSHIPS = 400;
export const MAX_CHARACTER_ALIASES = 8;
export const MAX_NAME_LENGTH = 120;
export const MAX_RELATIONSHIP_TEXT_LENGTH = 160;
export const MAX_SPEECH_FIELD_LENGTH = 80;
export const MAX_NOTES_LENGTH = 500;
export const MAX_EVIDENCE_LENGTH = 300;
export const MAX_RELATIONSHIP_PROMPT_ITEMS = 24;

export const relationshipGenderSchema = z.enum(["male", "female", "nonbinary", "unknown"]);
export const speakerStatusSchema = z.enum(["lower", "peer", "higher", "unknown"]);
export const familiaritySchema = z.enum(["intimate", "close", "familiar", "distant", "unknown"]);

const boundedNameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const nullableNameSchema = boundedNameSchema.nullable();
const boundedRelationshipTextSchema = z.string().trim().max(MAX_RELATIONSHIP_TEXT_LENGTH);
const boundedSpeechFieldSchema = z.string().trim().max(MAX_SPEECH_FIELD_LENGTH);
const nullableSpeechFieldSchema = boundedSpeechFieldSchema.nullable();
const nullableRelationshipTextSchema = boundedRelationshipTextSchema.nullable();
const nullableNotesSchema = z.string().trim().max(MAX_NOTES_LENGTH).nullable();
const nullableEvidenceSchema = z.string().trim().max(MAX_EVIDENCE_LENGTH).nullable();
const chapterNumberSchema = z.number().finite().nonnegative().nullable();

const isoTimestampSchema = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value)),
    "updatedAt must be an ISO-8601 timestamp",
  );

const entryMetadataSchema = {
  enabled: z.boolean(),
  locked: z.boolean(),
  evidence: nullableEvidenceSchema,
  lastSeenChapter: chapterNumberSchema,
  updatedAt: isoTimestampSchema,
};

export const characterProfileSchema = z.object({
  id: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  sourceName: boundedNameSchema,
  targetName: nullableNameSchema,
  aliases: z.array(boundedNameSchema).max(MAX_CHARACTER_ALIASES),
  gender: relationshipGenderSchema,
  role: nullableRelationshipTextSchema,
  notes: nullableNotesSchema,
  ...entryMetadataSchema,
});

export const characterRelationshipSchema = z.object({
  id: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  speakerId: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  listenerId: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  relationship: boundedRelationshipTextSchema.min(1),
  speakerStatus: speakerStatusSchema,
  familiarity: familiaritySchema,
  selfPronoun: nullableSpeechFieldSchema,
  addresseeTerm: nullableSpeechFieldSchema,
  sentenceParticles: nullableSpeechFieldSchema,
  register: nullableRelationshipTextSchema,
  notes: nullableNotesSchema,
  ...entryMetadataSchema,
});

export const relationshipMapSchema = z
  .object({
    version: z.literal(RELATIONSHIP_MAP_VERSION),
    characters: z.array(characterProfileSchema).max(MAX_RELATIONSHIP_CHARACTERS),
    relationships: z.array(characterRelationshipSchema).max(MAX_RELATIONSHIPS),
  })
  .superRefine((map, ctx) => {
    const ids = new Set<string>();
    const entryIds = new Set<string>();
    const names = new Map<string, { index: number; field: string }>();

    for (const [index, character] of map.characters.entries()) {
      if (entryIds.has(character.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["characters", index, "id"],
          message: `Duplicate character ID: ${character.id}`,
        });
      }
      entryIds.add(character.id);
      ids.add(character.id);

      for (const [field, value] of [
        ["sourceName", character.sourceName],
        ...character.aliases.map((alias) => ["aliases", alias] as const),
      ] as const) {
        const normalized = normalizeIdentity(value);
        const previous = names.get(normalized);
        if (previous) {
          ctx.addIssue({
            code: "custom",
            path: ["characters", index, field === "aliases" ? "aliases" : field],
            message: `Duplicate normalized character name or alias: ${value}`,
          });
        } else {
          names.set(normalized, { index, field });
        }
      }
    }

    const directedPairs = new Set<string>();
    for (const [index, relationship] of map.relationships.entries()) {
      if (entryIds.has(relationship.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["relationships", index, "id"],
          message: `Duplicate relationship ID: ${relationship.id}`,
        });
      }
      entryIds.add(relationship.id);

      if (relationship.speakerId === relationship.listenerId) {
        ctx.addIssue({
          code: "custom",
          path: ["relationships", index],
          message: "A relationship cannot point from a character to itself",
        });
      }

      if (!ids.has(relationship.speakerId)) {
        ctx.addIssue({
          code: "custom",
          path: ["relationships", index, "speakerId"],
          message: `Unknown speaker character ID: ${relationship.speakerId}`,
        });
      }
      if (!ids.has(relationship.listenerId)) {
        ctx.addIssue({
          code: "custom",
          path: ["relationships", index, "listenerId"],
          message: `Unknown listener character ID: ${relationship.listenerId}`,
        });
      }

      const pair = `${relationship.speakerId}\u0000${relationship.listenerId}`;
      if (directedPairs.has(pair)) {
        ctx.addIssue({
          code: "custom",
          path: ["relationships", index],
          message: "Duplicate directed speaker/listener pair",
        });
      }
      directedPairs.add(pair);
    }
  });

export type RelationshipGender = z.infer<typeof relationshipGenderSchema>;
export type SpeakerStatus = z.infer<typeof speakerStatusSchema>;
export type Familiarity = z.infer<typeof familiaritySchema>;
export type CharacterProfile = z.infer<typeof characterProfileSchema>;
export type CharacterRelationship = z.infer<typeof characterRelationshipSchema>;
export type RelationshipMapV1 = z.infer<typeof relationshipMapSchema>;

/** Provider output for one source window. IDs are deliberately not model-owned. */
const relationshipAnalysisCharacterSchema = z.object({
  sourceName: boundedNameSchema,
  targetName: nullableNameSchema.default(null),
  aliases: z.array(boundedNameSchema).max(MAX_CHARACTER_ALIASES).default([]),
  gender: relationshipGenderSchema.default("unknown"),
  role: nullableRelationshipTextSchema.default(null),
  notes: nullableNotesSchema.default(null),
  evidence: z.string().trim().min(1).max(MAX_EVIDENCE_LENGTH),
});

const relationshipAnalysisRelationshipSchema = z.object({
  speaker: boundedNameSchema,
  listener: boundedNameSchema,
  relationship: z.string().trim().min(1).max(MAX_RELATIONSHIP_TEXT_LENGTH),
  speakerStatus: speakerStatusSchema.default("unknown"),
  familiarity: familiaritySchema.default("unknown"),
  register: nullableRelationshipTextSchema.default(null),
  notes: nullableNotesSchema.default(null),
  evidence: z.string().trim().min(1).max(MAX_EVIDENCE_LENGTH),
});

const relationshipAnalysisActivePairSchema = z.object({
  speaker: boundedNameSchema,
  listener: boundedNameSchema,
  evidence: z.string().trim().min(1).max(MAX_EVIDENCE_LENGTH),
});

export const relationshipAnalysisSchema = z.object({
  characters: z.array(relationshipAnalysisCharacterSchema).max(MAX_RELATIONSHIP_CHARACTERS),
  relationships: z.array(relationshipAnalysisRelationshipSchema).max(MAX_RELATIONSHIPS),
  activePairs: z.array(relationshipAnalysisActivePairSchema).max(MAX_RELATIONSHIPS),
});

export type RelationshipAnalysisCharacter = z.infer<typeof relationshipAnalysisCharacterSchema>;
export type RelationshipAnalysisRelationship = z.infer<
  typeof relationshipAnalysisRelationshipSchema
>;
export type RelationshipAnalysisActivePair = z.infer<typeof relationshipAnalysisActivePairSchema>;
export type RelationshipAnalysis = z.infer<typeof relationshipAnalysisSchema>;

export interface ApprovedCharacterMapping {
  source: string;
  target: string;
}

export function normalizeIdentity(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export const relationshipEntryTypeSchema = z.enum(["character", "relationship"]);

export const getRelationshipMapSchema = z.object({
  novelId: z.string().trim().min(1),
});

export const upsertCharacterProfileSchema = z.object({
  novelId: z.string().trim().min(1),
  id: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
  sourceName: boundedNameSchema,
  targetName: nullableNameSchema.default(null),
  aliases: z.array(boundedNameSchema).max(MAX_CHARACTER_ALIASES).default([]),
  gender: relationshipGenderSchema.default("unknown"),
  role: nullableRelationshipTextSchema.default(null),
  notes: nullableNotesSchema.default(null),
  evidence: nullableEvidenceSchema.default(null),
});

export const upsertCharacterRelationshipSchema = z.object({
  novelId: z.string().trim().min(1),
  id: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
  speakerId: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  listenerId: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  relationship: boundedRelationshipTextSchema.min(1),
  speakerStatus: speakerStatusSchema.default("unknown"),
  familiarity: familiaritySchema.default("unknown"),
  selfPronoun: nullableSpeechFieldSchema.default(null),
  addresseeTerm: nullableSpeechFieldSchema.default(null),
  sentenceParticles: nullableSpeechFieldSchema.default(null),
  register: nullableRelationshipTextSchema.default(null),
  notes: nullableNotesSchema.default(null),
  evidence: nullableEvidenceSchema.default(null),
});

export const setRelationshipEntryEnabledSchema = z.object({
  novelId: z.string().trim().min(1),
  entryType: relationshipEntryTypeSchema,
  entryId: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  enabled: z.boolean(),
});

export const setRelationshipEntryAutoManagedSchema = z.object({
  novelId: z.string().trim().min(1),
  entryType: relationshipEntryTypeSchema,
  entryId: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});

export const deleteRelationshipEntrySchema = z.object({
  novelId: z.string().trim().min(1),
  entryType: relationshipEntryTypeSchema,
  entryId: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});

export type UpsertCharacterProfileInput = z.infer<typeof upsertCharacterProfileSchema>;
export type UpsertCharacterRelationshipInput = z.infer<typeof upsertCharacterRelationshipSchema>;
export type SetRelationshipEntryEnabledInput = z.infer<typeof setRelationshipEntryEnabledSchema>;
export type SetRelationshipEntryAutoManagedInput = z.infer<
  typeof setRelationshipEntryAutoManagedSchema
>;
export type DeleteRelationshipEntryInput = z.infer<typeof deleteRelationshipEntrySchema>;
