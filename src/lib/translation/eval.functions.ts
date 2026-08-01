import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { ensureSession } from "@/lib/auth.functions";
import { db } from "@/lib/db";
import { novels, translationEvalReports } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { SafeServerError, withSafeHandler } from "@/lib/server-fn-error";

const runEvalSchema = z.object({
  novelId: z.string().min(1),
  chapterSelector: z.string().trim().min(1).default("first3"),
});
const listEvalSchema = z.object({ novelId: z.string().min(1) });

export const startTranslationEval = createServerFn({ method: "POST" })
  .validator(runEvalSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);
      if (!novel) throw new SafeServerError("Novel not found");

      const reportId = nanoid();
      await db.insert(translationEvalReports).values({
        id: reportId,
        novelId: data.novelId,
        status: "pending",
        chapterSelector: data.chapterSelector,
      });
      await inngest.send({
        name: "translation/eval.requested",
        data: { reportId, runKey: nanoid() },
      });
      return { reportId };
    }),
  );

export const listTranslationEvalReports = createServerFn({ method: "GET" })
  .validator(listEvalSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);
      if (!novel) throw new SafeServerError("Novel not found");

      return await db
        .select()
        .from(translationEvalReports)
        .where(eq(translationEvalReports.novelId, data.novelId))
        .orderBy(desc(translationEvalReports.createdAt))
        .limit(10);
    }),
  );
