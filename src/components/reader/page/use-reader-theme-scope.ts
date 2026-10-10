import { useEffect } from "react";

import type { ReaderPageTheme } from "@/lib/reader/types";

// Scoping the page theme on <html> repaints the shell, the body and portalled dialogs alike.
export function useReaderThemeScope(theme: ReaderPageTheme, ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    if (theme === "app") {
      delete root.dataset.readerTheme;
      return;
    }

    root.dataset.readerTheme = theme;
    return () => {
      delete root.dataset.readerTheme;
    };
  }, [ready, theme]);
}
