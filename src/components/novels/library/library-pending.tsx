import { Skeleton } from "@/components/ui/skeleton";

const SHELF_SKELETON_KEYS = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

/** Shapes that match the shelf it will become, so the swap does not move the page. */
export function LibraryPending() {
  return (
    <div className="flex flex-col gap-8" role="status" aria-label="Loading library…">
      <span className="sr-only">Loading library…</span>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton shape="panel" className="h-14" aria-hidden="true" />
      <div
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4"
        aria-hidden="true"
      >
        {SHELF_SKELETON_KEYS.map((key) => (
          <div key={key} className="overflow-hidden rounded-xl border border-border bg-card">
            <Skeleton shape="media" />
            <div className="flex flex-col gap-2 p-3.5">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
