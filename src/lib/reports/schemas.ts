import { z } from "zod";

import { REPORT_DECISIONS, REPORT_REASONS } from "./reasons";

/** Long enough for a description of the problem, short enough to read in one look. */
export const REPORT_DETAILS_MAX_LENGTH = 1000;
export const REPORT_NOTE_MAX_LENGTH = 500;
export const REPORT_SEARCH_MAX_LENGTH = 200;
export const REPORT_CASE_PAGE_SIZE = 25;
export const REPORT_HISTORY_PAGE_SIZE = 25;
/** How many individual reports a case file carries; the count above it is exact. */
export const REPORT_CASE_DETAIL_LIMIT = 20;

/**
 * Reports one account may file per hour. Well above what a reader needs and below what
 * a script can use to bury a queue; duplicates of the same novel are refused outright
 * by the partial unique index rather than by this.
 */
export const REPORT_RATE_LIMIT_PER_HOUR = 10;

/** The queue's two views: cases still needing a decision, and decided ones. */
export const REPORT_QUEUE_TABS = ["open", "history"] as const;

export type ReportQueueTab = (typeof REPORT_QUEUE_TABS)[number];

/**
 * What a member sends when reporting a novel.
 *
 * `other` has to say what is wrong: the operator has nothing else to go on, so the
 * reason and the explanation are checked together rather than in the dialog alone.
 */
export const createNovelReportSchema = z
  .object({
    novelId: z.string().min(1),
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(REPORT_DETAILS_MAX_LENGTH).optional(),
  })
  .refine((value) => value.reason !== "other" || Boolean(value.details), {
    path: ["details"],
    message: "Tell us what is wrong so an operator can act on it",
  });

export type CreateNovelReportInput = z.infer<typeof createNovelReportSchema>;

/** The novel a member is asking about; their own open report, if any, is the answer. */
export const novelReportLookupSchema = z.object({ novelId: z.string().min(1) });

/**
 * Search and paging for the operator queue. Every field carries a `.catch`, so a
 * hand-edited or stale URL degrades to the default view instead of throwing a
 * validation error at the router.
 */
export const reportQueueSearchSchema = z.object({
  tab: z.enum(REPORT_QUEUE_TABS).optional().catch(undefined),
  q: z.string().max(REPORT_SEARCH_MAX_LENGTH).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
  pageSize: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
});

export type ReportQueueSearch = z.infer<typeof reportQueueSearchSchema>;
export type ReportQueueSearchInput = z.input<typeof reportQueueSearchSchema>;

export const reportQueueInputSchema = reportQueueSearchSchema.transform((value) => ({
  tab: value.tab ?? "open",
  q: value.q?.trim() ?? "",
  page: value.page ?? 1,
  pageSize: value.pageSize ?? REPORT_CASE_PAGE_SIZE,
}));

export type ReportQueueInput = z.infer<typeof reportQueueInputSchema>;

/**
 * A case as the queue addresses it.
 *
 * For a novel report this is the novel id. When the reported novel has been deleted
 * the case has no novel left to address, so it is keyed by a report of its own - see
 * `resolveReportCaseForOperator`, which accepts either.
 */
export const resolveReportCaseSchema = z
  .object({
    caseKey: z.string().min(1),
    decision: z.enum(REPORT_DECISIONS),
    note: z.string().trim().max(REPORT_NOTE_MAX_LENGTH).optional(),
  })
  .refine((value) => value.decision !== "upheld" || Boolean(value.note), {
    path: ["note"],
    message: "Say what was wrong with it, so the decision reads on its own",
  });

export type ResolveReportCaseInput = z.infer<typeof resolveReportCaseSchema>;
