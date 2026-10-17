import type { Translator } from "./server-error";

/**
 * A novel's language pair is data (`zh`, `en`, `th`), but the words a reader sees for it are
 * interface copy: a Thai reader reading a chapter translated from Chinese should see จีน, not
 * the English name of the language. The codes are the only thing the data owns, so the switch
 * is over the code and the catalog keys stay literals.
 *
 * The reading surfaces and the studio's language pickers both need this name, so the switch
 * lives here rather than in either one of them. `Translator` is the root translator: a key
 * carries its own namespace.
 */
export function languageName(t: Translator, code: string): string | undefined {
  switch (code) {
    case "zh":
      return t("languages.zh");
    case "en":
      return t("languages.en");
    case "th":
      return t("languages.th");
    default:
      // An unnamed code falls back to whatever the data says it is, at the call site.
      return undefined;
  }
}
