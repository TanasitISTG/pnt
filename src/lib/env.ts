import "@tanstack/react-start/server-only";
import { z } from "zod";

export function parseLocalProviderOrigins(raw: string): readonly string[] {
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || !values.every((value) => typeof value === "string")) {
    throw new Error("LOCAL_PROVIDER_ORIGINS must be an array of canonical origins");
  }
  return Object.freeze([
    ...new Set(
      values.map((value: string) => {
        const url = new URL(value);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== "/" ||
          value !== url.origin
        ) {
          throw new Error("LOCAL_PROVIDER_ORIGINS must contain canonical HTTP(S) origins");
        }
        return url.origin;
      }),
    ),
  ]);
}

// Public object delivery origin for the R2 bucket (e.g. https://cdn.example.com).
// Canonical origin only: no path, credentials, query, fragment, or default-port alias.
export function parseStorageBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    value !== url.origin
  ) {
    throw new Error("R2_PUBLIC_BASE_URL must be a canonical HTTPS origin");
  }
  return url.origin;
}

export const R2_ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_BUCKET",
  "R2_PRIVATE_BUCKET",
  "R2_PUBLIC_BASE_URL",
] as const;

// Transactional email (Resend). Optional so local dev, CI, and a deployment that
// predates public signup still boot; when unset the mailer logs the message
// instead of sending it. All-or-nothing, because half a sender is a silent
// "reset email never arrived" bug.
export const EMAIL_ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM"] as const;

// Feature credential pairs that only work complete. Each is optional, but a lone
// half is a configuration error rather than a dead button or an unenforceable check.
export const PAIRED_ENV_KEYS = {
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  discord: ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"],
  turnstile: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"],
} as const;

/**
 * A copied `.env.example` defines every optional variable as `KEY=`. An empty value
 * there means "not configured", so it must read as absent rather than as a present
 * but invalid secret.
 */
const optionalConfigured = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export function parseScraperBase(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== "https://api.zenrows.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("SCRAPER_BASE must use the canonical ZenRows origin");
  }
  return url.toString();
}

const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Connection ceiling for the pooled client in `src/lib/db/index.ts`. One connection
  // per serverless instance is the production default; a suite that makes two
  // transactions contend for the same row lock has to raise it, because a single
  // connection serializes the requests client-side and Postgres never sees a waiter.
  DATABASE_POOL_MAX: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).default(1),
  ),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  APP_ENCRYPTION_KEY: z.string().min(32),
  // Local dev only: puts the SDK in dev mode (v4 defaults to cloud mode).
  INNGEST_DEV: z.string().optional(),
  RATE_LIMIT_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  // Budget per minute for the auth limiter's `/sign-in/email` rule and its global default.
  // Production keeps the shipped ten; a deployment whose sign-in volume warrants more can raise
  // it without a code change. The E2E supervisor pins it to the shipped value instead: the
  // suite's sessions come from a fixture (`e2e/sessions.ts`), so it signs in four times per run
  // rather than ten, and a spec that exhausts a working limiter is a spec testing the wrong thing.
  AUTH_RATE_LIMIT_MAX: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).default(10),
  ),
  VERCEL: z.literal("1").optional(),
  LOCAL_PROVIDER_ORIGINS: z
    .string()
    .default("[]")
    .transform((raw, ctx) => {
      try {
        return parseLocalProviderOrigins(raw);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid LOCAL_PROVIDER_ORIGINS" });
        return z.NEVER;
      }
    }),

  // ZenRows scraper configuration (optional, app boots keyless).
  SCRAPER_API_KEY: z.string().optional(),
  SCRAPER_BASE: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      try {
        return parseScraperBase(value);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "must use https://api.zenrows.com without credentials, query, hash, or port",
        });
        return z.NEVER;
      }
    }),
  SCRAPER_RENDER_JS: z.string().optional(),
  SCRAPER_PREMIUM_PROXY: z.string().optional(),

  // ScrapingBee & Firecrawl scraper configuration (optional, app boots keyless).
  SCRAPINGBEE_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),

  // Cloudflare R2 object storage. Optional off Vercel (local dev and CI fall back
  // to the filesystem adapter), required on Vercel, and never partially tolerated.
  R2_ACCOUNT_ID: optionalConfigured,
  R2_ACCESS_KEY_ID: optionalConfigured,
  R2_SECRET_ACCESS_KEY: optionalConfigured,
  R2_PUBLIC_BUCKET: optionalConfigured,
  R2_PRIVATE_BUCKET: optionalConfigured,
  R2_PUBLIC_BASE_URL: optionalConfigured.transform((value, ctx) => {
    if (value === undefined) return undefined;
    try {
      return parseStorageBaseUrl(value);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "must be a canonical HTTPS origin without a trailing slash",
      });
      return z.NEVER;
    }
  }),

  // Transactional email. Optional everywhere, including production, so a deploy is
  // never blocked on a mail credential; see the pairing check below and the
  // runtime warning in `src/lib/email/send.server.ts`.
  RESEND_API_KEY: optionalConfigured,
  EMAIL_FROM: optionalConfigured,

  // Ably realtime. Optional: without it the notification bell still reads the same
  // rows by polling and no socket is opened, which is what lets dev, CI, and E2E run
  // keyless. It is a server-only key: browsers receive a short-lived subscribe token
  // from `/api/realtime/token` and never see this value.
  ABLY_API_KEY: optionalConfigured,

  // Cloudflare Turnstile. Optional: the captcha plugin is registered only when the
  // secret is present, which is what lets dev, CI, and E2E run without keys. The site
  // key is public and is handed to the browser by the auth-methods server function,
  // so one deployment variable describes both halves.
  TURNSTILE_SITE_KEY: optionalConfigured,
  TURNSTILE_SECRET_KEY: optionalConfigured,

  // OAuth providers for public signup. Each is registered only when complete.
  GOOGLE_CLIENT_ID: optionalConfigured,
  GOOGLE_CLIENT_SECRET: optionalConfigured,
  DISCORD_CLIENT_ID: optionalConfigured,
  DISCORD_CLIENT_SECRET: optionalConfigured,

  // Set by Vercel on every deployment. Used to trust preview origins so OAuth and
  // the auth client work on a deployment URL before a custom domain is attached.
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
});

