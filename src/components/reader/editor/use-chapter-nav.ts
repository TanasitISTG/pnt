import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

// Prev/next chapter resolution and navigation. Keyboard ownership stays in the reader page.
export function useChapterNav<T extends { id: string }>(
  novelId: string,
  chapterId: string,
  chapters: T[],
) {
  const navigate = useNavigate();

  const { prevChapter, nextChapter } = useMemo(() => {
    const index = chapters.findIndex((chapter) => chapter.id === chapterId);
    return {
      prevChapter: index > 0 ? chapters[index - 1] : null,
      nextChapter: index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null,
    };
  }, [chapters, chapterId]);

  const goToChapter = (id: string) =>
    navigate({
      to: "/novels/$novelId/chapters/$chapterId",
      params: { novelId, chapterId: id },
    });

  return { prevChapter, nextChapter, goToChapter };
}
