import { createServerFn } from "@tanstack/react-start";

import { ensureSession, getSession } from "@/lib/auth/functions";
import { checkRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { withSafeHandler } from "@/lib/server-fn-error";
import { setNovelTagsSchema } from "@/lib/content/novel/catalog.schemas";
import { listCatalogTags, setNovelTagsForUser } from "@/lib/content/novel/tag.service.server";

/** The vocabulary behind the catalog's filter row, counted over live novels only. */
export const getCatalogTags = createServerFn({ method: "GET" }).handler(async () => {
  return withSafeHandler(async () => {
    const session = await getSession();
    if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);
    return listCatalogTags();
  });
});

/**
 * Replaces the tags a novel carries. Ownership is checked inside the service, against the
 * same novel/user join every other content mutation uses, and the set is converged in one
 * transaction rather than applied as a client-supplied diff.
 */
export const setNovelTags = createServerFn({ method: "POST" })
  .validator(setNovelTagsSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return setNovelTagsForUser(session.user.id, data);
    });
  });
