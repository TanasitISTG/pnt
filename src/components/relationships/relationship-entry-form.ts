import { z } from "zod";

import { encodeMessage } from "@/lib/i18n/message-code";
import {
  MAX_CHARACTER_ALIASES,
  MAX_EVIDENCE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_RELATIONSHIP_TEXT_LENGTH,
  MAX_SPEECH_FIELD_LENGTH,
  familiaritySchema,
  relationshipGenderSchema,
  speakerStatusSchema,
  type Familiarity,
  type RelationshipGender,
  type SpeakerStatus,
} from "@/lib/relationships/schemas";

export interface CharacterFormState {
  sourceName: string;
  targetName: string;
  aliases: string;
  gender: RelationshipGender;
  role: string;
  notes: string;
  evidence: string;
}

export interface RelationshipFormState {
  speakerId: string;
  listenerId: string;
  relationship: string;
  speakerStatus: SpeakerStatus;
  familiarity: Familiarity;
  selfPronoun: string;
  addresseeTerm: string;
  sentenceParticles: string;
  register: string;
  notes: string;
  evidence: string;
}

export const EMPTY_CHARACTER_FORM: CharacterFormState = {
  sourceName: "",
  targetName: "",
  aliases: "",
  gender: "unknown",
  role: "",
  notes: "",
  evidence: "",
};

export const EMPTY_RELATIONSHIP_FORM: RelationshipFormState = {
  speakerId: "",
  listenerId: "",
  relationship: "",
  speakerStatus: "unknown",
  familiarity: "unknown",
  selfPronoun: "",
  addresseeTerm: "",
  sentenceParticles: "",
  register: "",
  notes: "",
  evidence: "",
};

export function splitAliases(value: string): string[] {
  return value
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

// A schema is a module: it has no reader at the moment it runs, so each message is a key the field
// resolves in the reader's language (`lib/i18n/message-code.ts`). The limit travels as a value,
// which is why the sentence can name it without the schema knowing what language the reader reads.
export const characterEntryFormSchema = z
  .object({
    sourceName: z
      .string()
      .trim()
      .min(1, encodeMessage("validation.relationshipSourceNameRequired"))
      .max(MAX_NAME_LENGTH),
    targetName: z.string().max(MAX_NAME_LENGTH),
    aliases: z.string().superRefine((value, context) => {
      const aliases = splitAliases(value);
      if (aliases.length > MAX_CHARACTER_ALIASES) {
        context.addIssue({
          code: "custom",
          message: encodeMessage("validation.relationshipAliasesTooMany", {
            max: MAX_CHARACTER_ALIASES,
          }),
        });
      }
      if (aliases.some((alias) => alias.length > MAX_NAME_LENGTH)) {
        context.addIssue({
          code: "custom",
          message: encodeMessage("validation.relationshipAliasTooLong", {
            max: MAX_NAME_LENGTH,
          }),
        });
      }
    }),
    gender: relationshipGenderSchema,
    role: z.string().max(MAX_RELATIONSHIP_TEXT_LENGTH),
    notes: z.string().max(MAX_NOTES_LENGTH),
    evidence: z.string().max(MAX_EVIDENCE_LENGTH),
  })
  .transform((value) => ({
    sourceName: value.sourceName.trim(),
    targetName: value.targetName.trim() || null,
    aliases: splitAliases(value.aliases),
    gender: value.gender,
    role: value.role.trim() || null,
    notes: value.notes.trim() || null,
    evidence: value.evidence.trim() || null,
  }));

export const relationshipEntryFormSchema = z
  .object({
    speakerId: z
      .string()
      .trim()
      .min(1, encodeMessage("validation.relationshipSpeakerRequired"))
      .max(MAX_NAME_LENGTH),
    listenerId: z
      .string()
      .trim()
      .min(1, encodeMessage("validation.relationshipListenerRequired"))
      .max(MAX_NAME_LENGTH),
    relationship: z
      .string()
      .trim()
      .min(1, encodeMessage("validation.relationshipKindRequired"))
      .max(MAX_RELATIONSHIP_TEXT_LENGTH),
    speakerStatus: speakerStatusSchema,
    familiarity: familiaritySchema,
    selfPronoun: z.string().max(MAX_SPEECH_FIELD_LENGTH),
    addresseeTerm: z.string().max(MAX_SPEECH_FIELD_LENGTH),
    sentenceParticles: z.string().max(MAX_SPEECH_FIELD_LENGTH),
    register: z.string().max(MAX_RELATIONSHIP_TEXT_LENGTH),
    notes: z.string().max(MAX_NOTES_LENGTH),
    evidence: z.string().max(MAX_EVIDENCE_LENGTH),
  })
  .refine((value) => value.speakerId !== value.listenerId, {
    message: encodeMessage("validation.relationshipPairSame"),
    path: ["listenerId"],
  })
  .transform((value) => ({
    speakerId: value.speakerId,
    listenerId: value.listenerId,
    relationship: value.relationship.trim(),
    speakerStatus: value.speakerStatus,
    familiarity: value.familiarity,
    selfPronoun: value.selfPronoun.trim() || null,
    addresseeTerm: value.addresseeTerm.trim() || null,
    sentenceParticles: value.sentenceParticles.trim() || null,
    register: value.register.trim() || null,
    notes: value.notes.trim() || null,
    evidence: value.evidence.trim() || null,
  }));
