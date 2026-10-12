import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// The residual-script scan is an owner-scoped read, so it authenticates the same way
// every other read does and keeps working while an operator views the account.
import { ensureSession, ensureSessionForRead } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import {
  deleteAllNovelTranslationsForUser,
  getResidualScriptChaptersForUser,
  translateMissingTitlesForUser,
} from "@/lib/content/chapter/chapter-ops.service";

export const translateMissingTitles = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return translateMissingTitlesForUser(session.user.id, data.novelId);
    }),
  );

export const getResidualScriptChapters = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return getResidualScriptChaptersForUser(session.user.id, data.novelId);
    });
  });

export const deleteAllNovelTranslations = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return deleteAllNovelTranslationsForUser(session.user.id, data.novelId);
    }),
  );
