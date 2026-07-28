import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";

import { blobToDataUrl } from "@/lib/utils";

interface NovelCoverProps {
  novelId?: string | null;
  coverVersion?: string | number | Date | null;
  alt: string;
  className?: string;
  fallbackSize?: number;
  lazy?: boolean;
}

export function NovelCover({
  novelId,
  coverVersion,
  alt,
  className,
  fallbackSize = 12,
  lazy = false,
}: NovelCoverProps) {
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(!lazy);
  const rootRef = useRef<HTMLDivElement>(null);

  // ponytail: <img src="/api/..."> 404s in the dev server for asset-like fetch
  // dests (TanStack/router#7403, open, needs-upstream-fix), so we fetch + data
  // URL instead. The versioned URL + immutable cache headers still make repeat
  // loads instant; switch back to a plain <img> once the upstream fix lands.
  const version = coverVersion instanceof Date ? coverVersion.getTime() : coverVersion;
  const url = novelId ? `/api/covers/${novelId}${version ? `?v=${version}` : ""}` : null;

  useEffect(() => {
    if (visible || !rootRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [visible]);

  // useQuery owns the fetch: dedupes repeat mounts, no manual race guard.
  // retry: false keeps the fail-fast BookOpen fallback; staleTime: Infinity
  // because the versioned URL changes whenever the cover does.
  const { data: src, isError } = useQuery({
    queryKey: ["cover", url],
    queryFn: async () => {
      const response = await fetch(url as string);
      if (!response.ok) throw new Error("Failed to load cover");
      // data URL instead of an object URL: nothing to revoke, no Blob pin.
      return blobToDataUrl(await response.blob());
    },
    enabled: !!url && visible,
    retry: false,
    staleTime: Infinity,
  });

  // Error / No cover state: Render BookOpen icon fallback immediately
  if (!url || isError) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center bg-foreground/3 text-muted-foreground/60 rounded-[inherit] ${className}`}
      >
        <BookOpen style={{ width: fallbackSize * 4, height: fallbackSize * 4 }} />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`relative w-full h-full rounded-[inherit] overflow-hidden ${className}`}
    >
      {/* Skeleton pulse until the image is fetched and decoded */}
      <div
        className={`absolute inset-0 bg-foreground/5 animate-pulse rounded-[inherit] transition-opacity duration-300 ${
          loaded ? "opacity-0" : "opacity-100"
        }`}
      />
      {src && (
        <img
          src={src}
          alt={alt}
          onLoad={() => setLoaded(true)}
          className={`w-full h-full object-cover rounded-[inherit] transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}
