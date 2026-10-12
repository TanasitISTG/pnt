/**
 * How a stored ban reads on the operator screen.
 *
 * The admin plugin only enforces a ban when the account next creates a session, and
 * it clears a lapsed `banExpires` at that same moment - so a time-limited suspension
 * can sit in the row long after it stopped applying. Reading `banned` on its own
 * would therefore tell an operator that an account is still locked out when its own
 * expiry has already passed. Every surface asks this module instead.
 */

export interface StoredBan {
  banned: boolean;
  banExpires: Date | null;
}

export type BanState = "active" | "suspended" | "expired";

export interface BanStatus {
  state: BanState;
  /** When a time-limited suspension lapses; null for a permanent one. */
  expiresAt: Date | null;
}

export function describeBan(ban: StoredBan, now: Date = new Date()): BanStatus {
  if (!ban.banned) return { state: "active", expiresAt: null };

  const expiresAt = ban.banExpires ? new Date(ban.banExpires) : null;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return { state: "expired", expiresAt };
  return { state: "suspended", expiresAt };
}
