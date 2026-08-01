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
  priority?: boolean;
}

export function NovelCover({
  novelId,
  coverVersion,
  alt,
  className,
  fallbackSize = 12,
  lazy = false,
  priority = false,
}: NovelCoverProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(!lazy);
  const rootRef = useRef<HTMLDivElement>(null);
  const version = coverVersion instanceof Date ? coverVersion.getTime() : coverVersion;
  const url = novelId ? `/api/covers/${novelId}${version ? `?v=${version}` : ""}` : null;
  const directImage = import.meta.env.PROD;

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

  // ponytail: dev server 404s for plain <img src="/api/..."> asset-like fetch
  // dests (TanStack/router#7403). Prod uses plain <img> so covers are SSR
  // discoverable and LCP is not delayed by hydration + Blob -> data URL work.
  const { data: devSrc, isError } = useQuery({
    queryKey: ["cover", url],
    queryFn: async () => {
      const response = await fetch(url as string);
      if (!response.ok) throw new Error("Failed to load cover");
      return blobToDataUrl(await response.blob());
    },
    enabled: !!url && visible && !directImage,
    retry: false,
    staleTime: Infinity,
  });

  if (!url || failed || isError) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center bg-foreground/3 text-muted-foreground/60 rounded-[inherit] ${className}`}
      >
        <BookOpen style={{ width: fallbackSize * 4, height: fallbackSize * 4 }} />
      </div>
    );
  }

  if (directImage) {
    return (
      <div
        ref={rootRef}
        className={`relative w-full h-full rounded-[inherit] overflow-hidden ${className}`}
      >
        {visible && (
          <img
            src={url}
            alt={alt}
            loading={lazy && !priority ? "lazy" : "eager"}
            fetchPriority={priority ? "high" : "auto"}
            decoding={priority ? "sync" : "async"}
            onError={() => setFailed(true)}
            className="w-full h-full object-cover rounded-[inherit]"
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`relative w-full h-full rounded-[inherit] overflow-hidden ${className}`}
    >
      <div
        className={`absolute inset-0 bg-foreground/5 animate-pulse rounded-[inherit] transition-opacity duration-300 ${
          loaded ? "opacity-0" : "opacity-100"
        }`}
      />
      {devSrc && (
        <img
          src={devSrc}
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
