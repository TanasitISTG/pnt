import { z } from "zod";

/** Roles an operator screen may assign. Sign-up only ever produces `user`. */
export const ADMIN_ASSIGNABLE_ROLES = ["user", "admin"] as const;
export const ADMIN_USERS_PAGE_SIZE = 25;
export const ADMIN_ACTIVITY_PAGE_SIZE = 25;
export const BAN_REASON_MAX_LENGTH = 200;

/**
 * Durations the suspend dialog offers. Kept here so the picker and the validator
 * cannot drift apart.
 */
export const BAN_DURATION_DAYS = [7, 30, 90] as const;
export type BanDurationDays = (typeof BAN_DURATION_DAYS)[number];

/**
 * Search and paging for the operator user list. Every field carries a `.catch`, so a
 * hand-edited or stale URL degrades to the default view instead of throwing a
 * validation error at the router.
 */
export const adminUserListSearchSchema = z.object({
  q: z.string().max(BAN_REASON_MAX_LENGTH).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
  pageSize: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
});

export type AdminUserListSearch = z.infer<typeof adminUserListSearchSchema>;

export const adminUserListInputSchema = adminUserListSearchSchema.transform((value) => ({
  q: value.q?.trim() ?? "",
  page: value.page ?? 1,
  pageSize: value.pageSize ?? ADMIN_USERS_PAGE_SIZE,
}));

export type AdminUserListInput = z.infer<typeof adminUserListInputSchema>;

export const adminUserIdSchema = z.object({ userId: z.string().min(1) });

/**
 * Paging for the operator activity list, with the same forgiving `.catch` treatment
 * as the account list. There is no search term: the trail is short and read in order.
 */
export const adminActivitySearchSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
  pageSize: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
});

export type AdminActivitySearch = z.infer<typeof adminActivitySearchSchema>;

export const adminActivityInputSchema = adminActivitySearchSchema.transform((value) => ({
  page: value.page ?? 1,
  pageSize: value.pageSize ?? ADMIN_ACTIVITY_PAGE_SIZE,
}));

export type AdminActivityInput = z.infer<typeof adminActivityInputSchema>;

export const setUserRoleSchema = adminUserIdSchema.extend({
  role: z.enum(ADMIN_ASSIGNABLE_ROLES),
});

export const setUserBannedSchema = adminUserIdSchema.extend({
  banned: z.boolean(),
  banReason: z.string().trim().max(BAN_REASON_MAX_LENGTH).optional(),
  /** Days until the ban lifts; omit for a permanent ban. */
  banExpiresInDays: z.number().int().min(1).max(3650).optional(),
});

export type SetUserBannedInput = z.infer<typeof setUserBannedSchema>;

export type AdminUserListSearchInput = z.input<typeof adminUserListSearchSchema>;
