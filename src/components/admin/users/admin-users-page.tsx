import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTableRange } from "@/components/ui/data-table-parts";
import { Input } from "@/components/ui/input";
import { adminUsersQueryOptions } from "@/lib/admin/query";
import {
  removeUser,
  revokeUserSessions,
  setUserBanned,
  setUserRole,
  startImpersonation,
} from "@/lib/admin/functions";
import { ADMIN_USERS_PAGE_SIZE, type AdminUserListSearch } from "@/lib/admin/schemas";
import { AdminUserTableRow } from "./admin-user-row";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { SuspendUserDialog, type SuspendSubmission } from "./suspend-user-dialog";

export interface AdminUsersPageProps {
  /** The signed-in operator, so their own row offers no moderation actions. */
  currentUserId: string;
  search: AdminUserListSearch;
  onSearchChange: (patch: Partial<AdminUserListSearch>) => void;
}

interface PendingTarget {
  id: string;
  email: string;
}

export function AdminUsersPage({ currentUserId, search, onSearchChange }: AdminUsersPageProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const query = useQuery(adminUsersQueryOptions(search));
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingTarget | null>(null);
  const [pendingSuspend, setPendingSuspend] = useState<PendingTarget | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<PendingTarget | null>(null);
  const [pendingViewAs, setPendingViewAs] = useState<PendingTarget | null>(null);

  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? ADMIN_USERS_PAGE_SIZE;
  const data = query.data;
  const rowCount = data?.rowCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));

  const refresh = async (): Promise<void> => {
    // Every action also appends to the activity trail, so both lists are refreshed
    // together rather than leaving the tab behind the row it was started from.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["adminUsers"] }),
      queryClient.invalidateQueries({ queryKey: ["adminActivity"] }),
    ]);
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

  /**
   * Viewing as an account replaces the browser's session, so this deliberately skips
   * the list refresh: the calls that would follow belong to the operator, and the
   * session is no longer theirs.
   */
  const viewAsUser = async (userId: string) => {
    setBusyUserId(userId);
    try {
      await startImpersonation({ data: { userId } });
      queryClient.clear();
      await router.invalidate();
      await navigate({ to: "/" });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "That action did not go through");
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
                <TableHead className="hidden sm:table-cell">Terms</TableHead>
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
                  actions={{
                    onSetRole: (role) =>
                      void runAction(
                        row.id,
                        () => setUserRole({ data: { userId: row.id, role } }),
                        role === "admin" ? "Operator access granted" : "Operator access removed",
                      ),
                    onSuspend: () => setPendingSuspend({ id: row.id, email: row.email }),
                    onRestore: () =>
                      void runAction(
                        row.id,
                        () => setUserBanned({ data: { userId: row.id, banned: false } }),
                        "Account restored",
                      ),
                    onRevokeSessions: () => setPendingRevoke({ id: row.id, email: row.email }),
                    onViewAs: () => setPendingViewAs({ id: row.id, email: row.email }),
                    onRequestDelete: () => setPendingDelete({ id: row.id, email: row.email }),
                  }}
                />
              ))}
              {!query.isPending && (data?.rows.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center text-muted-foreground">
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

      <SuspendUserDialog
        // Remounted per target and per opening, which is how its reason and duration
        // fields start empty every time without an effect to reset them.
        key={`suspend-${pendingSuspend?.id ?? "none"}-${pendingSuspend ? "open" : "closed"}`}
        open={pendingSuspend !== null}
        email={pendingSuspend?.email ?? ""}
        busy={busyUserId === pendingSuspend?.id}
        onOpenChange={(open) => {
          if (!open) setPendingSuspend(null);
        }}
        onConfirm={(submission: SuspendSubmission) => {
          const target = pendingSuspend;
          if (!target) return;
          void runAction(
            target.id,
            () =>
              setUserBanned({
                data: {
                  userId: target.id,
                  banned: true,
                  banReason: submission.banReason,
                  banExpiresInDays: submission.banExpiresInDays,
                },
              }),
            "Account suspended",
          ).finally(() => setPendingSuspend(null));
        }}
      />

      <ConfirmActionDialog
        open={pendingRevoke !== null}
        title="Sign this account out everywhere?"
        description={
          pendingRevoke
            ? `Every session ${pendingRevoke.email} holds is ended, including any the account is signed in on right now. It can sign back in with its password.`
            : ""
        }
        confirmLabel="Sign out all devices"
        cancelLabel="Keep sessions"
        busy={busyUserId === pendingRevoke?.id}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        onConfirm={() => {
          const target = pendingRevoke;
          if (!target) return;
          void runAction(
            target.id,
            () => revokeUserSessions({ data: { userId: target.id } }),
            "Sessions signed out",
          ).finally(() => setPendingRevoke(null));
        }}
      />

      <ConfirmActionDialog
        open={pendingViewAs !== null}
        title="View as this account?"
        description={
          pendingViewAs
            ? `You will browse Pnt as ${pendingViewAs.email} for up to 30 minutes. The view is read-only: nothing you do can change that account's novels, chapters, or reader state. A banner at the top of every page returns you to your operator account.`
            : ""
        }
        confirmLabel="View as this account"
        cancelLabel="Cancel"
        busy={busyUserId === pendingViewAs?.id}
        onOpenChange={(open) => {
          if (!open) setPendingViewAs(null);
        }}
        onConfirm={() => {
          const target = pendingViewAs;
          if (!target) return;
          setPendingViewAs(null);
          void viewAsUser(target.id);
        }}
      />

      <ConfirmActionDialog
        open={pendingDelete !== null}
        title="Delete this account?"
        description={
          pendingDelete
            ? `${pendingDelete.email} and everything it owns — novels, chapters, glossary, and reader state — are removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete account"
        cancelLabel="Keep account"
        destructive
        busy={busyUserId === pendingDelete?.id}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          void runAction(
            target.id,
            () => removeUser({ data: { userId: target.id } }),
            "Account deleted",
          ).finally(() => setPendingDelete(null));
        }}
      />
    </div>
  );
}
