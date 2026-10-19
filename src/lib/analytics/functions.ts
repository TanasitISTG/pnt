import { createServerFn } from "@tanstack/react-start";

import { ensureSessionForRead } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import { getAccountAudienceForUser } from "./account-audience.server";
import { getNovelAudienceForUser } from "./novel-analytics.server";
import { accountAudienceInputSchema, audienceInputSchema } from "./schemas";

/**
 * The owner's report is workspace information, not a public statistic: the service only
 * answers for a novel the session owns. It reads through `ensureSessionForRead` rather than a
 * mutation's gate, so an operator viewing an account sees the same numbers the owner would.
 *
 * The range travels with the request because it changes the answer: the read figures are the
 * selected window's, and the curve is that window's days.
 */
export const getNovelAudience = createServerFn({ method: "GET" })
  .validator(audienceInputSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return getNovelAudienceForUser(session.user.id, data.novelId, data.range);
    }),
  );

/**
 * The account-wide rollup. Its only filter is the range; the novel ids in the query are the
 * ones the server looked up for that session, never ids the client sent.
 */
export const getAccountAudience = createServerFn({ method: "GET" })
  .validator(accountAudienceInputSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return getAccountAudienceForUser(session.user.id, data.range);
    }),
  );
