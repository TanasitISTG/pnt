import { useEffect, useRef } from "react";

import { getReaderProgress, markChapterRead, saveScrollPosition } from "@/lib/reader-progress";

// Reader scroll lifecycle: marks the chapter read, restores the saved scroll
// fraction on load, and persists scroll position while scrolling.
export function useReaderScroll(
  novelId: string,
  chapterId: string,
  chapter: { id: string } | null | undefined,
) {
  const restoredChapterRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);

  useEffect(() => {
    if (chapter?.id === chapterId) {
      markChapterRead(novelId, chapterId);
    }
  }, [novelId, chapterId, chapter?.id]);

  useEffect(() => {
    if (!chapter) return;
    if (restoredChapterRef.current === chapterId) return;

    const progress = getReaderProgress(novelId);
    if (
      progress.lastChapterId === chapterId &&
      typeof progress.scrollFraction === "number" &&
      progress.scrollFraction > 0.01
    ) {
      const fraction = progress.scrollFraction;
      isRestoringRef.current = true;

      // The router's scrollRestoration scrolls to top on push navigation and can
      // land AFTER our first scrollTo, wiping it out. Re-assert the target until
      // it survives a few consecutive frames; bail early if the user takes over.
      let frames = 0;
      let stableFrames = 0;
      let lastWritten = -1;

      const tryScroll = () => {
        frames++;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

        if (maxScroll > 50) {
          const target = maxScroll * fraction;
          const y = window.scrollY;

          if (lastWritten >= 0 && Math.abs(y - lastWritten) > 2 && y !== 0) {
            // User grabbed the scroll position — stop fighting.
            restoredChapterRef.current = chapterId;
            setTimeout(() => {
              isRestoringRef.current = false;
            }, 150);
            return;
          }

          if (lastWritten >= 0 && Math.abs(y - target) <= 2) {
            stableFrames++;
            if (stableFrames >= 3) {
              restoredChapterRef.current = chapterId;
              setTimeout(() => {
                isRestoringRef.current = false;
              }, 150);
              return;
            }
          } else {
            stableFrames = 0;
            window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
            lastWritten = target;
          }
        }

        if (frames < 90) {
          requestAnimationFrame(tryScroll);
        } else {
          restoredChapterRef.current = chapterId;
          isRestoringRef.current = false;
        }
      };

      requestAnimationFrame(tryScroll);
    } else {
      restoredChapterRef.current = chapterId;
      isRestoringRef.current = false;
    }
  }, [chapterId, novelId, chapter]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      if (isRestoringRef.current || restoredChapterRef.current !== chapterId) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (isRestoringRef.current || restoredChapterRef.current !== chapterId) return;
        const docHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        const maxScroll = docHeight - viewportHeight;
        if (maxScroll > 50) {
          const fraction = window.scrollY / maxScroll;
          if (fraction > 0.005) {
            saveScrollPosition(novelId, fraction);
          }
        }
      }, 300);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [novelId, chapterId]);
}
