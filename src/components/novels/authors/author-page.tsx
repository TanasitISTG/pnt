import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "use-intl";

import { catalogQueryOptions } from "@/components/novels/library/library-query";
import { NovelCard } from "@/components/novels/novel-card";
import { MergeAuthorControl } from "@/components/novels/authors/merge-author-control";
import { Button } from "@/components/ui/button";
import { DiscussionSkeleton } from "@/components/discussion/discussion-parts";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import type { CatalogAuthor } from "@/lib/content/novel/catalog.types";
import { authorCatalogFilters } from "@/components/novels/library/library-search";
import type { Locale } from "@/lib/i18n/locales";
import { useMemo } from "react";

/**
 * One author's shelf in the shared catalog.
 *
 * It is the catalog with one filter applied, not a second directory: the same paged read,
 * the same card, the same live-only visibility. That is deliberate — an author page that
 * queried novels itself would be a second place the publication rule could drift.
 */
export function AuthorPage({ author, isOperator }: { author: CatalogAuthor; isOperator: boolean }) {
  const t = useTranslations("authors");
  const tCatalog = useTranslations("catalog");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;

  const filters = useMemo(() => authorCatalogFilters(locale, author.id), [author.id, locale]);

  const query = useInfiniteQuery(catalogQueryOptions("public", filters));
  const novels = useMemo(
    () => query.data?.pages.flatMap((page) => page.novels) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? author.novelCount;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-section text-foreground">{author.name}</h1>
          <p className="mt-1.5 text-body text-muted-foreground">
            {t("novelCount", { count: total })}
          </p>
        </div>
        {isOperator ? <MergeAuthorControl author={author} /> : null}
      </header>

      {query.isError ? (
        <ErrorState
          title={tCatalog("loadFailed")}
          error={query.error}
          onRetry={() => void query.refetch()}
          className="min-h-[45vh]"
        />
      ) : query.isPending ? (
        <DiscussionSkeleton rows={3} />
      ) : novels.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
          {novels.map((novel, index) => (
            <NovelCard
              key={novel.id}
              novel={novel}
              view="grid"
              isAdmin={false}
              lazyCover={index > 0}
              priorityCover={index === 0}
            />
          ))}
        </div>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? tCommon("loading") : tCatalog("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
