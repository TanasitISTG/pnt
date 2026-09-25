import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";

import type { db } from "@/lib/db";
import { novels } from "@/lib/db/schema";

export type NovelMutationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Acquire all required novel gates before locking or writing descendants. */
export async function lockNovelForMutation(
  tx: NovelMutationTransaction,
  novelId: string,
  userId?: string,
): Promise<boolean> {
  const [novel] = await tx
    .select({ id: novels.id })
    .from(novels)
    .where(
      and(eq(novels.id, novelId), userId === undefined ? undefined : eq(novels.userId, userId)),
    )
    .limit(1)
    .for("update", { of: novels });
  return novel !== undefined;
}
