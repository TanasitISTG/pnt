import "@tanstack/react-start/server-only";

import { auth, type User as AuthUser } from "@/lib/auth/auth";
import { assertImageMagicBytes } from "@/lib/images/magic-bytes";
import { log } from "@/lib/log";
import { SafeServerError } from "@/lib/server-fn-error";

import { deleteAvatarSet, resolveUserAvatar, writeAvatarSet } from "./avatar.server";
import type { UpdateProfileImageInput } from "./schemas";
import type { ResolvedAvatar, ViewerProfile } from "./types";

/**
 * A photo that cannot be resolved only costs a fallback initial, so a storage
 * failure must never take down page loads that merely decorate the shell.
 */
function resolveAvatarSafely(image: string | null | undefined): ResolvedAvatar | null {
  try {
    return resolveUserAvatar(image ?? null);
  } catch (error) {
    log("warn", "Profile photo resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Viewer for the router context, or null for a guest who still renders the shell.
 * The stored `image` key is exchanged for resolved URLs here, so no client ever
 * receives an object key in a field named like a URL.
 */
export function viewerProfileForSession(session: { user: AuthUser } | null): ViewerProfile | null {
  if (!session) return null;
  const { image, ...user } = session.user;
  return { user, avatar: resolveAvatarSafely(image) };
}

export async function viewerProfileForHeaders(headers: Headers): Promise<ViewerProfile | null> {
  return viewerProfileForSession(await auth.api.getSession({ headers }));
}

export async function applyProfileName(headers: Headers, name: string): Promise<void> {
  try {
    await auth.api.updateUser({ headers, body: { name } });
  } catch (error) {
    log("error", "Display name update failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new SafeServerError("Could not update your display name. Try again.");
  }
}

export async function replaceProfileImage(
  headers: Headers,
  userId: string,
  previousKey: string | null,
  data: UpdateProfileImageInput,
): Promise<void> {
  const buffer = Buffer.from(data.image, "base64");
  assertImageMagicBytes(buffer, data.imageMime, "Profile");

  // Objects are written before the row, so the profile never points at missing
  // bytes; a refused write-back removes the set that was just written.
  const imageKey = await writeAvatarSet(userId, buffer, data.imageMime);
  try {
    await auth.api.updateUser({ headers, body: { image: imageKey } });
  } catch (error) {
    await deleteAvatarSet(imageKey).catch(() => {});
    throw error;
  }

  // Trash collection is best-effort: the row already points at the new set.
  await deleteAvatarSet(previousKey).catch(() => {});
}

/** Returns false when there was no stored photo to clear. */
export async function clearProfileImage(
  headers: Headers,
  previousKey: string | null,
): Promise<boolean> {
  if (!previousKey) return false;
  await auth.api.updateUser({ headers, body: { image: null } });
  await deleteAvatarSet(previousKey).catch(() => {});
  return true;
}
