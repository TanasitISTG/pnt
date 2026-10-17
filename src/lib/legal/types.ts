import type { Locale } from "@/lib/i18n/locales";

/**
 * The three legal documents, as structure rather than as three hand-written pages.
 *
 * A policy is the one page where a missing sentence is a legal problem and not a cosmetic one, and
 * three pages written as JSX each held their own English prose inside the layout: a paragraph that
 * only one language had, a heading renamed in one file, and a translator with nothing to translate
 * against. So the words live here, in both languages, under one shape:
 *
 * - `LegalDocument` is the page: a title, a summary, and numbered sections.
 * - Every section is a heading, its paragraphs, and optionally bullets or named cards — the two
 *   shapes the existing pages already used, kept apart because a card's name is data (a cookie or a
 *   storage key, identical in both languages) and a bullet's lead is copy.
 * - `LegalCopy` requires every document in every locale, so a translation that is missing a
 *   paragraph fails `bun run typecheck` rather than shipping an English paragraph on a Thai page.
 *
 * The prose is English-authored and translated for the reader's convenience, so the pages carry the
 * notice that the English text governs (`legal.englishGoverns` in the catalog). `englishGoverns`
 * there is copy about the page; the documents here are the page.
 */

/** A bullet: a short lead the page shows in bold, then the sentence that explains it. */
export interface LegalBullet {
  readonly lead: string;
  readonly text: string;
}

/**
 * A named row in a box: a cookie's or a storage key's name, and what it is for.
 *
 * The name is what the browser stores, so it is the same string in both languages — a translated
 * key would name something that does not exist.
 */
export interface LegalCard {
  readonly name: string;
  readonly detail: string;
}

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly LegalBullet[];
  readonly cards?: readonly LegalCard[];
  /**
   * A paragraph that follows the section's own list, where a document says one more thing after
   * its bullets rather than before them (the cookie policy's last section does).
   */
  readonly closing?: string;
}

export interface LegalDocument {
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly LegalSection[];
}

/** Every document, in every language. A locale missing a document is a type error. */
export interface LegalCopy {
  readonly terms: Readonly<Record<Locale, LegalDocument>>;
  readonly privacy: Readonly<Record<Locale, LegalDocument>>;
  readonly cookiePolicy: Readonly<Record<Locale, LegalDocument>>;
}

export type LegalDocumentId = keyof LegalCopy;
