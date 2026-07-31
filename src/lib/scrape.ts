// Client-safe facade for supported source metadata and pure HTML parsers.
export {
  BOILERPLATE_RE,
  SCRAPE_PROVIDERS,
  SOURCES,
  SUPPORTED_SITES_LABEL,
  biqugeTocUrlFromReader,
  chapterUrlFor,
  findSource,
  isBiqugeTocUrl,
  isTwkanTocUrl,
  parseBiquge,
  parseBiqugeToc,
  parseChapter,
  parseTwkan,
  parseTwkanToc,
  twkanTocUrlFromReader,
} from "./scrape/parsers";
