import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { AccountEmailCard } from "@/components/profile/account-email-card";
import { LinkedAccountsCard } from "@/components/profile/linked-accounts-card";
import { ProfileDetailsCard } from "@/components/profile/profile-details-card";
import { ProfilePhotoCard } from "@/components/profile/profile-photo-card";
import { SettingsSection } from "@/components/settings/settings-section";
import { getAuthMethods } from "@/lib/auth/functions";
import { headTranslator } from "@/lib/i18n/route-head";
import { translateServerError } from "@/lib/i18n/server-error";
import { removeProfileImage, updateProfileImage, updateProfileName } from "@/lib/profile/functions";
import type { UpdateProfileImageInput, UpdateProfileNameInput } from "@/lib/profile/schemas";

export const Route = createFileRoute("/_protected/settings/account")({
  // Which providers exist is deployment policy, so the linked-accounts list is built
  // from the same server answer the sign-in pages use.
  loader: async () => ({ methods: await getAuthMethods() }),
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [{ title: `${t("meta.settingsAccount")} | ${t("meta.siteName")}` }],
    };
  },
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const t = useTranslations("settings");
  // A rejection carries a key, and the root translator is the one that can resolve it.
  const tRoot = useTranslations();
  const { user, avatar } = Route.useRouteContext();
  const { methods } = Route.useLoaderData();
  const router = useRouter();
  // The shell renders the name and photo from the router context, so every accepted
  // profile change has to re-run the root loader before the header catches up.
  const refreshShell = () => router.invalidate();

  const handleName = async (data: UpdateProfileNameInput): Promise<boolean> => {
    try {
      await updateProfileName({ data });
      toast.success(t("displayNameUpdated"));
      await refreshShell();
      return true;
    } catch (err: unknown) {
      toast.error(translateServerError(err, tRoot, t("displayNameUpdateFailed")));
      return false;
    }
  };

  const handlePhoto = async (data: UpdateProfileImageInput): Promise<boolean> => {
    try {
      await updateProfileImage({ data });
      toast.success(t("photoUpdated"));
      await refreshShell();
      return true;
    } catch (err: unknown) {
      toast.error(translateServerError(err, tRoot, t("photoUpdateFailed")));
      return false;
    }
  };

  const handleRemovePhoto = async (): Promise<boolean> => {
    try {
      await removeProfileImage();
      toast.success(t("photoRemoved"));
      await refreshShell();
      return true;
    } catch (err: unknown) {
      toast.error(translateServerError(err, tRoot, t("photoRemoveFailed")));
      return false;
    }
  };

  return (
    <SettingsSection title={t("accountTitle")} description={t("accountDescription")}>
      <ProfilePhotoCard
        name={user.name}
        avatar={avatar}
        onUpload={handlePhoto}
        onRemove={handleRemovePhoto}
      />

      <ProfileDetailsCard initialName={user.name} email={user.email} onSubmit={handleName} />

      <AccountEmailCard email={user.email} />

      <LinkedAccountsCard methods={methods} />
    </SettingsSection>
  );
}
