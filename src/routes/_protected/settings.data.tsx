import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { BackupCard } from "@/components/settings/backup-card";
import { SettingsSection } from "@/components/settings/settings-section";
import { hasAdminRole } from "@/lib/auth/roles";
import { headTranslator } from "@/lib/i18n/route-head";

export const Route = createFileRoute("/_protected/settings/data")({
  // The section is operator-only, so the URL has to refuse as well as the nav omitting it.
  beforeLoad: ({ context }) => {
    if (!hasAdminRole(context.user?.role)) throw redirect({ to: "/settings" });
  },
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [{ title: `${t("meta.settingsData")} | ${t("meta.siteName")}` }],
    };
  },
  component: DataSettingsPage,
});

function DataSettingsPage() {
  const t = useTranslations("settings");

  return (
    <SettingsSection title={t("dataTitle")} description={t("dataDescription")}>
      <BackupCard />
    </SettingsSection>
  );
}
