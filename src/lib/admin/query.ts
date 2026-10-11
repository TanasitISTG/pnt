import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { listAdminUsers } from "@/lib/admin/functions";
import type { AdminUserListSearch } from "@/lib/admin/schemas";

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
