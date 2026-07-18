import "@tanstack/react-start/server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  APP_ENCRYPTION_KEY: z.string().min(32),
});

export const env = envSchema.parse(process.env);

export const seedEnv = {
  adminEmail: process.env.SEED_ADMIN_EMAIL,
  adminName: process.env.SEED_ADMIN_NAME,
  adminPassword: process.env.SEED_ADMIN_PASSWORD,
};
