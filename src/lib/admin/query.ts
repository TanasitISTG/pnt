import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { listAdminActivity, listAdminUsers } from "@/lib/admin/functions";
import type { AdminActivitySearch, AdminUserListSearch } from "@/lib/admin/schemas";

/**
 * Operator user list. The search object is part of the key, so paging and filtering
 * each keep their own cache entry, and `keepPreviousData` avoids a blank table while
 * the next page arrives.
 */
export const adminUsersQueryOptions = (search: AdminUserListSearch) =>
  queryOptions({
    queryKey: ["adminUsers", search] as const,
    queryFn: () => listAdminUsers({ data: search }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

/**
 * Operator activity list. Kept under its own key so a moderation action only has to
 * invalidate the trail it just appended to.
 */
export const adminActivityQueryOptions = (search: AdminActivitySearch) =>
  queryOptions({
    queryKey: ["adminActivity", search] as const,
    queryFn: () => listAdminActivity({ data: search }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
