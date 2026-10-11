import "@tanstack/react-start/server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "./schema";

/*
 * The pooled connection string (Neon's `-pooler` host, i.e. PgBouncer in
 * transaction mode), with a single connection per serverless instance.
 *
 * Vercel scales this one Nitro function out into many independent instances and
 * each opens its own pool, so the raw demand on the database is
 * `pool size x active instances`. Transaction-mode pooling multiplexes all of
 * those onto a small number of server connections, which is what removes the
 * ceiling; `max: 1` keeps the client side from fighting it. Against a plan whose
 * `max_connections` is around 20, a larger pool exhausts the server during an
 * ordinary traffic spike and every query fails with "remaining connection slots
 * are reserved for roles with the SUPERUSER attribute" (SQLSTATE 53300) instead
 * of reaching its handler.
 *
 * `prepare: false` is required, not optional: prepared statements live on a
 * server session that a transaction-mode pooler reassigns between transactions,
 * so the second use of a named statement can land on a connection that has never
 * seen it. Only the protocol-level statement cache is disabled; Drizzle's typed
 * queries are unaffected.
 *
 * Long work must not monopolize the one connection. Exports already stream in
 * keyset batches rather than through a held cursor for exactly this reason, and
 * outbox delivery commits before it dispatches.
 *
 * `idle_timeout` hands the slot back once an instance stops serving and a bounded
 * `max_lifetime` keeps a long-lived instance from pinning one forever. Neither
 * runs while Vercel has an instance frozen, which is the remaining argument for
 * transaction-mode pooling over anything the client can do on its own.
 */
export const queryClient = postgres(env.DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 60,
  max_lifetime: 60 * 10,
});

export const db = drizzle(queryClient, { schema });
