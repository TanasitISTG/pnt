import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";

import { LibraryEmpty } from "@/components/novels/library/library-empty";
import { LibraryNoMatches } from "@/components/novels/library/library-no-matches";
import { LibraryPending } from "@/components/novels/library/library-pending";
import { LibraryToolbar } from "@/components/novels/library/library-toolbar";
import { novelsQueryOptions, type LibraryScope } from "@/components/novels/library/library-query";
import { NovelCard } from "@/components/novels/novel-card";
import {
  selectLibraryNovels,
  type LibrarySearch,
} from "@/components/novels/library/library-search";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { collatorFor } from "@/lib/i18n/format";

interface LibraryPageProps {
  scope: LibraryScope;
  signedIn: boolean;
  search: LibrarySearch;
  onSearchChange: (patch: Partial<LibrarySearch>) => void;
}

/**
 * One component serves two surfaces: the shared catalog everyone can read, and the
 * signed-in shelf of novels the account owns.
 *
 * `scope` decides which one it is, and it is the only thing that decides whether
 * manage affordances appear — never the mere presence of a session, which used to make
 * a signed-in reader of someone else's novel look like its owner.
 *
 * Search state and navigation arrive as props rather than from a bound route, because
 * this component is mounted by more than one route with its own search schema.
 */
export function LibraryPage({ scope, signedIn, search, onSearchChange }: LibraryPageProps) {
  const t = useTranslations("catalog");
  const locale = useLocale();
  const {
    data: novels = [],
    isPending,
    isError,
    error,
    refetch,
  } = useQuery(novelsQueryOptions(scope));
  const canManage = scope === "mine";
  const languages = useMemo(
    () =>
      Array.from(
        new Set(novels.map((novel) => `${novel.sourceLang}->${novel.targetLang}`)),
      ).toSorted((a, b) => a.localeCompare(b)),
    [novels],
  );
  const selectedNovels = useMemo(
    // Sorting a title list is the one place the interface language touches the data: the
    // collator is what orders Thai titles as a Thai reader expects rather than by code point.
    () => selectLibraryNovels(novels, search, canManage, collatorFor(locale)),
    [canManage, locale, novels, search],
  );

  if (isPending && novels.length === 0) return <LibraryPending />;

  const heading = canManage ? t("titleOwn") : t("title");
  const description = canManage
    ? t("descriptionOwn")
    : signedIn
      ? t("descriptionSignedIn")
      : t("descriptionGuest");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-section text-foreground">{heading}</h1>
          <p className="mt-1.5 text-body text-muted-foreground">{description}</p>
        </div>
        {/* One call to action per state: with an empty shelf the empty state owns it. */}
        {canManage && novels.length > 0 ? (
          <Button className="self-start sm:self-auto" render={<Link to="/novels/new" />}>
            <Plus className="size-4" aria-hidden="true" />
            {t("newNovel")}
          </Button>
        ) : null}
      </div>

      {isError ? (
        <ErrorState
          title={t("loadFailed")}
          error={error}
          onRetry={() => void refetch()}
          className="min-h-[45vh]"
        />
      ) : novels.length === 0 ? (
        <LibraryEmpty canManage={canManage} signedIn={signedIn} />
      ) : (
        <>
          <LibraryToolbar
            search={search}
            languages={languages}
            isAdmin={canManage}
            resultCount={selectedNovels.length}
            totalCount={novels.length}
            onSearchChange={onSearchChange}
          />
          {selectedNovels.length === 0 ? (
            <LibraryNoMatches
              onClear={() =>
                onSearchChange({
                  q: "",
                  language: "all",
                  publication: "all",
                })
              }
            />
          ) : (
            <div
              className={
                search.view === "grid"
                  ? "grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4"
                  : "grid gap-3"
              }
            >
              {selectedNovels.map((novel, index) => (
                <NovelCard
                  key={novel.id}
                  novel={novel}
                  view={search.view}
                  isAdmin={canManage}
                  lazyCover={index > 0}
                  priorityCover={index === 0}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
