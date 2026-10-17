/**
 * The report vocabulary, in a module both graphs can import.
 *
 * The dialog that files a report, the queue that reads it, and the operator screens
 * have to agree on the set of reasons and how each one reads, so the names and labels
 * live here rather than in any one of them - the same split as `src/lib/admin/audit.ts`.
 */

export const REPORT_REASONS = [
  "copyright",
  "sexual_content",
  "sexual_cover",
  "hate_or_harassment",
  "spam_or_scam",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["open", "upheld", "dismissed"] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The decisions an operator can take on a case. `open` is not one of them. */
export const REPORT_DECISIONS = ["upheld", "dismissed"] as const;

export type ReportDecision = (typeof REPORT_DECISIONS)[number];

/**
 * What a report points at: a novel, a chapter comment, or a novel review. Each type owns
 * one nullable column on the report (`novel_id`, `comment_id`, `review_id`), which is what
 * keeps the case key and the one-open-report indexes unambiguous, and every read of a
 * report goes through the target helpers rather than assuming a novel.
 */
export const REPORT_TARGET_TYPES = ["novel", "comment", "review"] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/**
 * The `reports` catalog key each reason, status and target type reads as.
 *
 * A key rather than a sentence: this module is shared by the dialog that files a report,
 * the queue that decides it, and the social preview of a chapter, and none of those can
 * agree on a language before a reader exists. The maps are exported so a caller holding a
 * known value (the filing form iterating `REPORT_REASONS`) can index them without a null
 * check, while a value off the wire goes through the lookup functions below.
 */
export const REPORT_REASON_KEYS = {
  copyright: "reasonCopyright",
  sexual_content: "reasonSexualContent",
  sexual_cover: "reasonSexualCover",
  hate_or_harassment: "reasonHateOrHarassment",
  spam_or_scam: "reasonSpamOrScam",
  other: "reasonOther",
} as const satisfies Record<ReportReason, string>;

export const REPORT_STATUS_KEYS = {
  open: "statusOpen",
  upheld: "statusUpheld",
  dismissed: "statusDismissed",
} as const satisfies Record<ReportStatus, string>;

export const REPORT_TARGET_KEYS = {
  novel: "targetNovel",
  comment: "targetComment",
  review: "targetReview",
} as const satisfies Record<ReportTargetType, string>;

export type ReportReasonKey = (typeof REPORT_REASON_KEYS)[ReportReason];
export type ReportStatusKey = (typeof REPORT_STATUS_KEYS)[ReportStatus];
export type ReportTargetKey = (typeof REPORT_TARGET_KEYS)[ReportTargetType];

/**
 * The key a stored reason reads as, or null when this release does not know the reason.
 *
 * Every caller falls back to the raw value, so a report filed by a newer deploy reaches an
 * operator as something readable rather than as a blank cell.
 */
export function reportReasonKey(reason: string): ReportReasonKey | null {
  return isReportReason(reason) ? REPORT_REASON_KEYS[reason] : null;
}

export function reportStatusKey(status: string): ReportStatusKey | null {
  return isReportStatus(status) ? REPORT_STATUS_KEYS[status] : null;
}

export function reportTargetKey(targetType: string): ReportTargetKey | null {
  return isReportTargetType(targetType) ? REPORT_TARGET_KEYS[targetType] : null;
}

export function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}

export function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value);
}

export function isReportTargetType(value: string): value is ReportTargetType {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}
