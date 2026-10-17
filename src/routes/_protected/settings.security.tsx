import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { ActiveSessionsCard } from "@/components/profile/active-sessions-card";
import { DeleteAccountCard } from "@/components/profile/delete-account-card";
import { SettingsSection } from "@/components/settings/settings-section";
import { ChangePasswordCard } from "@/components/settings/change-password-card";
import { headTranslator } from "@/lib/i18n/route-head";
import { translateServerError } from "@/lib/i18n/server-error";
import { changePassword } from "@/lib/settings/functions";
import type { ChangePasswordInput } from "@/lib/settings/schemas";

export const Route = createFileRoute("/_protected/settings/security")({
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [{ title: `${t("meta.settingsSecurity")} | ${t("meta.siteName")}` }],
    };
  },
  component: SecuritySettingsPage,
});

/**
 * Security: the password, the sessions, and the one irreversible action — in that order,
 * so deletion is the last thing on the screen rather than the middle of a settings page.
 */
function SecuritySettingsPage() {
  const t = useTranslations("settings");
  const tRoot = useTranslations();
  const { user } = Route.useRouteContext();

  const handleChangePassword = async (data: ChangePasswordInput): Promise<boolean> => {
    try {
      await changePassword({ data });
      toast.success(t("passwordUpdated"));
      return true;
    } catch (err: unknown) {
      toast.error(translateServerError(err, tRoot, t("passwordUpdateFailed")));
      return false;
    }
  };

  return (
    <SettingsSection title={t("securityTitle")} description={t("securityDescription")}>
      <ChangePasswordCard onSubmit={handleChangePassword} />

      <ActiveSessionsCard />

      <DeleteAccountCard email={user.email} />
    </SettingsSection>
  );
}
