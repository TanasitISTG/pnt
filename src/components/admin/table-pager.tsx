import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";

export interface TablePagerProps {
  page: number;
  pageSize: number;
  rowCount: number;
  /** The noun the range is counted in, e.g. "accounts" or "actions". */
  noun: string;
  isPending: boolean;
  onPageChange: (page: number) => void;
}

/**
 * The pager every console table shares.
 *
 * The operator tables list a bounded, ordered set, so they page by range rather than by
 * a react-table instance: the tools that need sorting and column visibility already own
 * their own pager, and these four do not. Page one is expressed by omitting the search
 * parameter rather than writing `page=1`, so the queue's default URL stays clean.
 *
 * The range sentence and the two buttons come from `common`, the same way the toolbar's
 * do: the surface supplies its noun and the catalog supplies the grammar around it, so
 * English reads "1–25 of 1,200 terms" while Thai reads "1–25 จาก 1,200 คำศัพท์".
 */
export function TablePager({
  page,
  pageSize,
  rowCount,
  noun,
  isPending,
  onPageChange,
}: TablePagerProps) {
  const t = useTranslations("common");
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
      <span className="text-caption tabular-nums text-muted-foreground">
        {rowCount === 0
          ? t("tableRangeEmpty", { noun })
          : t("tableRange", {
              first: (page - 1) * pageSize + 1,
              last: Math.min(page * pageSize, rowCount),
              total: rowCount,
              noun,
            })}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || isPending}
          onClick={() => onPageChange(page - 1)}
        >
          {t("previous")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount || isPending}
          onClick={() => onPageChange(page + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
