import { useCallback, useEffect, useState } from "react";

export type ReaderFontSize = "S" | "M" | "L" | "XL";
export type ReaderTypeface = "default" | "reader";
export type ReaderViewMode = "side" | "translated" | "raw";

export interface ReaderSettings {
  fontSize: ReaderFontSize;
  typeface: ReaderTypeface;
  viewMode: ReaderViewMode;
}

const STORAGE_KEY = "pnt-reader-settings";

const DEFAULTS: ReaderSettings = {
  fontSize: "M",
  typeface: "default",
  viewMode: "side",
};

// Reader body sizes on top of the 16px/1.5 body base
export const READER_FONT_SIZE_PX: Record<ReaderFontSize, number> = {
  S: 14,
  M: 16,
  L: 18,
  XL: 20,
};

function load(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      fontSize: parsed.fontSize ?? DEFAULTS.fontSize,
      typeface: parsed.typeface ?? DEFAULTS.typeface,
      viewMode: parsed.viewMode ?? DEFAULTS.viewMode,
    };
  } catch {
    return DEFAULTS;
  }
}

// Module-level cache: survives SPA navigations, so client-side route changes
// render the stored settings synchronously (no flash). Null on fresh page load.
let cached: ReaderSettings | null = null;

export function useReaderSettings() {
  // First hydration must match SSR (DEFAULTS) — stored settings are applied
  // after mount; `hydrated` lets the page hide settings-dependent content
  // until then. Later SPA navigations read `cached` synchronously.
  const [settings, setSettings] = useState<ReaderSettings>(() => cached ?? DEFAULTS);
  const [hydrated, setHydrated] = useState(cached !== null);

  useEffect(() => {
    if (!cached) cached = load();
    setSettings(cached);
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      cached = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage full/blocked — settings just won't persist
      }
      return next;
    });
  }, []);

  return { settings, update, hydrated };
}
