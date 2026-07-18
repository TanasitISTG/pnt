import { createFileRoute } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";

export const Route = createFileRoute("/_protected/")({
  component: LibraryPlaceholder,
});

function LibraryPlaceholder() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-muted">
        <BookOpen className="size-8 text-muted-foreground" />
      </div>
      <h1 className="text-section">Your Library</h1>
      <p className="mt-2 max-w-md text-body-lg text-muted-foreground">
        Library features arrive in Phase 3. For now, the design scratch page is available at{" "}
        <a href="/design-scratch" className="text-foreground underline">
          /design-scratch
        </a>
        .
      </p>
    </div>
  );
}
