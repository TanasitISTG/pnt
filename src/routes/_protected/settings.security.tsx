import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { ActiveSessionsCard } from "@/components/profile/active-sessions-card";
import { DeleteAccountCard } from "@/components/profile/delete-account-card";
import { SettingsSection } from "@/components/settings/settings-section";
import { ChangePasswordCard } from "@/components/settings/change-password-card";
import { changePassword } from "@/lib/settings/functions";
import type { ChangePasswordInput } from "@/lib/settings/schemas";

export const Route = createFileRoute("/_protected/settings/security")({
  head: () => ({
    meta: [{ title: "Security | Pnt - Personal Novel Translator" }],
  }),
  component: SecuritySettingsPage,
});

async function handleChangePassword(data: ChangePasswordInput): Promise<boolean> {
  try {
    await changePassword({ data });
    toast.success("Password updated");
    return true;
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : "Failed to update password");
    return false;
  }
}

/**
 * Security: the password, the sessions, and the one irreversible action — in that order,
 * so deletion is the last thing on the screen rather than the middle of a settings page.
 */
function SecuritySettingsPage() {
  const { user } = Route.useRouteContext();

  return (
    <SettingsSection
      title="Security"
      description="Your password, where this account is signed in, and how to close it for good."
    >
      <ChangePasswordCard onSubmit={handleChangePassword} />

      <ActiveSessionsCard />

      <DeleteAccountCard email={user.email} />
    </SettingsSection>
  );
}
