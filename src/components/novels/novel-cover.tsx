import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";

import { blobToDataUrl } from "@/lib/utils";

interface NovelCoverProps {
  novelId?: string | null;
  coverVersion?: string | number | Date | null;
  alt: string;
  className?: string;
  sizes: string;
  fallbackSize?: number;
  lazy?: boolean;
  priority?: boolean;
}
function buildCoverSources(
  novelId: string | null | undefined,
  coverVersion: NovelCoverProps["coverVersion"],
) {
  if (!novelId) return { url: null, srcSet: undefined };
  const version = coverVersion instanceof Date ? coverVersion.getTime() : coverVersion;
  const versionParam = version ? `&v=${version}` : "";
  const coverBaseUrl = `/api/covers/${novelId}`;
  return {
    url: `${coverBaseUrl}?w=480${versionParam}`,
    srcSet: [320, 480, 640]
      .map((width) => `${coverBaseUrl}?w=${width}${versionParam} ${width}w`)
      .join(", "),
  };
}

function CoverFallback({
  className,
  fallbackSize,
}: Pick<NovelCoverProps, "className"> & { fallbackSize: number }) {
  return (
    <div
      className={`w-full h-full flex items-center justify-center bg-foreground/3 text-muted-foreground/60 rounded-[inherit] ${className}`}
    >
      <BookOpen style={{ width: fallbackSize * 4, height: fallbackSize * 4 }} />
    </div>
  );
}

interface ProductionCoverProps extends Pick<NovelCoverProps, "alt" | "className" | "sizes"> {
  rootRef: React.RefObject<HTMLDivElement | null>;
  url: string;
  srcSet: string | undefined;
  visible: boolean;
  lazy: boolean;
  priority: boolean;
  onError: () => void;
}

function ProductionCover({
  rootRef,
  url,
  srcSet,
  alt,
  className,
  sizes,
  visible,
  lazy,
  priority,
  onError,
}: ProductionCoverProps) {
  return (
    <div
      ref={rootRef}
      className={`relative w-full h-full rounded-[inherit] overflow-hidden ${className}`}
    >
      {visible ? (
        <img
          src={url}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          loading={lazy && !priority ? "lazy" : "eager"}
          fetchPriority={priority ? "high" : "auto"}
          decoding={priority ? "sync" : "async"}
          onError={onError}
          className="w-full h-full object-cover rounded-[inherit]"
        />
      ) : null}
    </div>
  );
}

function DevelopmentCover({
  devSrc,
  alt,
  className,
  loaded,
  onLoad,
}: Pick<NovelCoverProps, "alt" | "className"> & {
  devSrc: string | undefined;
  loaded: boolean;
  onLoad: () => void;
}) {
  return (
    <div className={`relative w-full h-full rounded-[inherit] overflow-hidden ${className}`}>
      <div
        className={`absolute inset-0 bg-foreground/5 animate-pulse rounded-[inherit] transition-opacity duration-300 ${
          loaded ? "opacity-0" : "opacity-100"
        }`}
      />
      {devSrc ? (
        <img
          src={devSrc}
          alt={alt}
          onLoad={onLoad}
          className={`w-full h-full object-cover rounded-[inherit] transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
    </div>
  );
}

export function NovelCover({
  novelId,
  coverVersion,
  alt,
  className,
  sizes,
  fallbackSize = 12,
  lazy = false,
  priority = false,
}: NovelCoverProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(!lazy);
  const rootRef = useRef<HTMLDivElement>(null);
  const { url, srcSet } = buildCoverSources(novelId, coverVersion);
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
    return <CoverFallback className={className} fallbackSize={fallbackSize} />;
  }

  if (directImage) {
    return (
      <ProductionCover
        rootRef={rootRef}
        url={url}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        className={className}
        visible={visible}
        lazy={lazy}
        priority={priority}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <DevelopmentCover
      devSrc={devSrc}
      alt={alt}
      className={className}
      loaded={loaded}
      onLoad={() => setLoaded(true)}
    />
  );
}
