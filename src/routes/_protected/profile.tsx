import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { AccountEmailCard } from "@/components/profile/account-email-card";
import { ActiveSessionsCard } from "@/components/profile/active-sessions-card";
import { DeleteAccountCard } from "@/components/profile/delete-account-card";
import { LinkedAccountsCard } from "@/components/profile/linked-accounts-card";
import { ProfileDetailsCard } from "@/components/profile/profile-details-card";
import { ProfilePhotoCard } from "@/components/profile/profile-photo-card";
import { ChangePasswordCard } from "@/components/settings/change-password-card";
import { getAuthMethods } from "@/lib/auth/functions";
import { removeProfileImage, updateProfileImage, updateProfileName } from "@/lib/profile/functions";
import type { UpdateProfileImageInput, UpdateProfileNameInput } from "@/lib/profile/schemas";
import { changePassword } from "@/lib/settings/functions";
import type { ChangePasswordInput } from "@/lib/settings/schemas";

export const Route = createFileRoute("/_protected/profile")({
  // Which providers exist is deployment policy, so the linked-accounts list is built
  // from the same server answer the sign-in pages use.
  loader: async () => ({ methods: await getAuthMethods() }),
  head: () => ({
    meta: [{ title: "Profile | Pnt - Personal Novel Translator" }],
  }),
  component: ProfilePage,
});

async function handleChangePassword(data: ChangePasswordInput): Promise<boolean> {
  try {
    await changePassword({ data });
    toast.success("Password updated successfully");
    return true;
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : "Failed to update password");
    return false;
  }
}

function ProfilePage() {
  const { user, avatar } = Route.useRouteContext();
  const { methods } = Route.useLoaderData();
  const router = useRouter();
  // The shell renders the name and photo from the router context, so every accepted
  // profile change has to re-run the root loader before the header catches up.
  const refreshShell = () => router.invalidate();

  const handleName = async (data: UpdateProfileNameInput): Promise<boolean> => {
    try {
      await updateProfileName({ data });
      toast.success("Display name updated");
      await refreshShell();
      return true;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update display name");
      return false;
    }
  };

  const handlePhoto = async (data: UpdateProfileImageInput): Promise<boolean> => {
    try {
      await updateProfileImage({ data });
      toast.success("Profile photo updated");
      await refreshShell();
      return true;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile photo");
      return false;
    }
  };

  const handleRemovePhoto = async (): Promise<boolean> => {
    try {
      await removeProfileImage();
      toast.success("Profile photo removed");
      await refreshShell();
      return true;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to remove profile photo");
      return false;
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-display-alt font-semibold text-foreground">Profile</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Manage how you appear in the app and keep your account secure.
        </p>
      </div>

      <ProfilePhotoCard
        name={user.name}
        avatar={avatar}
        onUpload={handlePhoto}
        onRemove={handleRemovePhoto}
      />

      <ProfileDetailsCard initialName={user.name} email={user.email} onSubmit={handleName} />

      <AccountEmailCard email={user.email} />

      <LinkedAccountsCard methods={methods} />

      {/* Account Section */}
      <ChangePasswordCard onSubmit={handleChangePassword} />

      <ActiveSessionsCard />

      <DeleteAccountCard email={user.email} />
    </div>
  );
}
