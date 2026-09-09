// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";

import { useReaderHotkeys } from "./reader-page-hotkeys";

type ViewMode = "side" | "translated" | "raw";

type ReaderHotkeysHarnessProps = {
  editing?: boolean;
  hasTranslation?: boolean;
  overlayOpen?: boolean;
  resolvedTheme?: string;
  initialTheme?: string;
  user?: unknown;
  chapterLoaded?: boolean;
  jobRunning?: boolean;
  prevChapter?: { id: string } | null;
  nextChapter?: { id: string } | null;
};

function ReaderHotkeysHarness({
  editing = false,
  hasTranslation = true,
  overlayOpen = false,
  resolvedTheme = "dark",
  initialTheme,
  user = { id: "user" },
  chapterLoaded = true,
  jobRunning = false,
  prevChapter = { id: "previous" },
  nextChapter = { id: "next" },
}: ReaderHotkeysHarnessProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("side");
  const [theme, setTheme] = useState(initialTheme ?? resolvedTheme);
  const [navigationCount, setNavigationCount] = useState(0);
  const [lastNavigation, setLastNavigation] = useState("");
  const [beginEditingCount, setBeginEditingCount] = useState(0);
  const [saveCount, setSaveCount] = useState(0);
  const [cancelCount, setCancelCount] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useReaderHotkeys({
    viewMode,
    resolvedTheme,
    user,
    editing,
    hasTranslation,
    chapterLoaded,
    jobRunning,
    overlayOpen,
    prevChapter,
    nextChapter,
    onUpdateViewMode: (next) => setViewMode(next),
    onSetTheme: (next) => setTheme(next),
    onBeginEditing: () => setBeginEditingCount((count) => count + 1),
    onRequestCancelEditing: () => setCancelCount((count) => count + 1),
    onSave: () => setSaveCount((count) => count + 1),
    onGoToChapter: (id) => {
      setNavigationCount((count) => count + 1);
      setLastNavigation(id);
    },
    onSetShortcutsOpen: setShortcutsOpen,
  });

  return (
    <div>
      <div data-testid="navigation">
        {navigationCount}:{lastNavigation}
      </div>
      <div data-testid="view-mode">{viewMode}</div>
      <div data-testid="theme">{theme}</div>
      <div data-testid="begin-editing">{beginEditingCount}</div>
      <div data-testid="save">{saveCount}</div>
      <div data-testid="cancel">{cancelCount}</div>
      <div data-testid="shortcuts">{shortcutsOpen ? "open" : "closed"}</div>
      <input aria-label="Editor input" />
      <button type="button">Reader control</button>
    </div>
  );
}

function keyDown(target: HTMLElement, event: KeyboardEventInit & { key: string }) {
  fireEvent.keyDown(target, event);
}

function pressBody(key: string, event: Omit<KeyboardEventInit, "key"> = {}) {
  keyDown(document.body, { key, ...event });
}

function pressHelp(target: HTMLElement = document.body) {
  keyDown(target, { key: "?", code: "Slash", shiftKey: true });
}

function pressModS(target: HTMLElement) {
  const isMac = /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent);
  keyDown(target, {
    key: "s",
    code: "KeyS",
    ...(isMac ? { metaKey: true } : { ctrlKey: true }),
  });
}

afterEach(cleanup);

describe("useReaderHotkeys", () => {
  it.each([
    ["ArrowRight", "ArrowRight", "ArrowRight"],
    ["L", "l", "KeyL"],
  ])("navigates once for a body-level %s press", (_label, key, code) => {
    render(<ReaderHotkeysHarness />);

    pressBody(key, { code });

    expect(screen.getByTestId("navigation").textContent).toBe("1:next");
  });

  it("cycles view mode with V only when translated text exists", () => {
    render(<ReaderHotkeysHarness hasTranslation />);

    pressBody("v", { code: "KeyV" });
    expect(screen.getByTestId("view-mode").textContent).toBe("translated");
    pressBody("v", { code: "KeyV" });
    expect(screen.getByTestId("view-mode").textContent).toBe("raw");
    pressBody("v", { code: "KeyV" });
    expect(screen.getByTestId("view-mode").textContent).toBe("side");
  });

  it("leaves view mode unchanged when V is pressed without translation", () => {
    render(<ReaderHotkeysHarness hasTranslation={false} />);

    pressBody("v", { code: "KeyV" });

    expect(screen.getByTestId("view-mode").textContent).toBe("side");
  });

  it("toggles from the resolved dark theme to light with body T", () => {
    render(<ReaderHotkeysHarness resolvedTheme="dark" initialTheme="system" />);

    pressBody("t", { code: "KeyT" });

    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("opens the keyboard shortcut help from body ?", () => {
    render(<ReaderHotkeysHarness />);

    pressHelp();

    expect(screen.getByTestId("shortcuts").textContent).toBe("open");
  });

  it("suppresses ordinary shortcuts from inputs and controls", () => {
    render(<ReaderHotkeysHarness />);
    const input = screen.getByRole("textbox", { name: "Editor input" });
    const control = screen.getByRole("button", { name: "Reader control" });

    for (const target of [input, control]) {
      keyDown(target, { key: "ArrowLeft", code: "ArrowLeft" });
      keyDown(target, { key: "h", code: "KeyH" });
      keyDown(target, { key: "ArrowRight", code: "ArrowRight" });
      keyDown(target, { key: "l", code: "KeyL" });
      keyDown(target, { key: "v", code: "KeyV" });
      keyDown(target, { key: "t", code: "KeyT" });
      keyDown(target, { key: "e", code: "KeyE" });
      pressHelp(target);
    }

    expect(screen.getByTestId("navigation").textContent).toBe("0:");
    expect(screen.getByTestId("view-mode").textContent).toBe("side");
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("begin-editing").textContent).toBe("0");
    expect(screen.getByTestId("shortcuts").textContent).toBe("closed");
  });

  it("keeps Mod+S active in an editor input while editing", () => {
    render(<ReaderHotkeysHarness editing />);
    const input = screen.getByRole("textbox", { name: "Editor input" });

    pressModS(input);

    expect(screen.getByTestId("save").textContent).toBe("1");
  });

  it("requests editor cancellation from Escape in an editor input", () => {
    render(<ReaderHotkeysHarness editing />);
    const input = screen.getByRole("textbox", { name: "Editor input" });

    keyDown(input, { key: "Escape", code: "Escape" });

    expect(screen.getByTestId("cancel").textContent).toBe("1");
  });

  it("suppresses every reader-owned shortcut while an overlay is open", () => {
    const rendered = render(<ReaderHotkeysHarness overlayOpen />);

    pressBody("ArrowLeft", { code: "ArrowLeft" });
    pressBody("h", { code: "KeyH" });
    pressBody("ArrowRight", { code: "ArrowRight" });
    pressBody("l", { code: "KeyL" });
    pressBody("v", { code: "KeyV" });
    pressBody("t", { code: "KeyT" });
    pressBody("e", { code: "KeyE" });
    pressHelp();

    expect(screen.getByTestId("navigation").textContent).toBe("0:");
    expect(screen.getByTestId("view-mode").textContent).toBe("side");
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("begin-editing").textContent).toBe("0");
    expect(screen.getByTestId("shortcuts").textContent).toBe("closed");

    rendered.rerender(<ReaderHotkeysHarness overlayOpen editing />);
    const input = screen.getByRole("textbox", { name: "Editor input" });
    pressModS(input);
    keyDown(input, { key: "Escape", code: "Escape" });

    expect(screen.getByTestId("save").textContent).toBe("0");
    expect(screen.getByTestId("cancel").textContent).toBe("0");
  });
});
