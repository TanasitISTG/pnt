import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import { TablePager } from "@/components/admin/table-pager";
import { QueryErrorState } from "@/components/query-error-state";
import {
  DataTableDesktopRegion,
  DataTableMobileRegion,
  DataTableSection,
} from "@/components/ui/data-table-parts";
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

import { AdminActivityMobileRow, AdminActivityTableRow } from "./admin-activity-row";

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
  const t = useTranslations("admin");
  const query = useQuery(adminActivityQueryOptions(search));

  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? ADMIN_ACTIVITY_PAGE_SIZE;
  const data = query.data;
  const rowCount = data?.rowCount ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-section font-semibold text-foreground">{t("activityTitle")}</h1>
        <p className="mt-1 text-body text-muted-foreground">{t("activityDescription")}</p>
      </div>

      {query.isError ? (
        <QueryErrorState
          title={t("activityLoadFailed")}
          error={query.error}
          onRetry={() => void query.refetch()}
          className="min-h-[40vh]"
        />
      ) : (
        <DataTableSection
          ariaLabel={t("activityAria")}
          busy={query.isFetching || query.isPlaceholderData}
        >
          {/* A phone gets one block per action rather than a five-column table it would
              have to drag sideways; the console's other tables already work this way. */}
          <DataTableMobileRegion ariaLabel={query.isPending ? undefined : t("activityMobileAria")}>
            {(data?.rows ?? []).map((row) => (
              <AdminActivityMobileRow key={row.id} row={row} />
            ))}
            {!query.isPending && (data?.rows.length ?? 0) === 0 && (
              <p className="p-4 text-center text-caption text-muted-foreground">
                {t("activityEmpty")}
              </p>
            )}
          </DataTableMobileRegion>
          <DataTableDesktopRegion ariaLabel={t("activityDesktopAria")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columnAction")}</TableHead>
                  <TableHead>{t("columnOperator")}</TableHead>
                  <TableHead>{t("columnAccount")}</TableHead>
                  <TableHead>{t("columnWhen")}</TableHead>
                  <TableHead>{t("columnDetails")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.rows ?? []).map((row) => (
                  <AdminActivityTableRow key={row.id} row={row} />
                ))}
                {!query.isPending && (data?.rows.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
                      {t("activityEmpty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DataTableDesktopRegion>
          <TablePager
            page={page}
            pageSize={pageSize}
            rowCount={rowCount}
            noun={t("nounActions")}
            isPending={query.isPending}
            onPageChange={(next) => onSearchChange({ page: next <= 1 ? undefined : next })}
          />
        </DataTableSection>
      )}
    </div>
  );
}
