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
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  APP_ENCRYPTION_KEY: z.string().min(32),
  // Local dev only: puts the SDK in dev mode (v4 defaults to cloud mode).
  INNGEST_DEV: z.string().optional(),
  RATE_LIMIT_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
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

function refineR2Configuration(
  value: { VERCEL?: "1" | undefined } & Partial<Record<(typeof R2_ENV_KEYS)[number], string>>,
  ctx: z.RefinementCtx,
): void {
  for (const issue of r2ConfigurationIssues(value)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}

const checkedBaseEnvSchema = baseEnvSchema.superRefine(refineR2Configuration);

const prodEnvSchema = checkedBaseEnvSchema.extend({
  // Prod-only (Inngest Cloud); required when NODE_ENV === "production".
  // local dev uses the Inngest dev server keyless; production must validate keys on boot.
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
});

const devEnvSchema = checkedBaseEnvSchema.extend({
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

const envSchema = process.env.NODE_ENV === "production" ? prodEnvSchema : devEnvSchema;

export const env = envSchema.parse(process.env);
