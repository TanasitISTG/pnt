import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

// Prev/next chapter resolution, navigation, and ArrowLeft/ArrowRight keys.
export function useChapterNav<T extends { id: string }>(
  novelId: string,
  chapterId: string,
  chapters: T[],
) {
  const navigate = useNavigate();

  const { prevChapter, nextChapter } = useMemo(() => {
    const idx = chapters.findIndex((c) => c.id === chapterId);
    return {
      prevChapter: idx > 0 ? chapters[idx - 1] : null,
      nextChapter: idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null,
    };
  }, [chapters, chapterId]);

  const goToChapter = (id: string) =>
    navigate({
      to: "/novels/$novelId/chapters/$chapterId",
      params: { novelId, chapterId: id },
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "ArrowLeft" && prevChapter) goToChapter(prevChapter.id);
      if (e.key === "ArrowRight" && nextChapter) goToChapter(nextChapter.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return { prevChapter, nextChapter, goToChapter };
}
