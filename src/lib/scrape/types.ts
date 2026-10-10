// Shared types for chapter scraping. Leaf module — types only.

export type ScrapeProvider = "auto" | "direct" | "zenrows" | "scrapingbee" | "firecrawl";

export interface ScrapeProviderMeta {
  id: ScrapeProvider;
  label: string;
  description: string;
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
