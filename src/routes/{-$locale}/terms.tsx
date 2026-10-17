import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { AppShell } from "@/components/app-shell";
import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { cookiePolicyLink, privacyPolicyLink } from "@/components/legal/legal-footer-links";
import { headTranslator } from "@/lib/i18n/route-head";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

export const Route = createFileRoute("/{-$locale}/terms")({
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [
        { title: `${t("meta.terms")} | ${t("meta.siteName")}` },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: TermsPage,
});

function TermsPage() {
  const { user } = Route.useRouteContext();
  const t = useTranslations("legal");

  return (
    <AppShell user={user}>
      <LegalDocumentPage
        id="terms"
        // The version a new account accepts, so the wording can always be tied to the
        // acceptance recorded on the account.
        version={CURRENT_TERMS_VERSION}
        footer={t.rich("seePrivacyPolicyAndCookiePolicy", {
          privacy: privacyPolicyLink,
          cookie: cookiePolicyLink,
        })}
      />
    </AppShell>
  );
}
