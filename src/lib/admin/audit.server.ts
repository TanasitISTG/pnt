import "@tanstack/react-start/server-only";

import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { adminAuditLog } from "@/lib/db/schema";
import { log } from "@/lib/log";

import type { AdminAction, AdminActionDetail } from "./audit";

export interface AdminActionRecord {
  actorId: string;
  actorEmail: string | null;
  action: AdminAction;
  targetUserId?: string | null;
  targetEmail?: string | null;
  /** Action-specific context, e.g. the new role or the ban's reason and expiry. */
  detail?: AdminActionDetail | null;
}

/**
 * Writes one audit row, and one structured log line beside it.
 *
 * The caller has already applied the change through the admin plugin, and that
 * change runs outside any transaction we could join - so a failure here is reported
 * as a logging failure, never as a failed moderation: telling an operator a ban did
 * not go through while the account is in fact suspended would be the worse error.
 */
export async function recordAdminAction(record: AdminActionRecord): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      id: nanoid(),
      actorId: record.actorId,
      actorEmail: record.actorEmail,
      action: record.action,
      targetUserId: record.targetUserId ?? null,
      targetEmail: record.targetEmail ?? null,
      detail: record.detail ?? null,
    });
  } catch (error) {
    log("error", "admin audit write failed", {
      action: record.action,
      actorId: record.actorId,
      targetId: record.targetUserId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  log("info", `admin ${record.action}`, {
    operatorId: record.actorId,
    targetId: record.targetUserId ?? null,
    ...record.detail,
  });
}
