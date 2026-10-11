import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface LibraryEmptyProps {
  /** True only in the signed-in workspace (`scope === "mine"`). */
  canManage: boolean;
  signedIn: boolean;
}

/**
 * The empty state doubles as the guest's onboarding: a visitor who lands on a catalog
 * with nothing published yet is the one person who can change that, so the call to
 * action is here rather than only behind the header's account menu.
 */
export function LibraryEmpty({ canManage, signedIn }: LibraryEmptyProps) {
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
      <div
        className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted"
        aria-hidden="true"
      >
        <BookOpen className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h2 className="text-card-title font-semibold text-foreground">
        {canManage ? "No novels yet" : signedIn ? "Nothing published yet" : "No novels yet"}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {canManage
          ? "Create a novel project to start pasting chapters and translating them."
          : signedIn
            ? "Check back later — published novels from other translators will appear here."
            : "Create a free account to translate your own novels, with a side-by-side reader and glossary."}
      </p>
      {!canManage && !signedIn && (
        <div className="mt-5 flex items-center gap-2">
          <Button render={<Link to="/signup" />}>Create account</Button>
          <Button variant="outline" render={<Link to="/login" />}>
            Sign in
          </Button>
        </div>
      )}
    </div>
  );
}
