import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { recordAdminAction } from "@/lib/admin/audit.server";
import { ensureAdminSession, getSession } from "@/lib/auth/functions";
import { checkRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { withSafeHandler } from "@/lib/server-fn-error";
import { mergeAuthorsSchema } from "@/lib/content/novel/catalog.schemas";
import {
  getAuthorForViewer,
  mergeAuthorsForOperator,
  searchAuthorsForOperator,
} from "@/lib/content/novel/author.service.server";

/**
 * An author's page header: their name and how many live novels a guest can reach.
 *
 * Returns null rather than refusing, because an unknown author is a missing page — the route
 * turns that into `notFound()` — while a failure stays a failure.
 */
export const getAuthor = createServerFn({ method: "GET" })
  .validator(z.object({ authorId: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);
      return getAuthorForViewer(data.authorId);
    });
  });

/**
 * Author candidates for a merge. Operators only: the list is an account-free directory of
 * everyone who has ever been named as an author, which is not a public read.
 */
export const searchAuthors = createServerFn({ method: "GET" })
  .validator(z.object({ term: z.string().min(2).max(80) }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      await ensureAdminSession();
      return searchAuthorsForOperator(data.term);
    });
  });

/**
 * Folds one author into another. Operators only, and every merge is audited.
 *
 * The audit write happens after the merge and is never allowed to report the merge as
 * failed: the duplication is already gone, and telling an operator otherwise would invite a
 * second attempt at something that no longer exists.
 */
export const mergeAuthors = createServerFn({ method: "POST" })
  .validator(mergeAuthorsSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureAdminSession();
      const result = await mergeAuthorsForOperator(data.fromAuthorId, data.intoAuthorId);

      await recordAdminAction({
        actorId: session.user.id,
        actorEmail: session.user.email ?? null,
        action: "author.merged",
        detail: {
          fromAuthorId: data.fromAuthorId,
          intoAuthorId: data.intoAuthorId,
          moved: result.moved,
          name: result.name,
        },
      });

      return result;
    });
  });
