import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { AppShell } from "@/components/app-shell";
import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { cookiePolicyLink, termsOfServiceLink } from "@/components/legal/legal-footer-links";
import { headTranslator } from "@/lib/i18n/route-head";

export const Route = createFileRoute("/{-$locale}/privacy")({
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [
        { title: `${t("meta.privacy")} | ${t("meta.siteName")}` },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: PrivacyPage,
});

function PrivacyPage() {
  const { user } = Route.useRouteContext();
  const t = useTranslations("legal");

  return (
    <AppShell user={user}>
      <LegalDocumentPage
        id="privacy"
        footer={t.rich("seeCookiePolicyAndTerms", {
          cookie: cookiePolicyLink,
          terms: termsOfServiceLink,
        })}
      />
    </AppShell>
  );
}
