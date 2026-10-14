import { Search, X } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export function LibraryNoMatches({ onClear }: { onClear: () => void }) {
  const t = useTranslations("catalog");

  return (
    <EmptyState
      icon={<Search />}
      title={t("noMatchesTitle")}
      description={t("noMatchesDescription")}
      size="compact"
    >
      <Button type="button" variant="outline" onClick={onClear}>
        <X className="size-3.5" aria-hidden="true" />
        {t("clearFilters")}
      </Button>
    </EmptyState>
  );
}
