import { useCallback, useEffect, useState } from "react";

import type { ReaderFontSize, ReaderSettings, ReaderTypeface, ReaderViewMode } from "./types";

const STORAGE_KEY = "pnt-reader-settings";

const DEFAULTS: ReaderSettings = {
  fontSize: "M",
  typeface: "default",
  viewMode: "side",
};

export const READER_FONT_SIZE_PX: Record<ReaderFontSize, number> = {
  S: 14,
  M: 16,
  L: 18,
  XL: 20,
};

function isReaderFontSize(value: unknown): value is ReaderFontSize {
  return value === "S" || value === "M" || value === "L" || value === "XL";
}

function isReaderTypeface(value: unknown): value is ReaderTypeface {
  return value === "default" || value === "reader";
}

function isReaderViewMode(value: unknown): value is ReaderViewMode {
  return value === "side" || value === "translated" || value === "raw";
}

function load(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const stored = parsed as Record<string, unknown>;
    return {
      fontSize: isReaderFontSize(stored.fontSize) ? stored.fontSize : DEFAULTS.fontSize,
      typeface: isReaderTypeface(stored.typeface) ? stored.typeface : DEFAULTS.typeface,
      viewMode: isReaderViewMode(stored.viewMode) ? stored.viewMode : DEFAULTS.viewMode,
    };
  } catch {
    return DEFAULTS;
  }
}

let cached: ReaderSettings | null = null;

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(() => cached ?? DEFAULTS);
  const [ready, setReady] = useState(() => cached !== null);

  useEffect(() => {
    if (!cached) cached = load();
    setSettings(cached);
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    const next = { ...(cached ?? DEFAULTS), ...patch };
    cached = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage full/blocked — settings just won't persist
    }
    setSettings(next);
  }, []);

  return { settings, update, ready };
}
