import { useEffect, useRef } from "react";

import type { ReaderProgressStore } from "@/lib/reader/use-reader-state";
import { findReaderAnchor } from "./reader-anchors";

const READ_COMPLETE_FRACTION = 0.95;

interface MutableValue<T> {
  current: T;
}

interface ScrollOwner {
  novelId: string;
  chapterId: string;
}

export interface UseReaderScrollOptions {
  novelId: string;
  chapterId: string;
  chapter: { id: string } | null | undefined;
  ready: boolean;
  store: ReaderProgressStore;
  targetAnchor?: string | null;
}

function isOwned(owner: MutableValue<ScrollOwner>, novelId: string, chapterId: string): boolean {
  return owner.current.novelId === novelId && owner.current.chapterId === chapterId;
}

function fractionForCurrentScroll(): number | null {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  if (maxScroll <= 0) return null;
  return Math.max(0, Math.min(1, window.scrollY / maxScroll));
}

export function useReaderScroll({
  novelId,
  chapterId,
  chapter,
  ready,
  store,
  targetAnchor = null,
}: UseReaderScrollOptions): void {
  const ownerRef = useRef<ScrollOwner>({ novelId, chapterId });
  const restoredChapterRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);
  const restoreFrameRef = useRef<number | null>(null);
  const userTookOverRef = useRef(false);
  const readMarkedRef = useRef(false);
  // Read through a ref so a caller that rebuilds its store object per render cannot
  // retrigger these effects and loop.
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    ownerRef.current = { novelId, chapterId };
    restoredChapterRef.current = null;
    isRestoringRef.current = false;
    userTookOverRef.current = false;
    readMarkedRef.current = false;
  }, [chapterId, novelId, targetAnchor]);

  useEffect(() => {
    if (!ready || chapter?.id !== chapterId) return;
    storeRef.current.markOpened(chapterId);
    // Content shorter than the viewport never scrolls, so it is fully viewed.
    if (fractionForCurrentScroll() === null) {
      storeRef.current.markRead(chapterId);
      readMarkedRef.current = true;
    }
  }, [chapter?.id, chapterId, ready]);

  useEffect(() => {
    if (
      !ready ||
      chapter?.id !== chapterId ||
      restoredChapterRef.current === chapterId ||
      targetAnchor
    )
      return;

    const progress = storeRef.current.getProgress();
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
  }, [chapter?.id, chapterId, novelId, ready, targetAnchor]);

  useEffect(() => {
    if (!targetAnchor || !ready || chapter?.id !== chapterId) return;

    let frame: number | null = null;
    let attempts = 0;
    const focusAnchor = () => {
      const target = findReaderAnchor(targetAnchor);
      if (target) {
        target.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
        restoredChapterRef.current = chapterId;
        isRestoringRef.current = false;
        frame = null;
        return;
      }
      attempts++;
      if (attempts >= 90) {
        restoredChapterRef.current = chapterId;
        isRestoringRef.current = false;
        frame = null;
        return;
      }
      frame = requestAnimationFrame(focusAnchor);
    };

    frame = requestAnimationFrame(focusAnchor);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [chapter?.id, chapterId, ready, targetAnchor]);

  useEffect(() => {
    let timer: number | null = null;
    let frameGate: number | null = null;
    let capturedFraction: number | null = null;

    const markCompleteIfFinished = (fraction: number | null) => {
      if (readMarkedRef.current) return;
      if (fraction === null || fraction < READ_COMPLETE_FRACTION) return;
      storeRef.current.markRead(chapterId);
      readMarkedRef.current = true;
    };

    const flushCaptured = (immediate: boolean, unload = false) => {
      window.clearTimeout(timer ?? undefined);
      timer = null;
      if (capturedFraction === null) return;
      markCompleteIfFinished(capturedFraction);
      if (immediate) {
        storeRef.current.flushScrollFraction(capturedFraction, { unload });
      } else {
        storeRef.current.saveScrollFraction(capturedFraction);
      }
      capturedFraction = null;
    };

    const captureCurrent = () => {
      if (!ready || isRestoringRef.current || restoredChapterRef.current !== chapterId) return;
      if (!isOwned(ownerRef, novelId, chapterId)) return;
      const fraction = fractionForCurrentScroll();
      if (fraction === null) return;
      capturedFraction = fraction;
      // Crossing the end marks the chapter right away: the debounced flush only carries the
      // settled position, so a reader who reaches the end and scrolls back would be missed.
      if (!readMarkedRef.current && fraction >= READ_COMPLETE_FRACTION) {
        storeRef.current.markRead(chapterId);
        readMarkedRef.current = true;
      }
    };

    const handleScroll = () => {
      if (frameGate !== null) return;
      frameGate = requestAnimationFrame(() => {
        frameGate = null;
      });
      captureCurrent();
      if (capturedFraction !== null && timer === null) {
        timer = window.setTimeout(() => flushCaptured(false), 300);
      }
    };

    const handlePageLifecycle = () => {
      captureCurrent();
      flushCaptured(true, true);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") handlePageLifecycle();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", handlePageLifecycle);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (frameGate !== null) cancelAnimationFrame(frameGate);
      flushCaptured(true);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", handlePageLifecycle);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [chapterId, novelId, ready, targetAnchor]);
}
