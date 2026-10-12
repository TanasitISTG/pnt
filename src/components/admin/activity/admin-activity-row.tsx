import { TableCell, TableRow } from "@/components/ui/table";
import { describeAdminAction } from "@/lib/admin/audit";
import type { AdminActivityRow } from "@/lib/admin/functions";

const EM_DASH = "—";

/** Snapshotted address when the trail has one, the id otherwise, and a dash for a global action. */
function accountLabel(email: string | null, id: string | null): string {
  return email ?? id ?? EM_DASH;
}

/**
 * Only the keys the operator functions actually record are rendered, so a future
 * `detail` field cannot leak something a reader should not see — an unlisted key
 * simply does not appear.
 */
function describeDetail(detail: Record<string, unknown> | null): string | null {
  if (!detail) return null;

  const parts: string[] = [];

  const role = detail["role"];
  if (typeof role === "string" && role) parts.push(role === "admin" ? "Operator" : "Member");

  const reason = detail["reason"];
  if (typeof reason === "string" && reason) parts.push(`“${reason}”`);

  // A suspension always records `expiresInDays`; null there means it has no end.
  if ("expiresInDays" in detail) {
    const days = detail["expiresInDays"];
    parts.push(typeof days === "number" ? `${days} days` : "Permanent");
  }

  // A report decision records the novel it was about and how many reports it closed,
  // which is what makes the trail row readable months later, after the novel is gone.
  const novelTitle = detail["novelTitle"];
  if (typeof novelTitle === "string" && novelTitle) parts.push(`“${novelTitle}”`);

  const reports = detail["reports"];
  if (typeof reports === "number") {
    parts.push(`${reports} ${reports === 1 ? "report" : "reports"}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function AdminActivityTableRow({ row }: { row: AdminActivityRow }) {
  const detail = describeDetail(row.detail);

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">
        {describeAdminAction(row.action)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {accountLabel(row.actorEmail, row.actorId)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {accountLabel(row.targetEmail, row.targetUserId)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {new Date(row.createdAt).toLocaleString()}
      </TableCell>
      <TableCell className="max-w-64 whitespace-normal text-caption text-muted-foreground">
        {detail ?? EM_DASH}
      </TableCell>
    </TableRow>
  );
}