export interface R2ConfigurationIssue {
  path: string[];
  message: string;
}

/**
 * Storage configuration is all-or-nothing: a half-configured bucket would silently
 * mix backends, and every deployment that serves traffic must have real storage.
 * Off Vercel the app boots keyless on the filesystem adapter (local dev and CI).
 */
export function r2ConfigurationIssues(
  value: { VERCEL?: "1" | undefined } & Partial<Record<(typeof R2_ENV_KEYS)[number], string>>,
): R2ConfigurationIssue[] {
  const configured = R2_ENV_KEYS.filter((key) => value[key] !== undefined);
  if (configured.length === 0) {
    return value.VERCEL === "1"
      ? [
          {
            path: [],
            message: `R2 storage is required on Vercel (${R2_ENV_KEYS.join(", ")})`,
          },
        ]
      : [];
  }
  if (configured.length === R2_ENV_KEYS.length) return [];
  return R2_ENV_KEYS.filter((key) => value[key] === undefined).map((key) => ({
    path: [key],
    message: "required when R2 is configured",
  }));
}

/** Transactional email is all-or-nothing: a lone half silently drops every reset mail. */
export function emailConfigurationIssues(
  value: Partial<Record<(typeof EMAIL_ENV_KEYS)[number], string>>,
): R2ConfigurationIssue[] {
  const configured = EMAIL_ENV_KEYS.filter((key) => value[key] !== undefined);
  if (configured.length === 0 || configured.length === EMAIL_ENV_KEYS.length) return [];
  return EMAIL_ENV_KEYS.filter((key) => value[key] === undefined).map((key) => ({
    path: [key],
    message: "required when transactional email is configured",
  }));
}

/**
 * Each optional feature credential needs both halves. A lone client ID would render a
 * button whose callback can never complete, and a lone Turnstile secret would enforce
 * a challenge the browser has no key to answer, so both are rejected at boot.
 */
export function pairedConfigurationIssues(value: Record<string, unknown>): R2ConfigurationIssue[] {
  const issues: R2ConfigurationIssue[] = [];
  for (const keys of Object.values(PAIRED_ENV_KEYS)) {
    const configured = keys.filter((key) => value[key] !== undefined);
    if (configured.length === 0 || configured.length === keys.length) continue;
    for (const missing of keys.filter((key) => value[key] === undefined)) {
      issues.push({ path: [missing], message: `required when ${keys[0]} is configured` });
    }
  }
  return issues;
}

function refineOptionalConfiguration(value: Record<string, unknown>, ctx: z.RefinementCtx): void {
  // Each helper keeps its own narrow key set; the casts are the seam between Zod's
  // inferred object and those views, not a widening of what is checked.
  for (const issue of [
    ...r2ConfigurationIssues(value as Partial<Record<(typeof R2_ENV_KEYS)[number], string>>),
    ...emailConfigurationIssues(value as Partial<Record<(typeof EMAIL_ENV_KEYS)[number], string>>),
    ...pairedConfigurationIssues(value),
  ]) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}

const checkedBaseEnvSchema = baseEnvSchema.superRefine(refineOptionalConfiguration);

const prodEnvSchema = checkedBaseEnvSchema.extend({
  // Prod-only (Inngest Cloud); required when NODE_ENV === "production".
  // local dev uses the Inngest dev server keyless; production must validate keys on boot.
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
});

/**
 * Whether verification and password-reset mail can actually leave the process.
 * Unset means the mailer logs the message instead, which is what keeps local dev,
 * CI, and E2E free of mail credentials.
 */
export function transactionalEmailConfigured(value: {
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM?: string | undefined;
}): boolean {
  return value.RESEND_API_KEY !== undefined && value.EMAIL_FROM !== undefined;
}

const devEnvSchema = checkedBaseEnvSchema.extend({
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

const envSchema = process.env.NODE_ENV === "production" ? prodEnvSchema : devEnvSchema;

export const env = envSchema.parse(process.env);
