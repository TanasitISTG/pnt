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

/**
 * The same provider, pinned to Thai.
 *
 * The default suite runs in English because its copy assertions are the behaviour contract
 * (i18n.md §7). Thai is what actually ships, so the shipped default gets cases of its own
 * instead of being covered only by the catalog checks: these render the real surfaces and read
 * the real words, which is the one thing `bun run i18n:check` can never confirm.
 */
export function ThaiI18nProvider({ children }: { children: ReactNode }) {
  return <I18nProvider locale="th">{children}</I18nProvider>;
}
