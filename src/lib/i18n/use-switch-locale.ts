import { useState } from "react";
import { useLocale } from "use-intl";

import { setViewerLocale } from "@/lib/account/locale.functions";
import { localeCookie, localizedHref, type Locale } from "./locales";

/**
 * Switching the interface language, in one place.
 *
 * Two surfaces offer the choice — the header's language menu and Settings, in the appearance
 * section — and a second implementation would be a second set of rules about what a switch
 * does. So both call this.
 *
 * The switch writes the cookie first, then asks the account to remember the choice, then
 * navigates; the order is what makes a failed write harmless. `localizedHref` returns the
 * same URL for a path with no localized form, where the navigation is therefore a reload in
 * place, and a full document load is what makes the server render, the head tags, the dates
 * and the client's own copy agree from the first byte. Anything faster would be a page that
 * is half in one language while the router catches up.
 *
 * The account write is awaited rather than fired and forgotten, because the reload would
 * abort an in-flight request; a failure is swallowed, because the cookie already holds the
 * choice for this browser.
 */
export interface UseSwitchLocaleOptions {
  /** Whether an account should remember the choice too, rather than the cookie alone. */
  signedIn: boolean;
}

export interface SwitchLocale {
  /** The language the page is being read in right now. */
  locale: Locale;
  /** True from the moment a switch is asked for until the document starts reloading. */
  switching: boolean;
  switchLocale: (next: Locale) => Promise<void>;
}

export function useSwitchLocale({ signedIn }: UseSwitchLocaleOptions): SwitchLocale {
  const locale = useLocale();
  const [switching, setSwitching] = useState(false);

  const switchLocale = async (next: Locale) => {
    if (next === locale || switching) return;
    setSwitching(true);

    document.cookie = localeCookie(next);

    if (signedIn) {
      try {
        await setViewerLocale({ data: { locale: next } });
      } catch {
        // The cookie is already written, so the switch still holds for this browser.
      }
    }

    window.location.assign(localizedHref(window.location.href, next));
  };

  return { locale, switching, switchLocale };
}
