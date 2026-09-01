import type { Familiarity, RelationshipGender, SpeakerStatus } from "@/lib/relationships/schemas";

export type CharacterFormState = {
  id?: string;
  sourceName: string;
  targetName: string;
  aliases: string;
  gender: RelationshipGender;
  role: string;
  notes: string;
  evidence: string;
};

export type RelationshipFormState = {
  id?: string;
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
};

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

export function toFieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field !== undefined && fieldErrors[String(field)] === undefined) {
      fieldErrors[String(field)] = issue.message;
    }
  }
  return fieldErrors;
}
