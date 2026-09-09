import { notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";

import { READER_FONT_SIZE_PX, useReaderSettings } from "@/lib/reader/settings";
import { QueryErrorState } from "@/components/query-error-state";
import { useReaderScroll } from "@/components/reader/use-reader-scroll";
import {
  chapterQueryOptions,
  chaptersQueryOptions,
  novelQueryOptions,
} from "@/components/reader/reader-queries";
import { ReaderPageSurface } from "./reader-page-surface";

export interface ReaderPageProps {
  novelId: string;
  chapterId: string;
  user: unknown;
}

export function ReaderPage({ novelId, chapterId, user }: ReaderPageProps) {
  const chapterQuery = useQuery(chapterQueryOptions(chapterId));
  const chaptersQuery = useQuery(chaptersQueryOptions(novelId));
  const novelQuery = useQuery(novelQueryOptions(novelId));
  const { settings, update, ready: settingsReady } = useReaderSettings();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const chapter = chapterQuery.data;
  const chapters = chaptersQuery.data ?? [];
  const novel = novelQuery.data;

  useReaderScroll(novelId, chapterId, chapter, settingsReady);

  if (chapterQuery.isError || chaptersQuery.isError || novelQuery.isError) {
    return (
      <QueryErrorState
        title="Failed to load chapter"
        error={chapterQuery.error || chaptersQuery.error || novelQuery.error}
        onRetry={() => {
          void chapterQuery.refetch();
          void chaptersQuery.refetch();
          void novelQuery.refetch();
        }}
        className="my-12 min-h-[40vh]"
      />
    );
  }

  if (!chapter || !novel || chapter.novelId !== novelId) throw notFound();

  return (
    <ReaderPageSurface
      key={chapterId}
      novelId={novelId}
      chapterId={chapterId}
      chapter={chapter}
      chapters={chapters}
      novel={novel}
      user={user}
      settings={settings}
      update={update}
      theme={theme}
      resolvedTheme={resolvedTheme}
      setTheme={setTheme}
      fontSizePx={READER_FONT_SIZE_PX[settings.fontSize]}
    />
  );
}
