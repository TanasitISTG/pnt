import { Link } from "@tanstack/react-router";
import { ArrowLeft, Plus, Trash2, Upload } from "lucide-react";
import { useTranslations } from "use-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface GlossaryStats {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
}

interface GlossaryHeaderProps {
  novelId: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  stats: GlossaryStats | undefined;
  onAddClick: () => void;
  onImportClick: () => void;
  deletingAllTerms: boolean;
  onDeleteAllTerms: () => void;
}

export function GlossaryHeader({
  novelId,
  title,
  sourceLang,
  targetLang,
  stats,
  onAddClick,
  onImportClick,
  deletingAllTerms,
  onDeleteAllTerms,
}: GlossaryHeaderProps) {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          render={<Link to="/{-$locale}/novels/$novelId" params={{ novelId }} />}
          aria-label={t("glossaryBackToNovel")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" onClick={onAddClick}>
            <Plus className="size-4" />
            {t("glossaryAddTerm")}
          </Button>
          <Button variant="outline" size="sm" onClick={onImportClick}>
            <Upload className="size-4" />
            {t("glossaryBulkImport")}
          </Button>
          <Button
            variant="outlineDestructiveStrong"
            size="sm"
            onClick={onDeleteAllTerms}
            disabled={(stats?.total ?? 0) === 0 || deletingAllTerms}
          >
            <Trash2 className="size-4" />
            {deletingAllTerms ? tCommon("deleting") : t("glossaryDeleteAll")}
          </Button>
        </div>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-card-title sm:text-sub md:text-section font-semibold text-foreground tracking-tight">
              {t("glossaryTitle", { title })}
            </h1>
            <Badge variant="strongOutline" className="uppercase font-semibold text-xs">
              {sourceLang} → {targetLang}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{t("glossaryLead")}</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" size="stat">
            {t("glossaryTotal", { count: stats?.total ?? 0 })}
          </Badge>
          <Badge variant="successOutline" size="stat">
            {t("glossaryApprovedCount", { count: stats?.approved ?? 0 })}
          </Badge>
          {(stats?.pending ?? 0) > 0 && (
            <Badge variant="warningOutline" size="stat">
              {t("glossaryPendingCount", { count: stats?.pending ?? 0 })}
            </Badge>
          )}
          {(stats?.rejected ?? 0) > 0 && (
            <Badge variant="destructiveOutline" size="stat">
              {t("glossaryRejectedCount", { count: stats?.rejected ?? 0 })}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
