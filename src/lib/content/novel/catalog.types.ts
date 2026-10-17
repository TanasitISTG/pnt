/**
 * The shapes the catalog directory moves between the server and a screen.
 *
 * They live in a leaf module because four readers need them and only some of those may
 * import the server function module: the paged service, the query options, the card, and
 * the author page. A row is the same row in the catalog, on the shelf, and under an author
 * — the difference between those views is the filter, never the shape.
 */

export interface CatalogTagRef {
  slug: string;
  name: string;
}

/** One novel as a directory row. */
export interface CatalogNovel {
  id: string;
  title: string;
  originalTitle: string | null;
  /** The publisher's own text for the author; the card shows it as typed. */
  author: string | null;
  /** The canonical author, when the row has one, for the "more by" link. */
  authorId: string | null;
  description: string | null;
  sourceLang: string;
  targetLang: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  hasCover: number;
  chapterCount: number;
  translatedCount: number;
  /** Public CDN URL; null keeps the client on the proxied cover route. */
  coverUrl: string | null;
  coverSrcSet: string | null;
  tags: CatalogTagRef[];
}

/**
 * One page of the directory.
 *
 * `total` is the size of the filtered set, not of the page, so the results sentence can say
 * "24 of 3,412" without a second request; `hasMore` is derived from it and is what the
 * client's "Load more" reads instead of guessing from a full page.
 */
export interface CatalogPage {
  novels: CatalogNovel[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** A tag in the vocabulary, with how many live novels carry it. */
export interface CatalogTag extends CatalogTagRef {
  count: number;
}

export interface CatalogAuthor {
  id: string;
  name: string;
  /** Live novels by this author, counted the way a guest sees them. */
  novelCount: number;
}
