import type { ReactNode } from "react";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { defaultLocale } from "@/lib/i18n/locales";

/**
 * The provider every component test renders inside.
 *
 * Copy assertions in the unit suite are the contract for behaviour, so the suite runs the
 * app pinned to English (see i18n.md §7): `vite.config.ts` sets `VITE_DEFAULT_LOCALE=en` for
 * tests, `defaultLocale` reads it, and this provider hands the component the English catalog.
 * The Thai default that actually ships is covered by the browser suite and the catalog
 * checks, which do not depend on these strings.
 */
export function TestI18nProvider({ children }: { children: ReactNode }) {
  return <I18nProvider locale={defaultLocale}>{children}</I18nProvider>;
}
