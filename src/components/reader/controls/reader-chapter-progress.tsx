import { useEffect, useState } from "react";

// Read-only chapter progress drawn as a hairline on the toolbar edge. It never writes
// progress, so it cannot disturb scroll restore.
export function ReaderChapterProgress() {
  const [progress, setProgress] = useState({ percent: 0, scrollable: false });

  useEffect(() => {
    let frame: number | null = null;

    const update = () => {
      frame = null;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const next =
        maxScroll <= 0
          ? { percent: 0, scrollable: false }
          : {
              percent: Math.round(Math.min(1, Math.max(0, window.scrollY / maxScroll)) * 100),
              scrollable: true,
            };
      setProgress((current) =>
        current.percent === next.percent && current.scrollable === next.scrollable ? current : next,
      );
    };

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(document.documentElement);

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

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
