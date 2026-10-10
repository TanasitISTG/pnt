const LIBRARY_SKELETON_KEYS = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

export function LibraryPending() {
  return (
    <div className="flex flex-col gap-8" role="status" aria-label="Loading library…">
      <span className="sr-only">Loading library…</span>
      <div className="space-y-2" aria-hidden="true">
        <div className="motion-safe:animate-pulse h-9 w-44 rounded-md bg-muted" />
        <div className="motion-safe:animate-pulse h-5 w-72 rounded-md bg-muted" />
      </div>
      <div
        className="motion-safe:animate-pulse h-24 rounded-xl border border-border bg-card"
        aria-hidden="true"
      />
      <div
        className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4"
        aria-hidden="true"
      >
        {LIBRARY_SKELETON_KEYS.map((key) => (
          <div key={key} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="motion-safe:animate-pulse aspect-3/4 bg-muted" />
            <div className="space-y-3 p-4">
              <div className="motion-safe:animate-pulse h-5 rounded bg-muted" />
              <div className="motion-safe:animate-pulse h-4 w-2/3 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
