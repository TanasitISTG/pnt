import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export function LibraryNoMatches({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      icon={<Search />}
      title="No novels match these filters"
      description="Try a different search, or clear the filters to see everything."
      size="compact"
    >
      <Button type="button" variant="outline" onClick={onClear}>
        <X className="size-3.5" aria-hidden="true" />
        Clear filters
      </Button>
    </EmptyState>
  );
}
