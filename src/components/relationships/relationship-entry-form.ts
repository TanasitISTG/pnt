import { z } from "zod";

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

export const characterEntryFormSchema = z
  .object({
    sourceName: z.string().trim().min(1, "Source name is required").max(MAX_NAME_LENGTH),
    targetName: z.string().max(MAX_NAME_LENGTH),
    aliases: z.string().superRefine((value, context) => {
      const aliases = splitAliases(value);
      if (aliases.length > MAX_CHARACTER_ALIASES) {
        context.addIssue({
          code: "custom",
          message: `Aliases can contain at most ${MAX_CHARACTER_ALIASES} names`,
        });
      }
      if (aliases.some((alias) => alias.length > MAX_NAME_LENGTH)) {
        context.addIssue({
          code: "custom",
          message: `Each alias must be ${MAX_NAME_LENGTH} characters or fewer`,
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
    speakerId: z.string().trim().min(1, "Speaker is required").max(MAX_NAME_LENGTH),
    listenerId: z.string().trim().min(1, "Listener is required").max(MAX_NAME_LENGTH),
    relationship: z
      .string()
      .trim()
      .min(1, "Relationship is required")
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
    message: "Speaker and listener must be different characters",
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
