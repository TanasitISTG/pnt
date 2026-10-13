import { Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import { FOOTER_LINK_CLASS } from "@/components/shell/nav-styles";

// The year is client-only: rendering it during SSR guarantees a hydration mismatch
// across a New Year boundary, so the server renders nothing and the client fills it in.
const subscribeToYear = () => () => {};
const getClientYear = () => new Date().getFullYear();
const getServerYear = (): number | null => null;

export function SiteFooter() {
  const year = useSyncExternalStore(subscribeToYear, getClientYear, getServerYear);

  return (
    <footer className="mt-16 border-t border-border bg-background py-8">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {year} Pnt · Personal Novel Translator</p>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/privacy" className={FOOTER_LINK_CLASS}>
            Privacy Policy
          </Link>
          <Link to="/terms" className={FOOTER_LINK_CLASS}>
            Terms of Service
          </Link>
          <Link to="/cookie-policy" className={FOOTER_LINK_CLASS}>
            Cookie Policy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
