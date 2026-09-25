const READER_SKELETON_ROWS = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

export function ReaderPending() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading chapter…">
      <span className="sr-only">Loading chapter…</span>
      <div
        className="h-14 motion-safe:animate-pulse rounded-xl border border-border bg-card"
        aria-hidden="true"
      />
      <div className="space-y-3" aria-hidden="true">
        <div className="h-8 w-2/3 motion-safe:animate-pulse rounded bg-muted" />
        <div className="h-5 w-1/3 motion-safe:animate-pulse rounded bg-muted" />
      </div>
      <div className="mx-auto w-full max-w-prose space-y-5" aria-hidden="true">
        {READER_SKELETON_ROWS.map((row) => (
          <div key={row} className="h-5 motion-safe:animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
