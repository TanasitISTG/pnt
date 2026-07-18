import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface NovelCoverProps {
  novelId?: string | null;
  cover?: string | null;
  alt: string;
  className?: string;
  fallbackSize?: number;
}

export function NovelCover({ novelId, cover, alt, className, fallbackSize = 12 }: NovelCoverProps) {
  // If inline cover is pre-loaded on the server, render it instantly in the DOM.
  // This bypasses client-side hooks, state updates, and fade-in animations to eliminate the flash of grey.
  if (cover) {
    return (
      <img
        src={cover}
        alt={alt}
        className={`w-full h-full object-cover rounded-[inherit] ${className}`}
      />
    );
  }

  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(!!novelId);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    if (!novelId) {
      setLoading(false);
      return;
    }

    let active = true;
    let objectUrl = "";

    async function loadCover() {
      try {
        setLoading(true);
        setError(false);
        const response = await fetch(`/api/covers/${novelId}`);
        if (!response.ok) {
          throw new Error("Failed to load cover");
        }
        const blob = await response.blob();
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          setLoading(false);
        }
      } catch {
        if (active) {
          setError(true);
          setLoading(false);
        }
      }
    }

    loadCover();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [novelId]);

  // Error / No cover state: Render BookOpen icon fallback immediately
  if (error || (!src && !loading)) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center bg-foreground/3 text-muted-foreground/60 rounded-[inherit] ${className}`}
      >
        <BookOpen style={{ width: fallbackSize * 4, height: fallbackSize * 4 }} />
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full rounded-[inherit] overflow-hidden ${className}`}>
      <AnimatePresence>
        {/* Skeleton Pulse loader shown while fetching OR while image is decoding */}
        {(!imageLoaded || loading) && (
          <motion.div
            key="skeleton"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 bg-foreground/5 animate-pulse rounded-[inherit] z-10"
          />
        )}
      </AnimatePresence>

      {/* Real image loaded, smoothly faded in once browser decode is complete */}
      {src && (
        <motion.img
          key="image"
          src={src}
          alt={alt}
          onLoad={() => setImageLoaded(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: imageLoaded ? 1 : 0 }}
          transition={{ duration: 0.3 }}
          className="w-full h-full object-cover rounded-[inherit]"
        />
      )}
    </div>
  );
}
