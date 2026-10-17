import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { TablePager } from "@/components/admin/table-pager";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { DataTableSection } from "@/components/ui/data-table-parts";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
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
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
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
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
      setBusyUserId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-section font-semibold text-foreground">{t("usersTitle")}</h1>
          <p className="mt-1 text-body text-muted-foreground">{t("usersDescription")}</p>
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
            placeholder={t("usersSearchPlaceholder")}
            aria-label={t("usersSearchLabel")}
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
          title={t("usersLoadFailed")}
          error={query.error}
          onRetry={() => void query.refetch()}
          className="min-h-[40vh]"
        />
      ) : (
        <DataTableSection
          ariaLabel={t("usersTableAria")}
          busy={query.isFetching || query.isPlaceholderData}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columnAccount")}</TableHead>
                <TableHead>{t("columnRole")}</TableHead>
                <TableHead>{t("columnStatus")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("columnTerms")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("columnJoined")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("columnActions")}</span>
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
                        role === "admin" ? t("actionRoleGranted") : t("actionRoleRemoved"),
                      ),
                    onSuspend: () => setPendingSuspend({ id: row.id, email: row.email }),
                    onRestore: () =>
                      void runAction(
                        row.id,
                        () => setUserBanned({ data: { userId: row.id, banned: false } }),
                        t("actionAccountRestored"),
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
                    {search.q ? t("usersEmptySearch") : t("usersEmpty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePager
            page={page}
            pageSize={pageSize}
            rowCount={rowCount}
            noun={t("nounAccounts")}
            isPending={query.isPending}
            onPageChange={(next) => onSearchChange({ page: next <= 1 ? undefined : next })}
          />
        </DataTableSection>
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
            t("actionAccountSuspended"),
          ).finally(() => setPendingSuspend(null));
        }}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        title={t("confirmRevokeTitle")}
        description={pendingRevoke ? t("confirmRevokeBody", { email: pendingRevoke.email }) : ""}
        confirmText={t("confirmRevokeConfirm")}
        cancelText={t("confirmRevokeCancel")}
        pending={busyUserId === pendingRevoke?.id}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        onConfirm={() => {
          const target = pendingRevoke;
          if (!target) return;
          void runAction(
            target.id,
            () => revokeUserSessions({ data: { userId: target.id } }),
            t("actionSessionsSignedOut"),
          ).finally(() => setPendingRevoke(null));
        }}
      />

      <ConfirmDialog
        open={pendingViewAs !== null}
        title={t("confirmViewAsTitle")}
        description={pendingViewAs ? t("confirmViewAsBody", { email: pendingViewAs.email }) : ""}
        confirmText={t("actionViewAs")}
        cancelText={tCommon("cancel")}
        pending={busyUserId === pendingViewAs?.id}
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

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("confirmDeleteTitle")}
        description={pendingDelete ? t("confirmDeleteBody", { email: pendingDelete.email }) : ""}
        confirmText={t("actionDelete")}
        cancelText={t("confirmDeleteCancel")}
        variant="destructive"
        pending={busyUserId === pendingDelete?.id}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          void runAction(
            target.id,
            () => removeUser({ data: { userId: target.id } }),
            t("actionAccountDeleted"),
          ).finally(() => setPendingDelete(null));
        }}
      />
    </div>
  );
}
