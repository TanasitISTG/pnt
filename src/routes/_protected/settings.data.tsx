import { createFileRoute, redirect } from "@tanstack/react-router";

import { BackupCard } from "@/components/settings/backup-card";
import { SettingsSection } from "@/components/settings/settings-section";
import { hasAdminRole } from "@/lib/auth/roles";

export const Route = createFileRoute("/_protected/settings/data")({
  // The section is operator-only, so the URL has to refuse as well as the nav omitting it.
  beforeLoad: ({ context }) => {
    if (!hasAdminRole(context.user?.role)) throw redirect({ to: "/settings" });
  },
  head: () => ({
    meta: [{ title: "Data | Pnt - Personal Novel Translator" }],
  }),
  component: DataSettingsPage,
});

function DataSettingsPage() {
  return (
    <SettingsSection
      title="Data"
      description="Take a copy of your novels, chapters, covers and glossary, or bring one back."
    >
      <BackupCard />
    </SettingsSection>
  );
}
