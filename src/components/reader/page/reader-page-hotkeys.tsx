import { useHotkey } from "@tanstack/react-hotkeys";

export interface ReaderHotkeysProps {
  viewMode: "side" | "translated" | "raw";
  resolvedTheme: string | undefined;
  user: unknown;
  editing: boolean;
  hasTranslation: boolean;
  chapterLoaded: boolean;
  jobRunning: boolean;
  overlayOpen: boolean;
  prevChapter: { id: string } | null;
  nextChapter: { id: string } | null;
  onUpdateViewMode: (next: "side" | "translated" | "raw") => void;
  onSetTheme: (theme: string) => void;
  onBeginEditing: () => void;
  onRequestCancelEditing: () => void;
  onSave: () => void;
  onGoToChapter: (id: string) => void;
  onSetShortcutsOpen: (open: boolean) => void;
}

const SHORTCUT_CONTROL_SELECTOR =
  "input, textarea, select, button, a, [contenteditable]:not([contenteditable='false']), [role='button'], [role='link'], [role='radio'], [role='tab'], [role='combobox'], [role='menuitem'], [role='option'], [role='textbox'], [role='listbox'], [role='spinbutton'], [role='slider']";

const PASSIVE_HOTKEY_OPTIONS = {
  ignoreInputs: false,
  preventDefault: false,
  stopPropagation: false,
} as const;

function isShortcutControl(event: KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && target.closest(SHORTCUT_CONTROL_SELECTOR) !== null;
}

type ReaderNavigationHotkeysProps = Pick<
  ReaderHotkeysProps,
  "editing" | "overlayOpen" | "prevChapter" | "nextChapter" | "onGoToChapter"
>;

type ReaderViewHotkeysProps = Pick<
  ReaderHotkeysProps,
  | "editing"
  | "overlayOpen"
  | "viewMode"
  | "resolvedTheme"
  | "hasTranslation"
  | "onUpdateViewMode"
  | "onSetTheme"
  | "onSetShortcutsOpen"
>;

type ReaderEditorHotkeysProps = Pick<
  ReaderHotkeysProps,
  | "editing"
  | "overlayOpen"
  | "user"
  | "chapterLoaded"
  | "jobRunning"
  | "onBeginEditing"
  | "onRequestCancelEditing"
  | "onSave"
>;

function isReaderShortcutBlocked(
  event: KeyboardEvent,
  editing: boolean,
  overlayOpen: boolean,
): boolean {
  return editing || overlayOpen || isShortcutControl(event);
}

function navigateToChapter(
  event: KeyboardEvent,
  chapter: { id: string } | null,
  editing: boolean,
  overlayOpen: boolean,
  onGoToChapter: (id: string) => void,
): void {
  if (isReaderShortcutBlocked(event, editing, overlayOpen) || !chapter) return;
  event.preventDefault();
  onGoToChapter(chapter.id);
}

function updateViewMode(
  event: KeyboardEvent,
  viewMode: ReaderHotkeysProps["viewMode"],
  hasTranslation: boolean,
  editing: boolean,
  overlayOpen: boolean,
  onUpdateViewMode: ReaderHotkeysProps["onUpdateViewMode"],
): void {
  if (isReaderShortcutBlocked(event, editing, overlayOpen) || !hasTranslation) return;
  event.preventDefault();
  onUpdateViewMode(viewMode === "side" ? "translated" : viewMode === "translated" ? "raw" : "side");
}

function toggleTheme(
  event: KeyboardEvent,
  resolvedTheme: string | undefined,
  editing: boolean,
  overlayOpen: boolean,
  onSetTheme: (theme: string) => void,
): void {
  if (isReaderShortcutBlocked(event, editing, overlayOpen)) return;
  event.preventDefault();
  onSetTheme(resolvedTheme === "dark" ? "light" : "dark");
}

function openShortcutHelp(
  event: KeyboardEvent,
  editing: boolean,
  overlayOpen: boolean,
  onSetShortcutsOpen: (open: boolean) => void,
): void {
  if (isReaderShortcutBlocked(event, editing, overlayOpen)) return;
  event.preventDefault();
  onSetShortcutsOpen(true);
}

function beginEditing(
  event: KeyboardEvent,
  editing: boolean,
  overlayOpen: boolean,
  user: unknown,
  chapterLoaded: boolean,
  jobRunning: boolean,
  onBeginEditing: () => void,
): void {
  if (
    isReaderShortcutBlocked(event, editing, overlayOpen) ||
    !user ||
    !chapterLoaded ||
    jobRunning
  ) {
    return;
  }
  event.preventDefault();
  onBeginEditing();
}

