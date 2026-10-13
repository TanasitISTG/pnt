import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Plus } from "lucide-react";
import { useMemo } from "react";

import { novelsQueryOptions } from "@/components/novels/library/library-query";
import type { LibraryNovel } from "@/components/novels/library/library-search";
import { NovelCard } from "@/components/novels/novel-card";
import { NovelCover } from "@/components/novels/novel-cover";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { statsQueryOptions } from "@/lib/job-dashboard/query";
import { readerStateQueryOptions } from "@/lib/reader/query";
import type { ViewerUser } from "@/lib/profile/types";

/** Reading position is only interesting for the few novels the reader touched last. */
const CONTINUE_LIMIT = 4;
const SHELF_LIMIT = 6;

function timestamp(value: Date | string | null | undefined): number {
  const result = value ? new Date(value).getTime() : 0;
  return Number.isFinite(result) ? result : 0;
}

/**
 * The signed-in front door. A guest's `/` is the catalog, but an account's home is the
 * one thing the old library page could not be: a reading surface. It leads with the
 * chapters you were in the middle of, then the novels you own, then whether anything is
 * running — the three questions a returning translator actually has.
 */
export function ReadingHome({ user }: { user: ViewerUser }) {
  const novelsQuery = useQuery(novelsQueryOptions("mine"));
  const novels = useMemo(
    () =>
      (novelsQuery.data ?? []).toSorted((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt)),
    [novelsQuery.data],
  );

  const recent = useMemo(() => novels.slice(0, CONTINUE_LIMIT), [novels]);
  const stateQueries = useQueries({
    queries: recent.map((novel) => readerStateQueryOptions(novel.id)),
  });
  const continueEntries = recent.flatMap((novel, index) => {
    const state = stateQueries[index]?.data;
    if (!state?.lastChapterId) return [];
    return [{ novel, chapterId: state.lastChapterId, readCount: state.readChapterIds.length }];
  });

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-section text-foreground">Welcome back</h1>
          <p className="mt-1.5 text-body text-muted-foreground">
            Pick up where you left off, or start something new.
          </p>
        </div>
        <Button className="self-start sm:self-auto" render={<Link to="/novels/new" />}>
          <Plus className="size-4" aria-hidden="true" />
          New novel
        </Button>
      </header>

      {continueEntries.length > 0 ? (
        <section className="flex flex-col gap-4" aria-labelledby="continue-reading">
          <h2 id="continue-reading" className="text-sub text-foreground">
            Continue reading
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {continueEntries.map(({ novel, chapterId, readCount }) => (
              <ContinueReadingCard
                key={novel.id}
                novel={novel}
                chapterId={chapterId}
                readCount={readCount}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-4" aria-labelledby="your-novels">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="your-novels" className="text-sub text-foreground">
            Your novels
          </h2>
          {novels.length > SHELF_LIMIT ? (
            <Link
              to="/library"
              className="inline-flex items-center gap-1 text-caption font-medium text-ink no-underline hover:underline"
            >
              All novels
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>

        {novelsQuery.isPending ? (
          <ShelfSkeleton />
        ) : novels.length === 0 ? (
          // The header already offers "New novel", so this state invites without
          // repeating the same control.
          <EmptyState
            icon={<BookOpen />}
            title="No novels yet"
            description={`Welcome, ${user.name}. Create a novel project to start pasting chapters and translating them.`}
            size="compact"
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-3">
            {novels.slice(0, SHELF_LIMIT).map((novel, index) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                view="grid"
                isAdmin
                lazyCover={index > 0}
                priorityCover={index === 0}
              />
            ))}
          </div>
        )}
      </section>

      <ActivitySummary />
    </div>
  );
}

function ContinueReadingCard({
  novel,
  chapterId,
  readCount,
}: {
  novel: LibraryNovel;
  chapterId: string;
  readCount: number;
}) {
  const percent = novel.chapterCount > 0 ? Math.round((readCount / novel.chapterCount) * 100) : 0;

  return (
    <Link
      to="/novels/$novelId/chapters/$chapterId"
      params={{ novelId: novel.id, chapterId }}
      viewTransition
      className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3 no-underline transition-colors duration-micro hover:border-border-strong"
    >
      <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-surface-inset">
        <NovelCover
          novelId={novel.hasCover ? novel.id : null}
          coverVersion={novel.updatedAt}
          coverUrl={novel.coverUrl}
          coverSrcSet={novel.coverSrcSet}
          alt=""
          sizes="44px"
          className="h-full w-full object-cover"
          fallbackSize={6}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">{novel.title}</p>
        <p className="mt-0.5 text-micro tabular-nums text-muted-foreground">
          {readCount} of {novel.chapterCount} chapters read
        </p>
        <Progress
          value={percent}
          aria-label={`${novel.title} reading progress`}
          className="mt-2 h-1 gap-0"
        />
      </div>
      <span className="flex shrink-0 items-center gap-1 text-caption font-medium text-ink">
        Continue
        <ArrowRight
          className="size-4 transition-transform duration-micro ease-out-quint group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}

function ActivitySummary() {
  const statsQuery = useQuery(statsQueryOptions());
  const stats = statsQuery.data;
  const running = (stats?.activeTranslationJobs ?? 0) + (stats?.activeImportJobs ?? 0);
  const failed = (stats?.failedTranslationJobs ?? 0) + (stats?.failedImportJobs ?? 0);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="activity">
      <h2 id="activity" className="text-sub text-foreground">
        Activity
      </h2>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <div>
          <p className="text-micro text-muted-foreground">Running</p>
          <p className="text-card-title tabular-nums text-foreground">
            {statsQuery.isPending ? "—" : running}
          </p>
        </div>
        <div>
          <p className="text-micro text-muted-foreground">Needs attention</p>
          <p
            className={
              failed > 0
                ? "text-card-title tabular-nums text-warning"
                : "text-card-title tabular-nums text-foreground"
            }
          >
            {statsQuery.isPending ? "—" : failed}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" render={<Link to="/jobs" />}>
          Open jobs
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

function ShelfSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5"
      role="status"
      aria-label="Loading your novels…"
    >
      <span className="sr-only">Loading your novels…</span>
      {["one", "two", "three"].map((key) => (
        <div
          key={key}
          className="overflow-hidden rounded-xl border border-border bg-card"
          aria-hidden="true"
        >
          <Skeleton shape="media" />
          <div className="flex flex-col gap-2 p-3.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
