import { createServerFn } from "@tanstack/react-start";

import { ensureAdminSession, ensureSession, ensureSessionForRead } from "@/lib/auth/functions";
import { checkRateLimitForSubject } from "@/lib/rate-limit";
import { withSafeHandler } from "@/lib/server-fn-error";

import {
  countOpenReportCases,
  createCommentReportForUser,
  createNovelReportForUser,
  createReviewReportForUser,
  getOpenNovelReportForUser,
  listReportCases,
  listReportHistory,
  removeReportedTargetForOperator,
  resolveReportCaseForOperator,
} from "./report.service.server";
import {
  REPORT_RATE_LIMIT_PER_HOUR,
  createCommentReportSchema,
  createNovelReportSchema,
  createReviewReportSchema,
  novelReportLookupSchema,
  removeReportedTargetSchema,
  reportQueueInputSchema,
  resolveReportCaseSchema,
} from "./schemas";

/**
 * Report endpoints.
 *
 * Filing is a mutation by a signed-in member and is metered per account: the queue is
 * worked by hand, so the only real abuse is a script filling it. Everything else here
 * either answers the reporter's own question or is operator work behind
 * `ensureAdminSession`, which also refuses an operator viewing as another account.
 */

async function meterReport(reporterId: string): Promise<void> {
  await checkRateLimitForSubject("report", reporterId, REPORT_RATE_LIMIT_PER_HOUR, 60 * 60_000);
}

export const createNovelReport = createServerFn({ method: "POST" })
  .validator(createNovelReportSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await meterReport(session.user.id);
      return createNovelReportForUser(session.user.id, data);
    }),
  );

/** Reporting a chapter comment. The same meter covers every target type. */
export const createCommentReport = createServerFn({ method: "POST" })
  .validator(createCommentReportSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await meterReport(session.user.id);
      return createCommentReportForUser(session.user.id, data);
    }),
  );

/** Reporting a novel review. */
export const createReviewReport = createServerFn({ method: "POST" })
  .validator(createReviewReportSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await meterReport(session.user.id);
      return createReviewReportForUser(session.user.id, data);
    }),
  );

/**
 * The reporter's own open report on one novel. A read, so it uses
 * `ensureSessionForRead` and keeps working while an operator views an account.
 */
export const getMyNovelReport = createServerFn({ method: "GET" })
  .validator(novelReportLookupSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return { report: await getOpenNovelReportForUser(session.user.id, data.novelId) };
    }),
  );

export const listReportCaseQueue = createServerFn({ method: "GET" })
  .validator(reportQueueInputSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      await ensureAdminSession();
      return listReportCases(data);
    }),
  );

export const listDecidedReports = createServerFn({ method: "GET" })
  .validator(reportQueueInputSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      await ensureAdminSession();
      return listReportHistory(data);
    }),
  );

export const getReportQueueCounts = createServerFn({ method: "GET" }).handler(() =>
  withSafeHandler(async () => {
    await ensureAdminSession();
    return { openCases: await countOpenReportCases() };
  }),
);

export const resolveReportCase = createServerFn({ method: "POST" })
  .validator(resolveReportCaseSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureAdminSession();
      return resolveReportCaseForOperator({ id: session.user.id, email: session.user.email }, data);
    }),
  );

/**
 * The operator's separate enforcement step: take a reported comment or review down. It is
 * deliberately not part of the decision, and it appends its own audit row.
 */
export const removeReportedTarget = createServerFn({ method: "POST" })
  .validator(removeReportedTargetSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureAdminSession();
      return removeReportedTargetForOperator(
        { id: session.user.id, email: session.user.email },
        data,
      );
    }),
  );

export type {
  MyNovelReport,
  ReportCase,
  ReportCaseEntry,
  ReportCasePage,
  ReportCaseTarget,
  ReportHistoryPage,
  ReportHistoryRow,
} from "./types";
