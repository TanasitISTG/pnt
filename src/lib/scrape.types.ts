// Shared types for chapter scraping. Leaf module — types only.

export type ScrapeProvider = "auto" | "direct" | "zenrows" | "scrapingbee" | "firecrawl";

export interface ScrapeProviderMeta {
  id: ScrapeProvider;
  label: string;
  description: string;
}

export interface ScrapedChapter {
  number: number;
  title: string;
  content: string;
  nextUrl: string | null;
}
