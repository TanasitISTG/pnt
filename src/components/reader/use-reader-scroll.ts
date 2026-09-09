import { useEffect, useRef } from "react";

import { getReaderProgress, markChapterRead, saveScrollPosition } from "@/lib/reader/progress";

interface MutableValue<T> {
  current: T;
}

interface ScrollOwner {
  novelId: string;
  chapterId: string;
}

function isOwned(owner: MutableValue<ScrollOwner>, novelId: string, chapterId: string): boolean {
  return owner.current.novelId === novelId && owner.current.chapterId === chapterId;
}

function fractionForCurrentScroll(): number | null {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  if (maxScroll <= 0) return null;
  return Math.max(0, Math.min(1, window.scrollY / maxScroll));
}

export function useReaderScroll(
  novelId: string,
  chapterId: string,
  chapter: { id: string } | null | undefined,
  settingsReady: boolean,
): void {
  const ownerRef = useRef<ScrollOwner>({ novelId, chapterId });
  const restoredChapterRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);
  const restoreFrameRef = useRef<number | null>(null);
  const userTookOverRef = useRef(false);

  useEffect(() => {
    ownerRef.current = { novelId, chapterId };
    restoredChapterRef.current = null;
    isRestoringRef.current = false;
    userTookOverRef.current = false;
  }, [chapterId, novelId]);

  useEffect(() => {
    if (settingsReady && chapter?.id === chapterId) markChapterRead(novelId, chapterId);
  }, [chapter?.id, chapterId, novelId, settingsReady]);

  useEffect(() => {
    if (!settingsReady || chapter?.id !== chapterId || restoredChapterRef.current === chapterId)
      return;

    const progress = getReaderProgress(novelId);
    const savedFraction =
      progress.lastChapterId === chapterId &&
      typeof progress.scrollFraction === "number" &&
      Number.isFinite(progress.scrollFraction)
        ? Math.max(0, Math.min(1, progress.scrollFraction))
        : null;

    if (savedFraction === null) {
      restoredChapterRef.current = chapterId;
      isRestoringRef.current = false;
      return;
    }

    isRestoringRef.current = true;
    userTookOverRef.current = false;
    let frames = 0;
    let stableFrames = 0;
    let lastWritten: number | null = null;

    const cancelRestore = () => {
      userTookOverRef.current = true;
      if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
      isRestoringRef.current = false;
      restoredChapterRef.current = chapterId;
    };

    const tryScroll = () => {
      if (!isOwned(ownerRef, novelId, chapterId) || userTookOverRef.current) return;
      frames += 1;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll > 0) {
        const target = maxScroll * savedFraction;
        const currentY = window.scrollY;
        if (lastWritten !== null && Math.abs(currentY - lastWritten) > 2 && currentY !== 0) {
          cancelRestore();
          return;
        }
        if (lastWritten !== null && Math.abs(currentY - target) <= 2) {
          stableFrames += 1;
          if (stableFrames >= 3) {
            restoredChapterRef.current = chapterId;
            isRestoringRef.current = false;
            restoreFrameRef.current = null;
            return;
          }
        } else {
          stableFrames = 0;
          window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
          lastWritten = target;
        }
      }
      if (frames < 90) {
        restoreFrameRef.current = requestAnimationFrame(tryScroll);
      } else {
        restoredChapterRef.current = chapterId;
        isRestoringRef.current = false;
        restoreFrameRef.current = null;
      }
    };

    const onUserInput = (event: Event) => {
      if (event.type === "keydown") {
        const key = (event as KeyboardEvent).key;
        if (!["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(key)) {
          return;
        }
      }
      if (isRestoringRef.current) cancelRestore();
    };

    window.addEventListener("wheel", onUserInput, { passive: true });
    window.addEventListener("touchstart", onUserInput, { passive: true });
    window.addEventListener("keydown", onUserInput);
    restoreFrameRef.current = requestAnimationFrame(tryScroll);

    return () => {
      if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
      window.removeEventListener("wheel", onUserInput);
      window.removeEventListener("touchstart", onUserInput);
      window.removeEventListener("keydown", onUserInput);
      restoreFrameRef.current = null;
      isRestoringRef.current = false;
    };
  }, [chapter?.id, chapterId, novelId, settingsReady]);

  useEffect(() => {
    let timer: number | null = null;
    let capturedFraction: number | null = null;

    const flushCaptured = () => {
      window.clearTimeout(timer ?? undefined);
      timer = null;
      if (capturedFraction === null) return;
      saveScrollPosition(novelId, capturedFraction);
      capturedFraction = null;
    };

    const captureCurrent = () => {
      if (!settingsReady || isRestoringRef.current || restoredChapterRef.current !== chapterId)
        return;
      if (!isOwned(ownerRef, novelId, chapterId)) return;
      const fraction = fractionForCurrentScroll();
      if (fraction !== null) capturedFraction = fraction;
    };

    const handleScroll = () => {
      captureCurrent();
      if (capturedFraction === null || timer !== null) return;
      timer = window.setTimeout(flushCaptured, 300);
    };

    const handlePageLifecycle = () => {
      captureCurrent();
      flushCaptured();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") handlePageLifecycle();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", handlePageLifecycle);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      flushCaptured();
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", handlePageLifecycle);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [chapterId, novelId, settingsReady]);
}
