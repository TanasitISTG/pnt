import { useLocale, useTranslations } from "use-intl";

import { TableCell, TableRow } from "@/components/ui/table";
import { adminActionKey } from "@/lib/admin/audit";
import { formatDateTime } from "@/lib/i18n/format";
import type { AdminActivityRow } from "@/lib/admin/functions";

const EM_DASH = "—";

/** The `admin` translator, named so the detail builder can take one without being a hook. */
type AdminTranslator = ReturnType<typeof useTranslations<"admin">>;

/** Snapshotted address when the trail has one, the id otherwise, and a dash for a global action. */
function accountLabel(email: string | null, id: string | null): string {
  return email ?? id ?? EM_DASH;
}

/**
 * Only the keys the operator functions actually record are rendered, so a future
 * `detail` field cannot leak something a reader should not see — an unlisted key
 * simply does not appear.
 */
function describeDetail(detail: Record<string, unknown> | null, t: AdminTranslator): string | null {
  if (!detail) return null;

  const parts: string[] = [];

  const role = detail["role"];
  if (typeof role === "string" && role) {
    parts.push(role === "admin" ? t("roleOperator") : t("roleMember"));
  }

  // A quoted value is punctuation and data, not a sentence: the same marks wrap an
  // operator's reason and the title of the novel a decision was about.
  const reason = detail["reason"];
  if (typeof reason === "string" && reason) parts.push(`“${reason}”`);

  // A suspension always records `expiresInDays`; null there means it has no end.
  if ("expiresInDays" in detail) {
    const days = detail["expiresInDays"];
    parts.push(typeof days === "number" ? t("activityDays", { days }) : t("activityPermanent"));
  }

  // A report decision records the novel it was about and how many reports it closed,
  // which is what makes the trail row readable months later, after the novel is gone.
  const novelTitle = detail["novelTitle"];
  if (typeof novelTitle === "string" && novelTitle) parts.push(`“${novelTitle}”`);

  const reports = detail["reports"];
  if (typeof reports === "number") {
    parts.push(t("activityReportCount", { count: reports }));
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The action's own name, in the reader's language, or the stored dotted name when this
 * release does not know the action a newer deploy recorded.
 */
function actionLabel(t: AdminTranslator, action: string): string {
  const key = adminActionKey(action);
  return key ? t(key) : action;
}

/**
 * The same row as a block for a phone.
 *
 * The trail has five columns and two long account strings, so at 390px the table was
 * 679px wide and scrolling sideways under a header that no longer lined up with
 * anything. Stacked, every field keeps its own line and the row stays readable.
 */
export function AdminActivityMobileRow({ row }: { row: AdminActivityRow }) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const detail = describeDetail(row.detail, t);

  return (
    <article className="space-y-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="font-medium text-foreground">{actionLabel(t, row.action)}</p>
        <p className="text-caption text-muted-foreground">
          {formatDateTime(row.createdAt, locale)}
        </p>
      </div>
      <dl className="space-y-1 text-caption">
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">{t("columnOperator")}</dt>
          <dd className="min-w-0 truncate text-foreground">
            {accountLabel(row.actorEmail, row.actorId)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">{t("columnAccount")}</dt>
          <dd className="min-w-0 truncate text-foreground">
            {accountLabel(row.targetEmail, row.targetUserId)}
          </dd>
        </div>
        {detail ? (
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">{t("columnDetails")}</dt>
            <dd className="min-w-0 whitespace-normal text-muted-foreground">{detail}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

export function AdminActivityTableRow({ row }: { row: AdminActivityRow }) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const detail = describeDetail(row.detail, t);

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">{actionLabel(t, row.action)}</TableCell>
      <TableCell className="text-muted-foreground">
        {accountLabel(row.actorEmail, row.actorId)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {accountLabel(row.targetEmail, row.targetUserId)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDateTime(row.createdAt, locale)}
      </TableCell>
      <TableCell className="max-w-64 whitespace-normal text-caption text-muted-foreground">
        {detail ?? EM_DASH}
      </TableCell>
    </TableRow>
  );
}
