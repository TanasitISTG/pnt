import { Link } from "@tanstack/react-router";
import { ArrowLeft, Upload } from "lucide-react";

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
  onImportClick: () => void;
}

export function GlossaryHeader({
  novelId,
  title,
  sourceLang,
  targetLang,
  stats,
  onImportClick,
}: GlossaryHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          render={<Link to="/novels/$novelId" params={{ novelId }} />}
          aria-label="Back to novel details"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onImportClick}>
          <Upload className="size-4" />
          Bulk Import (TSV)
        </Button>
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
              className="px-3 py-1 text-xs font-mono text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10 animate-pulse"
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
