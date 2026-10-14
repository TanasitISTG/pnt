import { Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";

import { FOOTER_LINK_CLASS } from "@/components/shell/nav-styles";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";

// The year is client-only: rendering it during SSR guarantees a hydration mismatch
// across a New Year boundary, so the server renders nothing and the client fills it in.
const subscribeToYear = () => () => {};
const getClientYear = () => new Date().getFullYear();
const getServerYear = (): number | null => null;

/**
 * The legal links and the copyright line, on every framed page except the reader.
 *
 * The three documents are localized pages, and the footer is reachable from the signed-in
 * areas too, so each link carries the language explicitly rather than relying on the tree
 * it happens to be rendered under.
 */
export function SiteFooter() {
  const t = useTranslations("shell");
  const localized = useLocalizedParams();
  const year = useSyncExternalStore(subscribeToYear, getClientYear, getServerYear);

  return (
    <footer className="mt-16 border-t border-border bg-background py-8">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{t("footerCopyright", { year: year ?? "" })}</p>
        <nav
          aria-label={t("footerLegalLabel")}
          className="flex flex-wrap items-center gap-x-5 gap-y-2"
        >
          <Link to="/{-$locale}/privacy" params={localized} className={FOOTER_LINK_CLASS}>
            {t("privacyPolicy")}
          </Link>
          <Link to="/{-$locale}/terms" params={localized} className={FOOTER_LINK_CLASS}>
            {t("termsOfService")}
          </Link>
          <Link to="/{-$locale}/cookie-policy" params={localized} className={FOOTER_LINK_CLASS}>
            {t("cookiePolicy")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
