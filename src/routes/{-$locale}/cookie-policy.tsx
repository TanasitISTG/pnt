import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { AppShell } from "@/components/app-shell";
import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { privacyPolicyLink, termsOfServiceLink } from "@/components/legal/legal-footer-links";
import { headTranslator } from "@/lib/i18n/route-head";

export const Route = createFileRoute("/{-$locale}/cookie-policy")({
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [
        { title: `${t("meta.cookiePolicy")} | ${t("meta.siteName")}` },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: CookiePolicyPage,
});

function CookiePolicyPage() {
  const { user } = Route.useRouteContext();
  const t = useTranslations("legal");

  return (
    <AppShell user={user}>
      <LegalDocumentPage
        id="cookiePolicy"
        footer={t.rich("seePrivacyPolicyAndTerms", {
          privacy: privacyPolicyLink,
          terms: termsOfServiceLink,
        })}
      />
    </AppShell>
  );
}
