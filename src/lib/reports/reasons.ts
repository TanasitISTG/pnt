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

const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  copyright: "Copyright or a stolen translation",
  sexual_content: "Sexual content",
  sexual_cover: "Sexual or explicit cover",
  hate_or_harassment: "Hate or harassment",
  spam_or_scam: "Spam, scam, or misleading",
  other: "Something else",
};

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open",
  upheld: "Upheld",
  dismissed: "Dismissed",
};

const REPORT_TARGET_LABELS: Record<ReportTargetType, string> = {
  novel: "Novel",
  comment: "Comment",
  review: "Review",
};

/** Falls back to the raw value so a reason added later still renders something. */
export function describeReportReason(reason: string): string {
  return REPORT_REASON_LABELS[reason as ReportReason] ?? reason;
}

/** Falls back to the raw value so a status added later still renders something. */
export function describeReportStatus(status: string): string {
  return REPORT_STATUS_LABELS[status as ReportStatus] ?? status;
}

/** Falls back to the raw value so a target added later still renders something. */
export function describeReportTarget(targetType: string): string {
  return REPORT_TARGET_LABELS[targetType as ReportTargetType] ?? targetType;
}

export function describeReportDecision(decision: string): string {
  return decision === "dismissed" ? "Dismissed" : "Upheld";
}

export function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}
