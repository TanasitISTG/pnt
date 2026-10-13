import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AddChapterSection } from "@/components/chapters/import/add-chapter-section";
import { chaptersQueryOptions } from "@/lib/content/chapter/chapter.query";

export interface StudioAddPageProps {
  novelId: string;
}

/**
 * One way in for new chapters: paste, fetch from a source, or unpack an EPUB. It was a tab
 * inside the reading page, where its three modes competed with the chapter table for the
 * same screen; as its own destination the mode picker is the page.
 */
export function StudioAddPage({ novelId }: StudioAddPageProps) {
  const queryClient = useQueryClient();
  const chaptersQuery = useQuery(chaptersQueryOptions(novelId));
  const chapters = chaptersQuery.data ?? [];

  const invalidateChapters = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
    queryClient.invalidateQueries({ queryKey: ["novels"] });
  }, [queryClient, novelId]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-card-title font-semibold tracking-tight text-foreground sm:text-sub">
          Add chapters
        </h1>
        <p className="mt-0.5 text-body text-muted-foreground">
          Paste source text, fetch from a supported site, or import an EPUB.
        </p>
      </div>

      {chaptersQuery.isPending ? (
        <div className="rounded-xl border border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
          Loading chapter tools…
        </div>
      ) : (
        <AddChapterSection
          novelId={novelId}
          chapters={chapters}
          invalidateChapters={invalidateChapters}
        />
      )}
    </div>
  );
}
