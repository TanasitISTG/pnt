import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LibraryNoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
      <Search className="size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-3 text-card-title font-semibold text-foreground">
        No novels match these filters
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Try a different search or clear the filters.
      </p>
      <Button type="button" variant="outline" className="mt-5" onClick={onClear}>
        <X className="size-3.5" aria-hidden="true" />
        Clear filters
      </Button>
    </div>
  );
}