function saveEditing(
  event: KeyboardEvent,
  editing: boolean,
  user: unknown,
  overlayOpen: boolean,
  onSave: () => void,
): void {
  if (!editing || !user || overlayOpen) return;
  event.preventDefault();
  onSave();
}

function cancelEditing(
  event: KeyboardEvent,
  editing: boolean,
  overlayOpen: boolean,
  onRequestCancelEditing: () => void,
): void {
  if (!editing || overlayOpen) return;
  event.preventDefault();
  onRequestCancelEditing();
}

function useReaderNavigationHotkeys({
  editing,
  overlayOpen,
  prevChapter,
  nextChapter,
  onGoToChapter,
}: ReaderNavigationHotkeysProps) {
  const navigationEnabled = !editing && !overlayOpen;

  useHotkey(
    "ArrowLeft",
    (event) => navigateToChapter(event, prevChapter, editing, overlayOpen, onGoToChapter),
    { ...PASSIVE_HOTKEY_OPTIONS, enabled: navigationEnabled && !!prevChapter },
  );
  useHotkey(
    "H",
    (event) => navigateToChapter(event, prevChapter, editing, overlayOpen, onGoToChapter),
    { ...PASSIVE_HOTKEY_OPTIONS, enabled: navigationEnabled && !!prevChapter },
  );
  useHotkey(
    "ArrowRight",
    (event) => navigateToChapter(event, nextChapter, editing, overlayOpen, onGoToChapter),
    { ...PASSIVE_HOTKEY_OPTIONS, enabled: navigationEnabled && !!nextChapter },
  );
  useHotkey(
    "L",
    (event) => navigateToChapter(event, nextChapter, editing, overlayOpen, onGoToChapter),
    { ...PASSIVE_HOTKEY_OPTIONS, enabled: navigationEnabled && !!nextChapter },
  );
}

function useReaderViewHotkeys({
  editing,
  overlayOpen,
  viewMode,
  resolvedTheme,
  hasTranslation,
  onUpdateViewMode,
  onSetTheme,
  onSetShortcutsOpen,
}: ReaderViewHotkeysProps) {
  const viewHotkeysEnabled = !editing && !overlayOpen;

  useHotkey(
    "V",
    (event) =>
      updateViewMode(event, viewMode, hasTranslation, editing, overlayOpen, onUpdateViewMode),
    { ...PASSIVE_HOTKEY_OPTIONS, enabled: viewHotkeysEnabled && hasTranslation },
  );
  useHotkey("T", (event) => toggleTheme(event, resolvedTheme, editing, overlayOpen, onSetTheme), {
    ...PASSIVE_HOTKEY_OPTIONS,
    enabled: viewHotkeysEnabled,
  });
  useHotkey(
    { key: "/", shift: true },
    (event) => openShortcutHelp(event, editing, overlayOpen, onSetShortcutsOpen),
    { ...PASSIVE_HOTKEY_OPTIONS, enabled: viewHotkeysEnabled },
  );
}

function useReaderEditorHotkeys({
  editing,
  overlayOpen,
  user,
  chapterLoaded,
  jobRunning,
  onBeginEditing,
  onRequestCancelEditing,
  onSave,
}: ReaderEditorHotkeysProps) {
  useHotkey(
    "E",
    (event) =>
      beginEditing(event, editing, overlayOpen, user, chapterLoaded, jobRunning, onBeginEditing),
    {
      ...PASSIVE_HOTKEY_OPTIONS,
      enabled: !editing && !overlayOpen && !!user && chapterLoaded && !jobRunning,
    },
  );
  useHotkey("Mod+S", (event) => saveEditing(event, editing, user, overlayOpen, onSave), {
    ...PASSIVE_HOTKEY_OPTIONS,
    enabled: editing && !!user && !overlayOpen,
  });
  useHotkey(
    "Escape",
    (event) => cancelEditing(event, editing, overlayOpen, onRequestCancelEditing),
    { ...PASSIVE_HOTKEY_OPTIONS, enabled: editing && !overlayOpen },
  );
}

export function useReaderHotkeys(props: ReaderHotkeysProps) {
  useReaderNavigationHotkeys(props);
  useReaderViewHotkeys(props);
  useReaderEditorHotkeys(props);
}
