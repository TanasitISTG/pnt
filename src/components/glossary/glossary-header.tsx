import { Link } from "@tanstack/react-router";
import { ArrowLeft, Plus, Trash2, Upload } from "lucide-react";

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
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          render={<Link to="/novels/$novelId" params={{ novelId }} />}
          aria-label="Back to novel details"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" onClick={onAddClick}>
            <Plus className="size-4" />
            Add term
          </Button>
          <Button variant="outline" size="sm" onClick={onImportClick}>
            <Upload className="size-4" />
            Bulk Import (TSV)
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={onDeleteAllTerms}
            disabled={(stats?.total ?? 0) === 0 || deletingAllTerms}
          >
            <Trash2 className="size-4" />
            {deletingAllTerms ? "Deleting..." : "Delete all terms"}
          </Button>
        </div>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-card-title sm:text-sub md:text-section font-semibold text-foreground tracking-tight">
              {title} Glossary
            </h1>
            <Badge
              variant="outline"
              className="uppercase font-semibold text-xs border-foreground/40"
            >
              {sourceLang} → {targetLang}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Maintain consistent names, places, skills, and terminology for translations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="px-3 py-1 text-xs font-mono">
            Total: {stats?.total ?? 0}
          </Badge>
          <Badge
            variant="outline"
            className="px-3 py-1 text-xs font-mono text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
          >
            Approved: {stats?.approved ?? 0}
          </Badge>
          {(stats?.pending ?? 0) > 0 && (
            <Badge
              variant="outline"
              className="px-3 py-1 text-xs font-mono text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10"
            >
              Pending: {stats?.pending}
            </Badge>
          )}
          {(stats?.rejected ?? 0) > 0 && (
            <Badge
              variant="outline"
              className="px-3 py-1 text-xs font-mono text-destructive border-destructive/40 bg-destructive/10"
            >
              Rejected: {stats?.rejected}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
