import { useEffect, useState, type RefObject } from "react";

import {
  getReaderScrollFraction,
  getReaderScrollRange,
  getReaderTopInset,
} from "@/lib/reader/scroll-geometry";

export interface ReaderChapterProgressProps {
  proseRef: RefObject<HTMLDivElement | null>;
  proseNode?: HTMLDivElement | null;
  toolbarRef: RefObject<HTMLElement | null>;
  // Layout identity: reattach observers when the rendered prose node can differ.
  layoutKey: string;
}

// Read-only chapter progress drawn as a hairline on the toolbar edge. It measures the
// prose element rather than the document, so the app footer cannot inflate the ratio, and
// it never writes progress, so it cannot disturb scroll restore.
export function ReaderChapterProgress({
  proseRef,
  proseNode,
  toolbarRef,
  layoutKey,
}: ReaderChapterProgressProps) {
  const [progress, setProgress] = useState({ percent: 0, scrollable: false });

  useEffect(() => {
    let frame: number | null = null;

    const measure = () => {
      const prose = proseRef.current;
      if (!prose) return null;
      const inset = toolbarRef.current ? getReaderTopInset(toolbarRef.current) : 0;
      const range = getReaderScrollRange(prose, inset);
      if (!range.scrollable) return { percent: 0, scrollable: false };
      const fraction = getReaderScrollFraction(prose, inset) ?? 0;
      return { percent: Math.round(fraction * 100), scrollable: true };
    };

    const update = () => {
      frame = null;
      const next = measure() ?? { percent: 0, scrollable: false };
      setProgress((current) =>
        current.percent === next.percent && current.scrollable === next.scrollable ? current : next,
      );
    };

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (proseRef.current) observer?.observe(proseRef.current);
    if (toolbarRef.current) observer?.observe(toolbarRef.current);

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [layoutKey, proseRef, proseNode, toolbarRef]);

  if (!progress.scrollable) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
      role="progressbar"
      aria-label="Chapter progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.percent}
    >
      <div
        className="h-full bg-primary/30 transition-[width] duration-200 ease-out"
        style={{ width: `${progress.percent}%` }}
      />
    </div>
  );
}
