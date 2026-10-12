import "@tanstack/react-start/server-only";

import { eq } from "drizzle-orm";

import { auth, type User as AuthUser } from "@/lib/auth/auth";
import { impersonationOperatorId } from "@/lib/auth/impersonation";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
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
export function viewerProfileForSession(
  session: { user: AuthUser; session?: unknown } | null,
  operatorName: string | null = null,
): ViewerProfile | null {
  if (!session) return null;
  const { image, ...user } = session.user;
  const operatorId = impersonationOperatorId(session.session);
  return {
    user,
    avatar: resolveAvatarSafely(image),
    impersonation: operatorId ? { operatorId, operatorName } : null,
  };
}

/**
 * A missing operator name costs a fallback label in the banner, so a lookup failure
 * never takes down a page load.
 */
async function resolveOperatorName(operatorId: string): Promise<string | null> {
  try {
    const [operator] = await db
      .select({ name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id, operatorId))
      .limit(1);
    return operator?.name ?? null;
  } catch (error) {
    log("warn", "impersonating operator lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function viewerProfileForHeaders(headers: Headers): Promise<ViewerProfile | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;

  const operatorId = impersonationOperatorId(session.session);
  const operatorName = operatorId ? await resolveOperatorName(operatorId) : null;
  return viewerProfileForSession(session, operatorName);
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
