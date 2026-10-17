import type { useTranslations } from "use-intl";

import type { Familiarity, RelationshipGender, SpeakerStatus } from "@/lib/relationships/schemas";

/**
 * The `relationships` translator, named so a label builder can take one as an argument.
 *
 * A label builder is not a component and cannot call a hook itself, and the keys it reads
 * are still checked against the catalog through this type.
 */
export type RelationshipsTranslator = ReturnType<typeof useTranslations<"relationships">>;

/**
 * The words for the three enumerations a character or a relationship carries.
 *
 * They live here rather than in either table or either form because both sides show them:
 * the row renders the stored value and the form offers it as a choice, and the two have to
 * agree — a row that reads "female" beside a form that says "หญิง" is the same fact told
 * twice in two languages.
 */
export function genderLabels(t: RelationshipsTranslator): Record<RelationshipGender, string> {
  return {
    male: t("genderMale"),
    female: t("genderFemale"),
    nonbinary: t("genderNonbinary"),
    unknown: t("genderUnknown"),
  };
}

export function speakerStatusLabels(t: RelationshipsTranslator): Record<SpeakerStatus, string> {
  return {
    lower: t("speakerStatusLower"),
    peer: t("speakerStatusPeer"),
    higher: t("speakerStatusHigher"),
    unknown: t("speakerStatusUnknown"),
  };
}

export function familiarityLabels(t: RelationshipsTranslator): Record<Familiarity, string> {
  return {
    intimate: t("familiarityIntimate"),
    close: t("familiarityClose"),
    familiar: t("familiarityFamiliar"),
    distant: t("familiarityDistant"),
    unknown: t("familiarityUnknown"),
  };
}
