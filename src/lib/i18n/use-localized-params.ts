import { useLocale } from "use-intl";

import { defaultLocale } from "@/lib/i18n/locales";

/**
 * The path parameter that puts a link in the reader's own language.
 *
 * Within the localized tree the router fills it in from the page being rendered, so a
 * catalog link on a novel page needs nothing. The shell is the exception: the header, the
 * footer, the account menu and everything else reachable from a signed-in page sit outside
 * that tree, and there the language has to be passed explicitly or an English reader would
 * be sent to the Thai catalog by every link they touch.
 *
 * The default language is `undefined` rather than its own code, because the unprefixed URL
 * is the canonical one and the redirect that removes a prefix is a wasted round trip.
 */
export function useLocalizedParams(): { locale: string | undefined } {
  const locale = useLocale();
  return { locale: locale === defaultLocale ? undefined : locale };
}
