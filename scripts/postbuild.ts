/**
 * Post-build patcher: inject maxDuration into the Nitro-emitted Vercel function.
 *
 * Nitro's Vercel preset emits a single catch-all serverless function
 * (`.vercel/output/functions/__server.func/`) and a `.vc-config.json` with
 * runtime/handler, but NOT `maxDuration`. Vercel Build Output API reads
 * `maxDuration` from `.vc-config.json`, so we add it here.
 *
 * The Inngest worker (`/api/inngest`) makes up to 4-min LLM calls per chunk
 * step (`provider-client.ts` 4-min request timeout). Without an explicit
 * budget, Vercel's default function maxDuration (10s on Hobby, 60s on Pro)
 * would kill those calls mid-stream.
 *
 * maxDuration is an upper bound — only requests that actually run long are
 * billed for their actual duration, so setting 300s on all serverless
 * invocations costs nothing for fast SSR/server-fn requests.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FUNC_DIR = ".vercel/output/functions/__server.func";
const CONFIG_PATH = `${FUNC_DIR}/.vc-config.json`;

if (!existsSync(CONFIG_PATH)) {
  console.error(`[postbuild] ${CONFIG_PATH} not found — was the build run?`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
config.maxDuration = 300;
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");

console.log(`[postbuild] patched ${CONFIG_PATH} → maxDuration: 300`);
