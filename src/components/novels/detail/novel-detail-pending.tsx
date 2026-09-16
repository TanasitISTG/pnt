export function NovelPending() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4">
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Loading novel…
      </div>
    </div>
  );
}
