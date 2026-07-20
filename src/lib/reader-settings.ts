import { useCallback, useState } from "react";

export type ReaderFontSize = "S" | "M" | "L" | "XL";
export type ReaderTypeface = "default" | "reader";
export type ReaderTheme = "light" | "dark";

export interface ReaderSettings {
  fontSize: ReaderFontSize;
  typeface: ReaderTypeface;
  theme: ReaderTheme;
}

const STORAGE_KEY = "pnt-reader-settings";

const DEFAULTS: ReaderSettings = {
  fontSize: "M",
  typeface: "default",
  theme: "light",
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
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ReaderSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(load);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage full/blocked — settings just won't persist
      }
      return next;
    });
  }, []);

  return { settings, update };
}
