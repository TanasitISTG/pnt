import type { Locale } from "./locales";
import en from "./messages/en";
import th from "./messages/th";

/**
 * The catalog the whole app reads, in both languages.
 *
 * Both are imported statically rather than fetched per locale. A catalog is a few tens of
 * kilobytes of text once compressed, and paying it once buys a synchronous first render: no
 * request, no Suspense boundary and no window in which the server and the client could
 * disagree about what a string says. If the catalog ever outgrows that, splitting it per
 * namespace is the way back to lazy loading, and `IntlProvider` is the one place to do it.
 */
export type Messages = typeof en;

export const messages: Record<Locale, Messages> = { en, th };

/**
 * Teaches `use-intl` the app's own vocabulary, so a namespace or a key that does not exist
 * is a type error at the call site rather than a placeholder in the interface.
 */
declare module "use-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
