import { createFileRoute } from "@tanstack/react-router";

import { AccountAudiencePage } from "@/components/studio/analytics/account-audience-page";
import { DEFAULT_AUDIENCE_RANGE } from "@/lib/analytics/aggregate";
import { accountAudienceQueryOptions } from "@/lib/analytics/query";
import { headTranslator } from "@/lib/i18n/route-head";

/**
 * The account's audience across every novel it owns. Like the other work areas (`/jobs`,
 * `/settings`) it has no language in its URL: it is an unshared, unindexed page, and its
 * copy comes from the remembered locale.
 *
 * Protected rather than public: the report is the session's own novels, so a guest has
 * nothing to see and the route gate says so before the query would throw.
 */
export const Route = createFileRoute("/_protected/audience")({
  loader: async ({ context }) => {
    // The page opens on the same window the loader does, so the first paint is the report
    // rather than a spinner over it.
    await context.queryClient.ensureQueryData(accountAudienceQueryOptions(DEFAULT_AUDIENCE_RANGE));
  },
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [{ title: `${t("meta.audience")} | ${t("meta.siteName")}` }],
    };
  },
  component: AccountAudienceRoute,
});

function AccountAudienceRoute() {
  return <AccountAudiencePage />;
}
