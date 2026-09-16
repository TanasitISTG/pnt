import { useCallback, useEffect, useState } from "react";

import type {
  ReaderFontSize,
  ReaderLineHeight,
  ReaderMeasure,
  ReaderPageTheme,
  ReaderSettings,
  ReaderTypeface,
  ReaderViewMode,
} from "./types";

const STORAGE_KEY = "pnt-reader-settings";

const DEFAULTS: ReaderSettings = {
  fontSize: "M",
  typeface: "default",
  viewMode: "side",
  lineHeight: "normal",
  measure: "medium",
  pageTheme: "app",
};

export const READER_FONT_SIZE_PX: Record<ReaderFontSize, number> = {
  S: 14,
  M: 16,
  L: 18,
  XL: 20,
};

export const READER_LINE_HEIGHT: Record<ReaderLineHeight, number> = {
  compact: 1.5,
  normal: 1.75,
  relaxed: 2,
};

export const READER_MEASURE_REM: Record<ReaderMeasure, number> = {
  narrow: 34,
  medium: 42,
  wide: 52,
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

function isReaderLineHeight(value: unknown): value is ReaderLineHeight {
  return value === "compact" || value === "normal" || value === "relaxed";
}

function isReaderMeasure(value: unknown): value is ReaderMeasure {
  return value === "narrow" || value === "medium" || value === "wide";
}

function isReaderPageTheme(value: unknown): value is ReaderPageTheme {
  return value === "app" || value === "sepia" || value === "paper";
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
      lineHeight: isReaderLineHeight(stored.lineHeight) ? stored.lineHeight : DEFAULTS.lineHeight,
      measure: isReaderMeasure(stored.measure) ? stored.measure : DEFAULTS.measure,
      pageTheme: isReaderPageTheme(stored.pageTheme) ? stored.pageTheme : DEFAULTS.pageTheme,
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
