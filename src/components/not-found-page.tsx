import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";

import { QuietPage } from "@/components/quiet-page";
import { QuietShell } from "@/components/shell/quiet-shell";
import { Button } from "@/components/ui/button";

/**
 * The page for an address that has nothing on it: an unmatched URL, a novel that does not
 * exist or is still private, a chapter that was unpublished.
 *
 * It always renders inside `QuietShell`, and that is not a guess: a not-found is resolved at
 * the root of the tree, whether it was raised by a loader (`/novels/<gone>`) or while a
 * component rendered (`reader-page.tsx`), so no layout survives above it and nothing else is
 * going to supply a header, a footer or a `<main>` landmark. Errors behave the other way
 * round - they render inside whatever layout is still standing - which is why `ErrorPage`
 * checks before framing itself and this page does not.
 */
export function NotFoundPage() {
  return (
    <QuietShell>
      <QuietPage
        code="404"
        icon={<BookOpen />}
        title="Page not found"
        description="Nothing is published at this address. It may have been renamed, removed, or never existed."
      >
        {/* One action, and the same one for everybody: the catalog is reachable whether or
            not anyone is signed in, which a 404 page cannot assume. */}
        <Button render={<Link to="/catalog" />}>Back to catalog</Button>
      </QuietPage>
    </QuietShell>
  );
}
