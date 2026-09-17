import { notFound, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useRef, useState } from "react";

import { READER_FONT_SIZE_PX, useReaderSettings } from "@/lib/reader/settings";
import { useReaderState } from "@/lib/reader/use-reader-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useReaderScroll } from "@/components/reader/page/use-reader-scroll";
import { useReaderThemeScope } from "@/components/reader/page/use-reader-theme-scope";
import { chapterQueryOptions } from "@/lib/content/chapter/chapter.query";
import {
  readerChapterManifestQueryOptions,
  readerNovelQueryOptions,
} from "@/components/reader/page/reader-queries";
import { ReaderPageSurface } from "./reader-page-surface";

export interface ReaderPageProps {
  novelId: string;
  chapterId: string;
  user: unknown;
}

export function ReaderPage({ novelId, chapterId, user }: ReaderPageProps) {
  const chapterQuery = useQuery(chapterQueryOptions(chapterId, novelId));
  const chaptersQuery = useQuery(readerChapterManifestQueryOptions(novelId));
  const novelQuery = useQuery(readerNovelQueryOptions(novelId));
  const { settings, update, ready: settingsReady } = useReaderSettings();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { hash } = useLocation();
  const targetAnchor = hash ? (hash.startsWith("#") ? hash.slice(1) : hash) : null;
  const chapter = chapterQuery.data;
  const chapters = chaptersQuery.data ?? [];
  const novel = novelQuery.data;
  const readerState = useReaderState(novelId, !!user);
  // Measuring the prose element keeps the app footer out of saved positions and progress.
  const proseRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);
  const [proseNode, setProseNode] = useState<HTMLDivElement | null>(null);
  const attachProse = useCallback((node: HTMLDivElement | null) => {
    proseRef.current = node;
    setProseNode(node);
  }, []);
  const proseLayoutKey = [
    chapterId,
    settings.viewMode,
    settings.fontSize,
    settings.typeface,
    settings.lineHeight,
    settings.measure,
    chapter?.translatedContent ? "translated" : "raw",
    chapter?.editedAt ? String(chapter.editedAt) : "",
  ].join("|");

  useReaderThemeScope(settings.pageTheme, settingsReady);
  useReaderScroll({
    novelId,
    chapterId,
    chapter,
    ready: settingsReady && readerState.ready,
    store: readerState.store,
    targetAnchor,
    proseRef,
    proseNode,
    toolbarRef,
    layoutKey: proseLayoutKey,
  });

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
      readerState={readerState}
      proseRef={proseRef}
      proseNode={proseNode}
      onProseNodeChange={attachProse}
      toolbarRef={toolbarRef}
    />
  );
}
