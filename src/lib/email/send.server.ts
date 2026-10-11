import "@tanstack/react-start/server-only";

import { env, transactionalEmailConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { bumpRateLimit } from "@/lib/rate-limit";
import {
  changeEmailEmail,
  deleteAccountEmail,
  existingUserSignUpEmail,
  resetPasswordEmail,
  verificationEmail,
  type EmailMessage,
} from "@/lib/email/templates";

/**
 * Transactional mail delivery.
 *
 * Two properties matter more than throughput here:
 *
 * 1. No auth flow may fail because mail failed. Verification is not required to sign
 *    in, and a password-reset request must answer identically whether or not the
 *    address exists, so every function below logs and returns instead of throwing.
 * 2. The app must not become a relay. Sending is metered per recipient address on the
 *    same durable `rate_limits` table as the rest of the app, and a limiter outage
 *    fails open so a reset is never blocked by bookkeeping.
 *
 * Without credentials the message is logged rather than sent, mirroring how the app
 * boots against the filesystem storage adapter when R2 is unconfigured.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_SEND_TIMEOUT_MS = 10_000;
const EMAIL_RECIPIENT_HOURLY_LIMIT = 5;
const EMAIL_THROTTLE_WINDOW_MS = 3_600_000;

/** Shared with the auth config so the copy can never promise a different lifetime. */
export const VERIFICATION_TOKEN_TTL_SECONDS = 60 * 60;
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;
export const DELETE_ACCOUNT_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Keeps the local part of an address out of logs while preserving the domain,
 * which is the part that matters when diagnosing deliverability.
 */
function redactAddress(to: string): string {
  const at = to.lastIndexOf("@");
  return at > 0 ? `***@${to.slice(at + 1)}` : "***";
}

function signInUrl(): string {
  return `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/login`;
}

/**
 * Points a verification link's return leg at the app's own confirmation screen.
 *
 * Better Auth verifies the token at its API route and then redirects to the link's
 * `callbackURL`; rewriting that leg sends the reader to a page that can explain the
 * outcome instead of dropping them on the library mid-toggle. The token itself is
 * untouched, and a URL shape the parser does not recognize is left exactly as issued.
 */
function verificationLandingUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("callbackURL", "/verify-email?verified=1");
    return parsed.toString();
  } catch {
    return url;
  }
}

interface MailUser {
  name?: string | null;
  email: string;
}

async function deliver(to: string, message: EmailMessage, actionUrl: string): Promise<void> {
  try {
    const count = await bumpRateLimit("email", to.toLowerCase(), EMAIL_THROTTLE_WINDOW_MS);
    if (count > EMAIL_RECIPIENT_HOURLY_LIMIT) {
      log("warn", "email throttled for recipient", { to: redactAddress(to) });
      return;
    }
  } catch (error: unknown) {
    log("warn", "email rate-limit check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!transactionalEmailConfigured(env)) {
    // In development the action URL is the whole point of this branch: it is how a
    // reset or verification link is followed without a mail account. Production logs
    // it as an operator warning only, never with the live token.
    log("warn", "transactional email is not configured; message was not sent", {
      to: redactAddress(to),
      subject: message.subject,
      ...(process.env.NODE_ENV === "production" ? {} : { url: actionUrl }),
    });
    return;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The upstream body is never read: it can echo the recipient and the payload.
      log("error", "email delivery rejected", {
        to: redactAddress(to),
        status: response.status,
      });
      return;
    }
    log("info", "email sent", { to: redactAddress(to), subject: message.subject });
  } catch (error: unknown) {
    log("error", "email delivery failed", {
      to: redactAddress(to),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendVerificationEmail({
  user,
  url,
}: {
  user: MailUser;
  url: string;
  token: string;
}): Promise<void> {
  const landing = verificationLandingUrl(url);
  await deliver(
    user.email,
    verificationEmail({
      name: user.name ?? null,
      url: landing,
      expiresInMinutes: VERIFICATION_TOKEN_TTL_SECONDS / 60,
    }),
    landing,
  );
}

export async function sendResetPassword({
  user,
  url,
}: {
  user: MailUser;
  url: string;
  token: string;
}): Promise<void> {
  await deliver(
    user.email,
    resetPasswordEmail({
      name: user.name ?? null,
      url,
      expiresInMinutes: RESET_TOKEN_TTL_SECONDS / 60,
    }),
    url,
  );
}

export async function sendChangeEmailConfirmation({
  user,
  newEmail,
  url,
}: {
  user: MailUser;
  newEmail: string;
  url: string;
  token: string;
}): Promise<void> {
  // NOTE: deliberately sent to the *current* address so a hijacked session cannot
  // silently move the account to an address the attacker owns.
  await deliver(user.email, changeEmailEmail({ name: user.name ?? null, newEmail, url }), url);
}

export async function sendDeleteAccountVerification({
  user,
  url,
}: {
  user: MailUser;
  url: string;
  token: string;
}): Promise<void> {
  await deliver(user.email, deleteAccountEmail({ name: user.name ?? null, url }), url);
}

/**
 * Fires when a sign-up uses an address that already exists. Only invoked while
 * `requireEmailVerification` is set or `autoSignIn` is off; wired up here so the
 * behaviour follows whichever setting the deployment chooses.
 */
export async function notifyExistingUserSignUp({ user }: { user: MailUser }): Promise<void> {
  const url = signInUrl();
  await deliver(user.email, existingUserSignUpEmail({ name: user.name ?? null, url }), url);
}
