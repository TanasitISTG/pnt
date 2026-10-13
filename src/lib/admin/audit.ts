/**
 * The operator action vocabulary, in a module both graphs can import.
 *
 * The audit writer (server) and the activity screen (browser) have to agree on the
 * set of actions and how each one reads, so the names and labels live here rather
 * than in either one of them.
 */

export const ADMIN_ACTIONS = [
  "role.granted",
  "role.revoked",
  "account.banned",
  "account.unbanned",
  "account.sessions_revoked",
  "account.deleted",
  "impersonation.started",
  "impersonation.stopped",
  "report.upheld",
  "report.dismissed",
  "comment.removed",
  "review.removed",
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/**
 * Action-specific context stored with a row. Deliberately restricted to values a
 * server function may return, so the trail stays serializable across the wire, and
 * restricted in what it may hold: a role, a reason, a day count - never a credential
 * or an internal error.
 */
export type AdminActionDetail = Record<string, string | number | boolean | null>;

const ADMIN_ACTION_LABELS: Record<AdminAction, string> = {
  "role.granted": "Operator access granted",
  "role.revoked": "Operator access removed",
  "account.banned": "Account suspended",
  "account.unbanned": "Account restored",
  "account.sessions_revoked": "Sessions signed out",
  "account.deleted": "Account deleted",
  "impersonation.started": "Viewed as account",
  "impersonation.stopped": "Returned to operator",
  "report.upheld": "Report upheld",
  "report.dismissed": "Report dismissed",
  "comment.removed": "Comment removed",
  "review.removed": "Review removed",
};

/** Falls back to the raw value so an action added later still renders something. */
export function describeAdminAction(action: string): string {
  return ADMIN_ACTION_LABELS[action as AdminAction] ?? action;
}

export function isAdminAction(action: string): action is AdminAction {
  return (ADMIN_ACTIONS as readonly string[]).includes(action);
}
