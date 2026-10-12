import { createServerFn } from "@tanstack/react-start";

// Reading reports is an owner-scoped read, so it stays available to an operator
// viewing the account; starting a run is a write and stays refused.
import { ensureSession, ensureSessionForRead } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import {
  getTranslationEvalReportForUser,
  listTranslationEvalReportsForUser,
  queueTranslationEvalForUser,
} from "@/lib/translation/evaluation/eval.service";
import {
  getTranslationEvalReportSchema,
  listTranslationEvalReportsSchema,
  startTranslationEvalSchema,
} from "@/lib/translation/evaluation/eval.schemas";

export const startTranslationEval = createServerFn({ method: "POST" })
  .validator(startTranslationEvalSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return queueTranslationEvalForUser(session.user.id, data);
    }),
  );

export const listTranslationEvalReports = createServerFn({ method: "GET" })
  .validator(listTranslationEvalReportsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return listTranslationEvalReportsForUser(session.user.id, data.novelId);
    }),
  );

export const getTranslationEvalReport = createServerFn({ method: "GET" })
  .validator(getTranslationEvalReportSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return getTranslationEvalReportForUser(session.user.id, data);
    }),
  );
