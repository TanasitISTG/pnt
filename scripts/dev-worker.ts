import { config } from "dotenv";

config({ path: ".env.local" });
config();

const base = process.env.DEV_WORKER_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set (check .env.local)");
  process.exit(1);
}

const url = `${base}/api/cron/translation-worker`;
console.log(`Dev worker pinging ${url} every 5s (Ctrl+C to stop)`);

for (;;) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    const body: any = await res.json().catch(() => null);
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    if (!res.ok) {
      console.log(`[${time}] HTTP ${res.status}: ${body?.error || (await res.text()) || "error"}`);
    } else if (body?.processed > 0) {
      console.log(`[${time}] processed ${body.processed} job(s):`, JSON.stringify(body.results));
    }
  } catch {
    // Dev server down or a long chunk blew the client timeout — the server
    // keeps running regardless; next ping is lease-safe.
    console.log(
      `[${new Date().toLocaleTimeString("en-US", { hour12: false })}] request failed (server busy or down?)`,
    );
  }
  await new Promise((r) => setTimeout(r, 5000));
}
