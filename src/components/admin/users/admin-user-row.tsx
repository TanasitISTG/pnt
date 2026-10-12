import { Ban, Eye, LogOut, MoreHorizontal, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { TableCell, TableRow } from "@/components/ui/table";
import { describeBan } from "@/lib/admin/ban-status";
import type { AdminUserRow } from "@/lib/admin/functions";
import { hasAdminRole } from "@/lib/auth/roles";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

export interface AdminUserRowActions {
  onSetRole: (role: "user" | "admin") => void;
  onSuspend: () => void;
  onRestore: () => void;
  onRevokeSessions: () => void;
  onViewAs: () => void;
  onRequestDelete: () => void;
}

/**
 * Status comes from `describeBan`, never from the stored flag: the plugin leaves a
 * lapsed ban on the row until that account next signs in, so `banned` alone would
 * report a suspension that has already stopped applying.
 */
function SuspensionStatus({ row }: { row: AdminUserRow }) {
  const status = describeBan(row);

  return (
    <div className="flex flex-col gap-1">
      {status.state === "active" ? (
        <Badge variant="secondary">{row.emailVerified ? "Verified" : "Unverified"}</Badge>
      ) : status.state === "expired" ? (
        <Badge variant="warning">Suspended (expired)</Badge>
      ) : (
        <Badge variant="destructive">
          {status.expiresAt
            ? `Suspended until ${status.expiresAt.toLocaleDateString()}`
            : "Suspended"}
        </Badge>
      )}
      {status.state !== "active" && row.banReason && (
        <span className="text-caption text-muted-foreground">{row.banReason}</span>
      )}
    </div>
  );
}

function TermsStatus({ row }: { row: AdminUserRow }) {
  if (!row.termsVersion) {
    return <span className="text-caption text-muted-foreground">Not recorded</span>;
  }

  const outdated = row.termsVersion !== CURRENT_TERMS_VERSION;
  return (
    <div className="flex flex-col gap-1">
      {outdated ? (
        <Badge variant="warning">Outdated</Badge>
      ) : (
        <span className="text-caption text-muted-foreground">{row.termsVersion}</span>
      )}
      {row.termsAcceptedAt && (
        <span className="text-caption text-muted-foreground">
          {new Date(row.termsAcceptedAt).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

export function AdminUserTableRow({
  row,
  isSelf,
  busy,
  actions,
}: {
  row: AdminUserRow;
  isSelf: boolean;
  busy: boolean;
  actions: AdminUserRowActions;
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
        <SuspensionStatus row={row} />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <TermsStatus row={row} />
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
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuGroup>
                {isOperator ? (
                  <DropdownMenuItem onClick={() => actions.onSetRole("user")}>
                    <ShieldOff className="size-4" />
                    Remove operator access
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => actions.onSetRole("admin")}>
                    <ShieldCheck className="size-4" />
                    Grant operator access
                  </DropdownMenuItem>
                )}
                {row.banned ? (
                  <DropdownMenuItem onClick={actions.onRestore}>
                    <ShieldCheck className="size-4" />
                    Restore account
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={actions.onSuspend}>
                    <Ban className="size-4" />
                    Suspend account
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={actions.onRevokeSessions}>
                  <LogOut className="size-4" />
                  Sign out all devices
                </DropdownMenuItem>
                {/* Operator accounts cannot be viewed as another account, so the
                    action is absent rather than present and failing. */}
                {!isOperator && (
                  <DropdownMenuItem onClick={actions.onViewAs}>
                    <Eye className="size-4" />
                    View as this account
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={actions.onRequestDelete}>
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
