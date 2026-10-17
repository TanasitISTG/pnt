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
  "author.merged",
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/**
 * Action-specific context stored with a row. Deliberately restricted to values a
 * server function may return, so the trail stays serializable across the wire, and
 * restricted in what it may hold: a role, a reason, a day count - never a credential
 * or an internal error.
 */
export type AdminActionDetail = Record<string, string | number | boolean | null>;

/**
 * The `admin` catalog key each action reads as.
 *
 * A key rather than a sentence, because the trail is read in the operator's own language:
 * this module is shared with the server, which must not guess a reader's locale, and the
 * activity screen resolves the key where the reader is. The same key is what the action's
 * toast says, so an action cannot read two ways in two places.
 */
const ADMIN_ACTION_KEYS = {
  "role.granted": "actionRoleGranted",
  "role.revoked": "actionRoleRemoved",
  "account.banned": "actionAccountSuspended",
  "account.unbanned": "actionAccountRestored",
  "account.sessions_revoked": "actionSessionsSignedOut",
  "account.deleted": "actionAccountDeleted",
  "impersonation.started": "actionImpersonationStarted",
  "impersonation.stopped": "actionImpersonationStopped",
  "report.upheld": "actionReportUpheld",
  "report.dismissed": "actionReportDismissed",
  "comment.removed": "actionCommentRemoved",
  "review.removed": "actionReviewRemoved",
  "author.merged": "actionAuthorMerged",
} as const satisfies Record<AdminAction, string>;

export type AdminActionKey = (typeof ADMIN_ACTION_KEYS)[AdminAction];

/**
 * The key an action reads as, or null when this release does not know the action. The caller
 * falls back to the raw value, so a row written by a newer deploy still renders something.
 */
export function adminActionKey(action: string): AdminActionKey | null {
  return isAdminAction(action) ? ADMIN_ACTION_KEYS[action] : null;
}

export function isAdminAction(action: string): action is AdminAction {
  return (ADMIN_ACTIONS as readonly string[]).includes(action);
}
