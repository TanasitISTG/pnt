import "@tanstack/react-start/server-only";
import { z } from "zod";

const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  APP_ENCRYPTION_KEY: z.string().min(32),
  // Local dev only: puts the SDK in dev mode (v4 defaults to cloud mode).
  INNGEST_DEV: z.string().optional(),

  // ZenRows scraper configuration (optional, app boots keyless).
  SCRAPER_API_KEY: z.string().optional(),
  SCRAPER_BASE: z
    .url()
    .optional()
    .refine((v) => !v || v.startsWith("https://api.zenrows.com"), {
      message: "must start with https://api.zenrows.com",
    }),
  SCRAPER_RENDER_JS: z.string().optional(),
  SCRAPER_PREMIUM_PROXY: z.string().optional(),

  // ScrapingBee & Firecrawl scraper configuration (optional, app boots keyless).
  SCRAPINGBEE_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
});

const prodEnvSchema = baseEnvSchema.extend({
  // Prod-only (Inngest Cloud); required when NODE_ENV === "production".
  // local dev uses the Inngest dev server keyless; production must validate keys on boot.
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
});

const devEnvSchema = baseEnvSchema.extend({
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

const envSchema = process.env.NODE_ENV === "production" ? prodEnvSchema : devEnvSchema;

export const env = envSchema.parse(process.env);
