// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureEvent } from "@/lib/posthog";

vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn() }));

import {
  OverlayScrollLockProbe,
  STRAY_LOCK_SETTLE_MS,
  STUCK_POPUP_MS,
  clearOverlayScrollLockAudit,
  inspectOverlayScrollLock,
  releaseStaleOverlayScrollLock,
  useOverlayScrollLockRecovery,
} from "@/components/ui/overlay-scroll-lock";

function mountOverlay(slot = "dialog-content") {
  const overlay = document.createElement("div");
  overlay.dataset.slot = slot;
  document.body.append(overlay);
  return overlay;
}

let overlay: HTMLElement | null = null;

function RecoveryHarness() {
  useOverlayScrollLockRecovery();
  return null;
}

/** One overlay's popup, carrying the probe exactly as a primitive renders it. */
function ProbeHarness({ slot }: { slot: string }) {
  return (
    <div data-slot={slot}>
      <OverlayScrollLockProbe slot={slot} />
      <p>ลองงานอีกครั้ง?</p>
    </div>
  );
}

function audit() {
  const read = window.pntScrollLockAudit;
  if (!read) throw new Error("the audit bridge was not published");
  return read();
}

/** Waits past the settle window a closed overlay is given before it is judged. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, STRAY_LOCK_SETTLE_MS + 60));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  clearOverlayScrollLockAudit();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-base-ui-scroll-locked");
  document.body.removeAttribute("style");
});

afterEach(() => {
  overlay?.remove();
  overlay = null;
  cleanup();
});

describe("inspectOverlayScrollLock", () => {
  it("reads an inline lock as inline, and names the overlays on the page", () => {
    expect(inspectOverlayScrollLock()).toMatchObject({ lock: null, overlays: [] });

    document.body.style.overflow = "hidden";
    expect(inspectOverlayScrollLock().lock).toBe("inline");
    expect(inspectOverlayScrollLock().body.inlineOverflow).toBe("hidden");

    document.body.style.removeProperty("overflow");
    overlay = mountOverlay("drawer-content");
    expect(inspectOverlayScrollLock()).toMatchObject({ lock: null, overlays: ["drawer-content"] });
  });
});

describe("releaseStaleOverlayScrollLock", () => {
  it("gives the page back when the lock outlived its overlay", () => {
    document.body.style.overflow = "hidden";

    expect(releaseStaleOverlayScrollLock()).toBe(true);
    expect(document.body.style.overflow).toBe("");
  });

  it("leaves a lock alone while the overlay that owns it is still on screen", () => {
    overlay = mountOverlay();
    document.body.style.overflow = "hidden";

    expect(releaseStaleOverlayScrollLock()).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("retires a popup that started leaving and never left", () => {
    render(<RecoveryHarness />);
    overlay = mountOverlay();
    overlay.setAttribute("data-closed", "");
    overlay.setAttribute("data-ending-style", "");
    document.body.style.overflow = "hidden";

    expect(releaseStaleOverlayScrollLock()).toBe(true);
    expect(overlay.getAttribute("data-scroll-lock-released")).toBe("");
    expect(document.body.style.overflow).toBe("");

    const [finding] = audit().findings;
    expect(finding?.kind).toBe("released-on-scroll-intent");
    expect(finding?.slot).toBe("dialog-content");
    expect(finding?.releasedBy).toBe("overlay-retired");
  });

  it("retires a popup that closed and stopped moving", () => {
    render(<RecoveryHarness />);
    overlay = mountOverlay("select-content");
    // Base UI asked for the close; the popup is still on the page with nothing moving it,
    // which is the state a reader meets as an invisible sheet over a frozen page.
    overlay.setAttribute("data-closed", "");
    document.body.style.overflow = "hidden";

    expect(releaseStaleOverlayScrollLock()).toBe(true);
    expect(overlay.getAttribute("data-scroll-lock-released")).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(audit().findings.at(-1)).toMatchObject({
      kind: "released-on-scroll-intent",
      slot: "select-content",
      releasedBy: "overlay-retired",
    });
  });

  it("retires a popup that never made it onto the page", () => {
    render(<RecoveryHarness />);
    overlay = mountOverlay();
    // Base UI advanced no frame, so the popup is still at its starting style: invisible,
    // mounted, and holding a lock nobody is going to release.
    overlay.setAttribute("data-open", "");
    overlay.setAttribute("data-starting-style", "");
    overlay.style.display = "none";
    document.body.style.overflow = "hidden";

    expect(releaseStaleOverlayScrollLock()).toBe(true);
    expect(overlay.getAttribute("data-scroll-lock-released")).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(audit().findings.at(-1)).toMatchObject({
      kind: "released-on-scroll-intent",
      releasedBy: "overlay-retired",
    });
  });

  it("keeps the page still while a popup is open beside a retired one", () => {
    const retired = mountOverlay("sheet-content");
    retired.setAttribute("data-ending-style", "");
    overlay = mountOverlay("dialog-content");
    document.body.style.overflow = "hidden";

    expect(releaseStaleOverlayScrollLock()).toBe(true);
    // The retired popup is released; the live one still holds the page, so the inline lock stays.
    expect(retired.getAttribute("data-scroll-lock-released")).toBe("");
    expect(overlay.getAttribute("data-scroll-lock-released")).toBe(null);
    expect(document.body.style.overflow).toBe("hidden");
    retired.remove();
  });

  it("unpins a body a lock sized to the viewport", () => {
    document.body.style.height = "calc(100dvh - 15px)";
    document.body.style.width = "calc(100vw - 15px)";
    document.body.style.position = "relative";
    document.body.style.boxSizing = "border-box";
    document.documentElement.style.overflowY = "scroll";
    document.documentElement.style.scrollbarGutter = "stable";
    document.documentElement.setAttribute("data-base-ui-scroll-locked", "");

    expect(releaseStaleOverlayScrollLock()).toBe(true);
    expect(document.body.getAttribute("style")).toBe("");
    expect(document.documentElement.style.overflowY).toBe("");
    expect(document.documentElement.style.scrollbarGutter).toBe("");
    expect(document.documentElement.hasAttribute("data-base-ui-scroll-locked")).toBe(false);
  });

  it("does nothing to a page that is not locked", () => {
    expect(releaseStaleOverlayScrollLock()).toBe(false);
    expect(document.body.getAttribute("style")).toBe(null);
  });
});

describe("useOverlayScrollLockRecovery", () => {
  it("releases a stranded lock on the first scroll intent", () => {
    render(<RecoveryHarness />);
    document.body.style.overflow = "hidden";

    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 400 }));

    expect(document.body.style.overflow).toBe("");
  });

  it("keeps a live overlay's lock through a scroll attempt", () => {
    overlay = mountOverlay();
    render(<RecoveryHarness />);
    document.body.style.overflow = "hidden";

    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 400 }));

    expect(document.body.style.overflow).toBe("hidden");
  });

  it("names the overlay that closed last when it gives the page back", async () => {
    render(<RecoveryHarness />);
    const { unmount } = render(<ProbeHarness slot="popover-content" />);
    unmount();
    // The popup is gone but the inline lock it took is still on the page.
    document.body.style.overflow = "hidden";

    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 400 }));

    const [finding] = audit().findings;
    expect(finding?.kind).toBe("released-on-scroll-intent");
    expect(finding?.slot).toBe("popover-content");
    expect(finding?.label).toBe("ลองงานอีกครั้ง?");
    expect(finding?.releasedBy).toBe("inline-reset");
    await settle();
  });

  it("publishes the audit where a reader can reach it", () => {
    render(<RecoveryHarness />);

    expect(typeof window.pntScrollLockAudit).toBe("function");
    expect(audit()).toMatchObject({ findings: [], closed: [], open: [] });
  });
});

describe("OverlayScrollLockProbe", () => {
  it("records the overlay that closed when the page stays locked", async () => {
    const { unmount } = render(<ProbeHarness slot="dialog-content" />);
    document.body.style.overflow = "hidden";

    unmount();
    await settle();

    const [finding] = audit().findings;
    expect(finding?.kind).toBe("stray-lock");
    expect(finding?.slot).toBe("dialog-content");
    expect(finding?.label).toBe("ลองงานอีกครั้ง?");
    expect(finding?.afterCloseMs).toBeGreaterThanOrEqual(STRAY_LOCK_SETTLE_MS);
    expect(audit().closed.at(-1)).toMatchObject({ slot: "dialog-content" });
  });

  it("reports the finding where a reader's report would otherwise be the only signal", async () => {
    vi.mocked(captureEvent).mockClear();
    const { unmount } = render(<ProbeHarness slot="drawer-content" />);
    document.body.style.overflow = "hidden";

    unmount();
    await settle();

    expect(captureEvent).toHaveBeenCalledWith(
      "overlay_scroll_lock_leak",
      expect.objectContaining({
        kind: "stray-lock",
        slot: "drawer-content",
        label: "ลองงานอีกครั้ง?",
        pageLocked: true,
      }),
    );
  });

  it("says nothing when the page was given back", async () => {
    const { unmount } = render(<ProbeHarness slot="dialog-content" />);

    unmount();
    await settle();

    expect(audit().findings).toHaveLength(0);
    expect(audit().closed).toHaveLength(1);
  });

  it("says nothing when another overlay still owns the lock", async () => {
    const first = render(<ProbeHarness slot="sheet-content" />);
    render(<ProbeHarness slot="dialog-content" />);
    document.body.style.overflow = "hidden";

    first.unmount();
    await settle();

    expect(audit().findings).toHaveLength(0);
    expect(audit().open).toHaveLength(1);
  });

  it("registers nothing until the popup it lives in is on screen", () => {
    // A closed overlay renders no popup, so the probe is not rendered either.
    render(<div data-slot="dialog-content" />);

    expect(audit().open).toHaveLength(0);
  });

  it("names a popup whose exit started and never finished", async () => {
    render(<ProbeHarness slot="dialog-content" />);
    const popup = document.querySelector('[data-slot="dialog-content"]');
    if (!popup) throw new Error("the harness always renders its popup");

    // Base UI's own exit: the state attribute is set, nothing is animating, and the element
    // stays on the page because the unmount it was waiting for never ran.
    popup.setAttribute("data-closed", "");
    popup.setAttribute("data-ending-style", "");
    await wait(STUCK_POPUP_MS + 400);

    const finding = audit().findings.find((entry) => entry.kind === "stuck-popup");
    expect(finding?.phase).toBe("leaving");
    expect(finding?.slot).toBe("dialog-content");
    expect(finding?.label).toBe("ลองงานอีกครั้ง?");
    // The popup is still mounted, so the probe still counts it as open.
    expect(audit().open).toHaveLength(1);
  });

  it("says nothing about a popup that finished arriving", async () => {
    render(<ProbeHarness slot="select-content" />);
    const popup = document.querySelector('[data-slot="select-content"]');
    if (!popup) throw new Error("the harness always renders its popup");

    // The ordinary case: the starting style is written and then cleared by the frame that
    // Base UI schedules. The popup is open, visible, and holding the lock on purpose.
    popup.setAttribute("data-open", "");
    popup.setAttribute("data-starting-style", "");
    // The watch is armed by the mutation above, exactly as it would be by Base UI.
    await wait(0);
    popup.removeAttribute("data-starting-style");
    await wait(STUCK_POPUP_MS + 400);

    expect(audit().findings).toHaveLength(0);
  });

  it("names a popup that never finished arriving", async () => {
    render(<ProbeHarness slot="dialog-content" />);
    const popup = document.querySelector('[data-slot="dialog-content"]');
    if (!popup) throw new Error("the harness always renders its popup");

    // The entrance instead: the frame that clears the starting style never ran, so the
    // popup is invisible and stays that way.
    popup.setAttribute("data-open", "");
    popup.setAttribute("data-starting-style", "");
    await wait(STUCK_POPUP_MS + 400);

    const finding = audit().findings.find((entry) => entry.kind === "stuck-popup");
    expect(finding?.phase).toBe("entering");
    expect(finding?.slot).toBe("dialog-content");
  });
});
