import "@tanstack/react-start/server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin, captcha } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";

import { deleteAvatarSet } from "@/lib/account/purge.server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  DELETE_ACCOUNT_TOKEN_TTL_SECONDS,
  RESET_TOKEN_TTL_SECONDS,
  VERIFICATION_TOKEN_TTL_SECONDS,
  notifyExistingUserSignUp,
  sendChangeEmailConfirmation,
  sendDeleteAccountVerification,
  sendResetPassword,
  sendVerificationEmail,
} from "@/lib/email/send.server";
import { fallbackDisplayName } from "@/lib/auth/display-name";
import { ADMIN_ROLE } from "@/lib/auth/roles";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { adoptProviderImageForUser } from "@/lib/profile/social-avatar.server";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

/** The only role a sign-up can ever receive. Admin is granted out of band. */
const DEFAULT_USER_ROLE = "user";

/**
 * Origins permitted to drive the auth endpoints. The canonical app URL plus any
 * Vercel deployment host - OAuth callbacks and the auth client otherwise fail on a
 * preview URL before a custom domain is attached.
 */
function trustedOrigins(): string[] {
  const origins = new Set<string>([env.BETTER_AUTH_URL]);
  if (process.env.NODE_ENV !== "production") origins.add("http://localhost:3000");
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    if (host) origins.add(`https://${host}`);
  }
  return [...origins];
}

/** Hostnames a Turnstile token may have been issued for. */
function turnstileHostnames(): string[] {
  const hostnames = new Set<string>();
  for (const value of [env.BETTER_AUTH_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    if (!value) continue;
    try {
      hostnames.add(new URL(value.includes("://") ? value : `https://${value}`).hostname);
    } catch {
      // A malformed optional host simply contributes nothing.
    }
  }
  if (process.env.NODE_ENV !== "production") hostnames.add("localhost");
  return [...hostnames];
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: trustedOrigins(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    // Public signup. Email verification is offered on signup but not required to
    // sign in: every account owns an isolated workspace, so the cost of an
    // unverified address is near zero, while blocking sign-in behind mail
    // deliverability would strand users at the moment they are most likely to leave.
    disableSignUp: false,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    sendResetPassword,
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    // A reset means the mailbox is back in control, so every other session dies with it.
    revokeSessionsOnPasswordReset: true,
    onExistingUserSignUp: notifyExistingUserSignUp,
  },
  emailVerification: {
    sendVerificationEmail,
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
  },
  // Each provider registers only when both halves of its credential pair exist, so a
  // half-configured provider can never render a button whose callback cannot complete.
  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
      ? {
          discord: {
            clientId: env.DISCORD_CLIENT_ID,
            clientSecret: env.DISCORD_CLIENT_SECRET,
          },
        }
      : {}),
  },
  account: {
    accountLinking: {
      // Linking a Google/Discord identity into a local row stays behind the default
      // `requireLocalEmailVerified` guard: unverified local accounts are exactly how
      // an attacker could try to pre-register a victim's address.
      trustedProviders: ["google", "discord"],
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation,
      // A hijacked session must not be able to move the account to an address the
      // attacker controls without confirming the new one.
      updateEmailWithoutVerification: false,
    },
    deleteUser: {
      enabled: true,
      // Requiring a confirmation email keeps a stolen session from erasing the account.
      sendDeleteAccountVerification,
      deleteTokenExpiresIn: DELETE_ACCOUNT_TOKEN_TTL_SECONDS,
    },
    additionalFields: {
      // Both are written by the create hook only; `input: false` keeps them out of
      // every request body the client could send.
      termsVersion: { type: "string", required: false, input: false },
      termsAcceptedAt: { type: "date", required: false, input: false },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
    storage: "database",
    // Signup and reset are the endpoints worth guessing at, so they get tighter
    // windows than the shared default.
    customRules: {
      "/sign-up/email": { window: 60, max: 5 },
      "/sign-in/email": { window: 60, max: 10 },
      "/request-password-reset": { window: 60, max: 3 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            // Forced last, and deliberately re-applied by value rather than deleted:
            // the admin plugin's own create hook spreads incoming data *after* its
            // default role, so anything the client supplied would otherwise win. Both
            // hook orders converge on the default role this way.
            role: DEFAULT_USER_ROLE,
            termsVersion: CURRENT_TERMS_VERSION,
            termsAcceptedAt: new Date(),
            // A social profile can arrive without a usable name; the account would then
            // open with a blank one. Providers that do supply a name keep it untouched.
            name: fallbackDisplayName(user),
          },
        }),
        after: async (user) => {
          // Only OAuth sign-ups carry an image at this point, and only the provider
          // photo it points at is worth adopting: this is what makes "continue with
          // Google" produce the reader's own name and photo instead of an empty shell.
          await adoptProviderImageForUser(user, async (userId, imageKey) => {
            await db.update(schema.user).set({ image: imageKey }).where(eq(schema.user.id, userId));
          });
        },
      },
      delete: {
        after: async (user) => {
          const image = typeof user["image"] === "string" ? user["image"] : null;
          await deleteAvatarSet(image);
        },
      },
    },
  },
  plugins: [
    // Registered only when configured, which is what lets dev, CI, and E2E sign up
    // without a Cloudflare account. Covers /sign-up/email, /sign-in/email, and
    // /request-password-reset by default.
    ...(env.TURNSTILE_SECRET_KEY
      ? [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: env.TURNSTILE_SECRET_KEY,
            allowedHostnames: turnstileHostnames(),
          }),
        ]
      : []),
    admin({
      defaultRole: DEFAULT_USER_ROLE,
      adminRoles: [ADMIN_ROLE],
      bannedUserMessage:
        "This account has been suspended. Contact the site operator if you believe this is a mistake.",
    }),
    // Must stay last: it installs the cookie-writing hooks the TanStack Start
    // request lifecycle depends on.
    tanstackStartCookies(),
  ],
});

// A production deploy with no mail credential still boots, but password reset and
// verification silently become no-ops, so say so once at startup.
if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
  log(
    process.env.NODE_ENV === "production" ? "error" : "warn",
    "transactional email is not configured; verification and password-reset mail will not be sent",
    {},
  );
}

export type Session = typeof auth.$Infer.Session.session;
/**
 * `$Infer` surfaces `additionalFields` but not the columns a plugin owns, so the
 * admin plugin's fields are declared here. They are real columns on `user`; this is
 * the type that knows about them.
 */
export type User = typeof auth.$Infer.Session.user & {
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
};
