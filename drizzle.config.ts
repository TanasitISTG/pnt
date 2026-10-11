import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't auto-load .env.local (Vite convention) — load it explicitly, .env as fallback
config({ path: ".env.local" });
config();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  // drizzle-kit runs DDL and prepared statements, so it needs the direct endpoint: a
  // transaction-mode pooler reassigns the server connection between transactions.
  // Fall back to DATABASE_URL when the deployment has no pooler.
  dbCredentials: {
    url: (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)!,
  },
});
