import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";

import { APP_TIME_ZONE } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import { messages } from "@/lib/i18n/messages";

export interface I18nProviderProps {
  locale: Locale;
  children: ReactNode;
}

/**
 * The one place a surface learns which language it is rendering in.
 *
 * It is declared at the document and again on the localized layout, and that is deliberate:
 * the document knows the language the request arrived in, while the layout knows the
 * language in the URL, which is what a back button or a shared link changes under the
 * document's feet. The inner provider wins for everything beneath it.
 *
 * The timezone is the app's own rather than each visitor's, so the same server-rendered
 * timestamp and its hydration are the same string.
 */
export function I18nProvider({ locale, children }: I18nProviderProps) {
  return (
    <IntlProvider locale={locale} messages={messages[locale]} timeZone={APP_TIME_ZONE}>
      {children}
    </IntlProvider>
  );
}
