import { createTranslator } from "use-intl/core";

import { messages } from "./messages";
import { resolveDocumentLocale } from "./request-locale";

/**
 * A translator for a route's `head`.
 *
 * `head` runs outside React, before any component has rendered, so there is no provider to
 * read a language from - and there must not be an ambient one, because requests run
 * concurrently. The language comes from the same place the document takes it: the URL, then
 * the cookie, then the account's own remembered choice.
 *
 * The registered site name is appended by the caller: a tab title reads as the page first,
 * the product second.
 */
export async function headTranslator() {
  const locale = await resolveDocumentLocale(null);
  return createTranslator({ locale, messages: messages[locale] });
}
