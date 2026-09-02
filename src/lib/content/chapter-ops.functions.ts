import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { ensureSession } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import {
  deleteAllNovelTranslationsForUser,
  getResidualScriptChaptersForUser,
  translateMissingTitlesForUser,
} from "@/lib/content/chapter-ops.service";

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
      const session = await ensureSession();
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
