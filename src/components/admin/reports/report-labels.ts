import type { useTranslations } from "use-intl";

import { reportReasonKey, reportStatusKey, reportTargetKey } from "@/lib/reports/reasons";

/**
 * The translator the report vocabulary is read through.
 *
 * Which reasons, statuses and target types exist is `reports.*`, the same namespace the
 * dialog a member files a report through reads; the queue's own copy is `admin.*`.
 */
export type ReportsTranslator = ReturnType<typeof useTranslations<"reports">>;

/**
 * The words for a stored value, in the reader's language.
 *
 * Each falls back to the raw value, which is what keeps a report filed by a newer deploy
 * readable here: a reason this release does not know still renders as `new_reason` rather
 * than as a blank cell an operator cannot act on.
 */
export function reportReasonLabel(t: ReportsTranslator, reason: string): string {
  const key = reportReasonKey(reason);
  return key ? t(key) : reason;
}

export function reportStatusLabel(t: ReportsTranslator, status: string): string {
  const key = reportStatusKey(status);
  return key ? t(key) : status;
}

export function reportTargetLabel(t: ReportsTranslator, targetType: string): string {
  const key = reportTargetKey(targetType);
  return key ? t(key) : targetType;
}
