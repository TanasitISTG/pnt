import { z } from "zod";

/**
 * The catalog's inputs, in one module both graphs read.
 *
 * The route's URL schema decides what a reader may ask for; this decides what the server
 * will answer. They are separate on purpose: a URL recovers from a malformed value to a
 * default (`librarySearchSchema`), while the server refuses anything outside the bound —
 * a page far past the end is a client bug, not a filter.
 */

/** Cards per page. Also the payload bound: page one is the same size at 30 novels and 30,000. */
export const CATALOG_PAGE_SIZE = 24;

/** The deepest page a client may ask for. Beyond this the answer is empty, not expensive. */
export const CATALOG_MAX_PAGE = 500;

/** A novel carries at most this many tags; the vocabulary is a directory aid, not a wall. */
export const MAX_NOVEL_TAGS = 5;

/** Long enough for a full title; short enough that the term cannot become a scan's excuse. */
export const CATALOG_SEARCH_MAX_LENGTH = 200;

export const CATALOG_SORT_VALUES = ["newest", "updated", "title"] as const;
export type CatalogSort = (typeof CATALOG_SORT_VALUES)[number];

export const CATALOG_PUBLICATION_VALUES = ["all", "draft", "scheduled", "live"] as const;
export type CatalogPublication = (typeof CATALOG_PUBLICATION_VALUES)[number];

export const catalogScopeSchema = z.enum(["mine", "public"]);

/**
 * A language pair filter as the interface writes it ("zh->th"). Validated against the
 * supported pairs rather than accepted as free text, so a pair the product does not support
 * is a no-op filter instead of a query that can never match.
 */
export const catalogLanguageSchema = z.enum(["en->th", "zh->en", "zh->th"]);
export type CatalogLanguage = z.infer<typeof catalogLanguageSchema>;

/** A tag slug: Unicode-preserving, because a Thai tag's readable form is its own name. */
export const tagSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .transform((value) => value.trim().toLowerCase().replace(/\s+/g, "-"));

export const catalogInputSchema = z.object({
  scope: catalogScopeSchema.default("public"),
  page: z.number().int().min(1).max(CATALOG_MAX_PAGE).default(1),
  q: z.string().max(CATALOG_SEARCH_MAX_LENGTH).optional(),
  sort: z.enum(CATALOG_SORT_VALUES).default("newest"),
  language: catalogLanguageSchema.optional(),
  publication: z.enum(CATALOG_PUBLICATION_VALUES).default("all"),
  tag: tagSlugSchema.optional(),
  authorId: z.string().max(64).optional(),
  /**
   * Only decides the collation a title sort uses. It is not an authorization input and not
   * a visibility one: two readers asking in two languages see the same novels in a
   * different order, which is the whole point of sorting titles at all.
   */
  locale: z.enum(["en", "th"]).default("th"),
});

export type CatalogInput = z.infer<typeof catalogInputSchema>;
/** What a caller sends: the same shape before the defaults are applied. */
export type CatalogInputPayload = z.input<typeof catalogInputSchema>;

export const setNovelTagsSchema = z.object({
  novelId: z.string().min(1),
  tags: z
    .array(z.string().min(1).max(80))
    .max(MAX_NOVEL_TAGS)
    .transform((values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))]),
});

export const mergeAuthorsSchema = z.object({
  fromAuthorId: z.string().min(1),
  intoAuthorId: z.string().min(1),
});
