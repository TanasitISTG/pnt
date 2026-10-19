import "@tanstack/react-start/server-only";

import { assertImageMagicBytes } from "@/lib/images/magic-bytes";
import { log } from "@/lib/log";
import { fetchFromPublicHost } from "@/lib/net/network-policy.server";

import { flattenToPng } from "./avatar-image.server";
import { writeAvatarSet } from "./avatar.server";

/**
 * Adopting the photo a reader already has on Google or Discord.
 *
 * `user.image` holds an avatar *prefix* in our own bucket, never an address: the
 * profile types omit the column for exactly that reason, and the deletion paths call
 * `deletePrefix` on it. A provider URL written straight into that column is therefore
 * inert — `resolveUserAvatar` cannot parse it, so the photo never renders — and it puts
 * a third-party address on the row that no cleanup can remove. Mirroring the bytes
 * through the existing avatar set keeps one shape for every photo in the app and keeps
 * the bytes validated and re-encoded like any other upload.
 *
 * The fetch is deliberately narrow: only the two provider CDNs, HTTPS only, no
 * redirects, a bounded body, and the same DNS-pinned transport provider calls use, so a
 * profile URL that points somewhere private cannot turn account creation into an SSRF
 * primitive.
 */

/** Hosts a provider photo may come from; subdomains are accepted, look-alikes are not. */
const PROVIDER_AVATAR_HOSTS = ["googleusercontent.com", "cdn.discordapp.com"] as const;

const PROVIDER_AVATAR_TIMEOUT_MS = 5_000;
const PROVIDER_AVATAR_MAX_BYTES = 4 * 1024 * 1024;

/** Types stored as-is. Anything else is either converted or refused. */
const PASSTHROUGH_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Whether a value is a provider photo address this app is willing to fetch. Also the
 * marker the create hook uses to recognise an account that came in through OAuth:
 * an email sign-up has no image at all.
 */
export function isProviderAvatarUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return PROVIDER_AVATAR_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

/**
 * Turns a declared media type plus its bytes into something the avatar set accepts.
 *
 * Discord hands out animated avatars as GIFs. A still frame is what every avatar
 * surface renders anyway, so it is converted rather than skipped — but declared types
 * outside the avatar vocabulary (an HTML error page served with 200, say) are refused
 * before anything is decoded.
 */
async function prepareAvatarBytes(
  buffer: Uint8Array,
  declaredType: string,
): Promise<{ buffer: Uint8Array; mime: string } | null> {
  if (PASSTHROUGH_TYPES.has(declaredType)) return { buffer, mime: declaredType };
  if (declaredType === "image/gif")
    return { buffer: await flattenToPng(buffer), mime: "image/png" };
  return null;
}

/**
 * Fetches a provider photo and proves it is one, without storing anything.
 *
 * Split from the write so a dry run can tell an operator which photos would be
 * adopted without leaving objects behind in the shared public bucket.
 */
export async function fetchProviderAvatar(
  remoteUrl: string,
): Promise<{ buffer: Uint8Array; mime: string } | null> {
  if (!isProviderAvatarUrl(remoteUrl)) return null;

  try {
    const response = await fetchFromPublicHost(remoteUrl, {
      signal: AbortSignal.timeout(PROVIDER_AVATAR_TIMEOUT_MS),
      headers: { accept: "image/png,image/jpeg,image/webp,image/gif" },
    });
    // Redirects are never followed by the transport, so anything but a direct 200 is
    // not the photo the provider advertised.
    if (response.status !== 200) {
      log("warn", "provider profile photo was not served directly", {
        host: new URL(remoteUrl).hostname,
        status: response.status,
      });
      return null;
    }

    const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > PROVIDER_AVATAR_MAX_BYTES) {
      log("warn", "provider profile photo is too large", { declaredLength });
      return null;
    }

    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > PROVIDER_AVATAR_MAX_BYTES) {
      log("warn", "provider profile photo is too large", { bytes: body.byteLength });
      return null;
    }

    const declaredType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const prepared = await prepareAvatarBytes(body, declaredType);
    if (!prepared) {
      log("warn", "provider profile photo has an unsupported type", { declaredType });
      return null;
    }

    // The provider's claim about the bytes is only a claim, exactly as for an upload.
    assertImageMagicBytes(prepared.buffer, prepared.mime);
    return prepared;
  } catch (error) {
    log("warn", "provider profile photo could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * What the account-creation hook does with a freshly created user: adopt the photo the
 * provider already had, then hand the caller the value the column should hold. It is a
 * function rather than a few lines inside the hook so the decision it makes — including
 * clearing an address that cannot be adopted — is covered by tests.
 */
export async function adoptProviderImageForUser(
  user: { id: string; image?: unknown },
  save: (userId: string, imageKey: string | null) => Promise<void>,
): Promise<void> {
  const providerPhoto = typeof user.image === "string" ? user.image : null;
  if (!isProviderAvatarUrl(providerPhoto)) return;

  // Either way the provider's address leaves the column: it is replaced by the key of
  // the copy we now own, or cleared when it could not be adopted. A brand-new account
  // has no other photo to lose, and a URL there would never resolve.
  await save(user.id, await mirrorProviderAvatar(user.id, providerPhoto));
}

/**
 * Stores the provider photo as this account's avatar and returns the new key prefix,
 * or null when it cannot be adopted — in which case the caller clears the column so the
 * row never holds an address that does not resolve.
 */
export async function mirrorProviderAvatar(
  userId: string,
  remoteUrl: string,
): Promise<string | null> {
  const photo = await fetchProviderAvatar(remoteUrl);
  if (!photo) return null;

  try {
    return await writeAvatarSet(userId, photo.buffer, photo.mime);
  } catch (error) {
    log("warn", "provider profile photo could not be stored", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
