// Shared types for chapter scraping. Leaf module — types only.

import type { Messages } from "@/lib/i18n/messages";

export type ScrapeProvider = "auto" | "direct" | "zenrows" | "scrapingbee" | "firecrawl";

/**
 * A key in the `studio` namespace.
 *
 * A fetch method is described in words, and the reader who picks one is reading Thai or
 * English, so the registry carries keys rather than sentences. The type is derived from the
 * catalog, which makes a misspelled or removed key a compile error where it is written.
 */
export type ScrapeProviderCopyKey = keyof Messages["studio"];

export interface ScrapeProviderMeta {
  id: ScrapeProvider;
  labelKey: ScrapeProviderCopyKey;
  descriptionKey: ScrapeProviderCopyKey;
}

export interface ScrapedChapter {
  /**
   * Chapter number parsed from the page, or null when the page carries a usable
   * title/content but no determinable numbering. Import paths reject null;
   * range imports persist at their authoritative cursor position instead.
   */
  number: number | null;
  title: string;
  content: string;
  nextUrl: string | null;
}
