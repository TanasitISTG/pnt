import { BookOpen } from "lucide-react";

export function LibraryEmpty({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
      <div
        className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted"
        aria-hidden="true"
      >
        <BookOpen className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h2 className="text-card-title font-semibold text-foreground">
        {isAdmin ? "No novels yet" : "Nothing published yet"}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {isAdmin
          ? "Create a novel project to start pasting chapters and translating them."
          : "Check back later — published novels will appear here."}
      </p>
    </div>
  );
}
