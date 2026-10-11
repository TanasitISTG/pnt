import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, MoreHorizontal, Search, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTableRange } from "@/components/ui/data-table-parts";
import { hasAdminRole } from "@/lib/auth/roles";
import { adminUsersQueryOptions } from "@/lib/admin/query";
import { removeUser, setUserBanned, setUserRole, type AdminUserRow } from "@/lib/admin/functions";
import { ADMIN_USERS_PAGE_SIZE, type AdminUserListSearch } from "@/lib/admin/schemas";

export interface AdminUsersPageProps {
  /** The signed-in operator, so their own row offers no moderation actions. */
  currentUserId: string;
  search: AdminUserListSearch;
  onSearchChange: (patch: Partial<AdminUserListSearch>) => void;
}

interface PendingDelete {
  id: string;
  email: string;
}

export function AdminUsersPage({ currentUserId, search, onSearchChange }: AdminUsersPageProps) {
  const queryClient = useQueryClient();
  const query = useQuery(adminUsersQueryOptions(search));
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? ADMIN_USERS_PAGE_SIZE;
  const data = query.data;
  const rowCount = data?.rowCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
  };

  /**
   * One moderation call at a time, keyed by the row it belongs to: the buttons all
   * write to the same list, and a second click while the first is in flight would
   * otherwise apply against a list that has not caught up yet.
   */
  const runAction = async (userId: string, action: () => Promise<unknown>, message: string) => {
    setBusyUserId(userId);
    try {
      await action();
      toast.success(message);
      await refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "That action did not go through");
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-sub font-semibold tracking-tight text-foreground sm:text-section">
            Accounts
          </h1>
          <p className="mt-1 text-body text-muted-foreground">
            Every account, with the operator controls that apply to it.
          </p>
        </div>
        <div className="relative sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            type="search"
            value={search.q ?? ""}
            placeholder="Search name, email, or role"
            aria-label="Search accounts"
            onChange={(event) =>
              // Any change to the query invalidates the current offset, so paging
              // resets with the search rather than pointing past the new result set.
              onSearchChange({ q: event.target.value || undefined, page: undefined })
            }
          />
        </div>
      </div>

      {query.isError ? (
        <QueryErrorState
          title="Failed to load accounts"
          error={query.error}
          onRetry={() => void query.refetch()}
          className="min-h-[40vh]"
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Joined</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((row) => (
                <AdminUserTableRow
                  key={row.id}
                  row={row}
                  isSelf={row.id === currentUserId}
                  busy={busyUserId === row.id}
                  onSetRole={(role) =>
                    runAction(
                      row.id,
                      () => setUserRole({ data: { userId: row.id, role } }),
                      role === "admin" ? "Operator access granted" : "Operator access removed",
                    )
                  }
                  onSetBanned={(banned) =>
                    runAction(
                      row.id,
                      () => setUserBanned({ data: { userId: row.id, banned } }),
                      banned ? "Account suspended" : "Account restored",
                    )
                  }
                  onRequestDelete={() => setPendingDelete({ id: row.id, email: row.email })}
                />
              ))}
              {!query.isPending && (data?.rows.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
                    {search.q
                      ? "No accounts match that search."
                      : "No accounts have been created yet."}
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
                "accounts",
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

      <DeleteAccountDialog
        pending={pendingDelete}
        busy={busyUserId === pendingDelete?.id}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={(target) => {
          setPendingDelete(null);
          void runAction(
            target.id,
            () => removeUser({ data: { userId: target.id } }),
            "Account deleted",
          );
        }}
      />
    </div>
  );
}

function AdminUserTableRow({
  row,
  isSelf,
  busy,
  onSetRole,
  onSetBanned,
  onRequestDelete,
}: {
  row: AdminUserRow;
  isSelf: boolean;
  busy: boolean;
  onSetRole: (role: "user" | "admin") => void;
  onSetBanned: (banned: boolean) => void;
  onRequestDelete: () => void;
}) {
  const isOperator = hasAdminRole(row.role);

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{row.name}</span>
          <span className="text-caption text-muted-foreground">{row.email}</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={isOperator ? "default" : "secondary"}>
          {isOperator ? "Operator" : "Member"}
        </Badge>
      </TableCell>
      <TableCell>
        {row.banned ? (
          <div className="flex flex-col">
            <Badge variant="destructive">Suspended</Badge>
            {row.banReason && (
              <span className="mt-1 text-caption text-muted-foreground">{row.banReason}</span>
            )}
          </div>
        ) : (
          <Badge variant="secondary">{row.emailVerified ? "Verified" : "Unverified"}</Badge>
        )}
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {new Date(row.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell>
        {isSelf ? (
          <span className="text-caption text-muted-foreground">You</span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className="size-9" />}
              aria-label={`Actions for ${row.email}`}
              disabled={busy}
            >
              {busy ? <Spinner /> : <MoreHorizontal className="size-4" aria-hidden="true" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                {isOperator ? (
                  <DropdownMenuItem onClick={() => onSetRole("user")}>
                    <ShieldOff className="size-4" />
                    Remove operator access
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onSetRole("admin")}>
                    <ShieldCheck className="size-4" />
                    Grant operator access
                  </DropdownMenuItem>
                )}
                {row.banned ? (
                  <DropdownMenuItem onClick={() => onSetBanned(false)}>
                    <ShieldCheck className="size-4" />
                    Restore account
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onSetBanned(true)}>
                    <Ban className="size-4" />
                    Suspend account
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onRequestDelete}>
                <Trash2 className="size-4" />
                Delete account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

function DeleteAccountDialog({
  pending,
  busy,
  onOpenChange,
  onConfirm,
}: {
  pending: PendingDelete | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (target: PendingDelete) => void;
}) {
  return (
    <Dialog open={pending !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this account?</DialogTitle>
          <DialogDescription>
            {pending
              ? `${pending.email} and everything it owns — novels, chapters, glossary, and reader state — are removed. This cannot be undone.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep account
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (pending) onConfirm(pending);
            }}
          >
            {busy && <Spinner />}
            Delete account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
