import "@tanstack/react-start/server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  APP_ENCRYPTION_KEY: z.string().min(32),
  // Prod-only (Inngest Cloud); local dev uses the Inngest dev server keyless.
  // The SDK reads these from process.env directly — listed here as documentation.
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  // Local dev only: puts the SDK in dev mode (v4 defaults to cloud mode).
  INNGEST_DEV: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const seedEnv = {
  adminEmail: process.env.SEED_ADMIN_EMAIL,
  adminName: process.env.SEED_ADMIN_NAME,
  adminPassword: process.env.SEED_ADMIN_PASSWORD,
};
