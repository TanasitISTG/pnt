import { useQuery } from "@tanstack/react-query";

import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { formatTableRange } from "@/components/ui/data-table-parts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminActivityQueryOptions } from "@/lib/admin/query";
import { ADMIN_ACTIVITY_PAGE_SIZE, type AdminActivitySearch } from "@/lib/admin/schemas";

import { AdminActivityTableRow } from "./admin-activity-row";

export interface AdminActivityPageProps {
  search: AdminActivitySearch;
  onSearchChange: (patch: Partial<AdminActivitySearch>) => void;
}

/**
 * The durable record of operator actions, newest first. It reads our own audit table
 * rather than the process log, so a moderation decision stays reviewable after the
 * log it originally printed to has rotated away.
 */
export function AdminActivityPage({ search, onSearchChange }: AdminActivityPageProps) {
  const query = useQuery(adminActivityQueryOptions(search));

  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? ADMIN_ACTIVITY_PAGE_SIZE;
  const data = query.data;
  const rowCount = data?.rowCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-sub font-semibold tracking-tight text-foreground sm:text-section">
          Operator activity
        </h1>
        <p className="mt-1 text-body text-muted-foreground">
          Every moderation, impersonation, and account action an operator has taken, and which
          account it applied to.
        </p>
      </div>

      {query.isError ? (
        <QueryErrorState
          title="Failed to load operator activity"
          error={query.error}
          onRetry={() => void query.refetch()}
          className="min-h-[40vh]"
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="hidden sm:table-cell">When</TableHead>
                <TableHead className="hidden md:table-cell">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((row) => (
                <AdminActivityTableRow key={row.id} row={row} />
              ))}
              {!query.isPending && (data?.rows.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
                    No operator activity yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
            <span className="text-caption text-muted-foreground">
              {formatTableRange(
                rowCount === 0 ? 0 : (page - 1) * pageSize + 1,
                Math.min(page * pageSize, rowCount),
                rowCount,
                "actions",
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || query.isPending}
                onClick={() => onSearchChange({ page: page - 1 <= 1 ? undefined : page - 1 })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount || query.isPending}
                onClick={() => onSearchChange({ page: page + 1 })}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
