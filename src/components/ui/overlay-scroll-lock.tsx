import { useEffect, useRef } from "react";

import { captureEvent } from "@/lib/posthog";

/**
 * The popups that hold the page still while they are open.
 *
 * A lock belongs to one of these being on screen: the stylesheet locks the root while a
 * dialog, sheet, or drawer content is mounted, and the menu, select, and popover primitives
 * lock the body inline for as long as their own popup lives. A lock with none of them left
 * is therefore a lock nobody is going to give back — which is what a reader stuck on an
 * unscrollable page is looking at, with no way out but a reload.
 */
const OVERLAY_SELECTOR = [
  '[data-slot="dialog-content"]',
  '[data-slot="sheet-content"]',
  '[data-slot="drawer-content"]',
  '[data-slot="select-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
].join(",");

/**
 * Marks a popup the recovery has given up on, so the stylesheet stops locking the page for
 * it. Written by `releaseStaleOverlayScrollLock`, read by the `:has()` rules in
 * `globals.css`, and it dies with the element it is written on.
 */
const RETIRED_ATTRIBUTE = "data-scroll-lock-released";

/** The scroll keys: the ones whose whole purpose is to move the page. */
const SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "PageDown",
  "PageUp",
  "Home",
  "End",
  " ",
  "Spacebar",
]);

/**
 * How long an overlay's own cleanup is given before its absence is judged.
 *
 * Base UI releases its inline lock through a `setTimeout(0)`, and a dialog that has just
 * closed is still mounted for the length of its exit animation. Fifty milliseconds is past
 * both, and far below the point where a reader would have tried to scroll.
 */
export const STRAY_LOCK_SETTLE_MS = 50;

/**
 * How long a popup that started moving is given to finish moving.
 *
 * An entrance or an exit is a fraction of a second of animation; a popup still carrying its
 * starting or ending state with nothing animating is one whose frame never ran. A second and
 * a half is far past any transition this system declares and far below the point where a
 * reader would notice they are stuck.
 */
export const STUCK_POPUP_MS = 1500;

const MAX_FINDINGS = 10;
const MAX_CLOSED_OVERLAYS = 10;

/**
 * What the document looks like from the outside: whether it is locked at all, and which
 * of the two mechanisms is holding it.
 *
 * The distinction is the whole point of the audit. `styled` is the stylesheet's `:has()`
 * rule, which cannot outlive its overlay element; `inline` is a lock a script wrote onto
 * `html` or `body`, which can, and does.
 */
export interface OverlayScrollLockState {
  lock: "styled" | "inline" | null;
  /** `data-slot` values of every overlay element in the document right now. */
  overlays: string[];
  html: {
    overflow: string;
    overflowY: string;
    inlineOverflow: string;
    inlineOverflowY: string;
    inlineScrollbarGutter: string;
    baseUiMarker: boolean;
  };
  body: {
    overflowY: string;
    inlineOverflow: string;
    inlineOverflowY: string;
    inlineHeight: string;
    inlineWidth: string;
    inlinePosition: string;
  };
}

interface OpenOverlay {
  slot: string;
  label: string;
  openedAt: number;
}

interface ClosedOverlay extends OpenOverlay {
  closedAt: number;
}

export interface OverlayScrollLockFinding {
  /**
   * `stray-lock` is the reader's complaint: an overlay went away and the page stayed
   * frozen. `released-on-scroll-intent` is a lock found later, by the safety net, and names
   * the popup it was taken from. `stuck-popup` is the defect behind both: a popup that
   * started moving and never finished, which Base UI waits on for a frame that never runs.
   */
  kind: "stray-lock" | "released-on-scroll-intent" | "stuck-popup";
  /** Which way the stuck popup was going, for the `stuck-popup` finding. */
  phase: "entering" | "leaving" | null;
  at: number;
  slot: string | null;
  label: string;
  /** Milliseconds between the overlay closing and the lock being noticed. */
  afterCloseMs: number | null;
  /** Set when the safety net gave the page back. */
  releasedAt: number | null;
  /** What the release did: retired a popup the stylesheet was holding, or reset inline styles. */
  releasedBy: "overlay-retired" | "inline-reset" | null;
  state: OverlayScrollLockState;
}

export interface OverlayScrollLockAudit {
  findings: OverlayScrollLockFinding[];
  closed: ClosedOverlay[];
  open: OpenOverlay[];
  state: OverlayScrollLockState;
}

const openOverlays = new Map<number, OpenOverlay>();
const closedOverlays: ClosedOverlay[] = [];
const findings: OverlayScrollLockFinding[] = [];
let nextOverlayId = 1;

function isLocked(element: HTMLElement): boolean {
  const style = element.style;
  return (
    style.overflow === "hidden" ||
    style.overflow === "clip" ||
    style.overflowY === "hidden" ||
    style.overflowY === "clip" ||
    style.overflowX === "hidden" ||
    style.overflowX === "clip"
  );
}

function overlaySlots(doc: Document): string[] {
  return [...doc.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)].map(
    (element) => element.dataset.slot ?? "unknown",
  );
}

/**
 * Reads the lock as the browser has resolved it.
 *
 * A stylesheet lock shows up in the computed style with nothing written inline; a script
 * lock shows up inline, and on the root it also drops Base UI's marker attribute.
 */
export function inspectOverlayScrollLock(doc: Document = document): OverlayScrollLockState {
  const html = doc.documentElement;
  const body = doc.body;
  const view = doc.defaultView;
  const state: OverlayScrollLockState = {
    lock: null,
    overlays: overlaySlots(doc),
    html: {
      overflow: "",
      overflowY: "",
      inlineOverflow: html.style.overflow,
      inlineOverflowY: html.style.overflowY,
      inlineScrollbarGutter: html.style.scrollbarGutter,
      baseUiMarker: html.hasAttribute("data-base-ui-scroll-locked"),
    },
    body: {
      overflowY: "",
      inlineOverflow: body?.style.overflow ?? "",
      inlineOverflowY: body?.style.overflowY ?? "",
      inlineHeight: body?.style.height ?? "",
      inlineWidth: body?.style.width ?? "",
      inlinePosition: body?.style.position ?? "",
    },
  };
  if (!body || !view) return state;

  const htmlStyle = view.getComputedStyle(html);
  const bodyStyle = view.getComputedStyle(body);
  state.html.overflow = htmlStyle.overflow;
  state.html.overflowY = htmlStyle.overflowY;
  state.body.overflowY = bodyStyle.overflowY;

  const computedLock = [htmlStyle.overflowY, bodyStyle.overflowY].some(
    (value) => value === "hidden" || value === "clip",
  );
  const inlineLock =
    isLocked(html) ||
    isLocked(body) ||
    state.html.baseUiMarker ||
    html.style.scrollbarGutter !== "";
  if (inlineLock) state.lock = "inline";
  else if (computedLock) state.lock = "styled";
  return state;
}

/** A popup's accessible name, or its first words when it has no title. */
function describeOverlay(popup: Element | null): string {
  if (!popup) return "";
  const labelledBy = popup.getAttribute("aria-labelledby");
  const labelled = labelledBy ? document.getElementById(labelledBy)?.textContent : null;
  const text = (labelled ?? popup.getAttribute("aria-label") ?? popup.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 80);
}

/** Whether a popup is on screen at all — the test that separates a live overlay from a leftover. */
function isOverlayVisible(element: Element): boolean {
  const html = element as HTMLElement;
  if (typeof html.checkVisibility === "function") {
    return html.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
      contentVisibilityAuto: true,
    });
  }
  const style = (element.ownerDocument.defaultView ?? window).getComputedStyle(html);
  return style.display !== "none" && style.visibility !== "hidden";
}

/** Whether anything is still moving on a popup, which is what a real exit looks like. */
function isAnimating(element: Element): boolean {
  const animated = element as HTMLElement;
  if (typeof animated.getAnimations !== "function") return false;
  return animated.getAnimations().some((animation) => {
    const playState = animation.playState;
    return playState !== "finished" && playState !== "idle";
  });
}

/**
 * Whether a popup has stopped being an overlay and become a leftover.
 *
 * Two states say so: Base UI has marked it as leaving, or it is not on screen and nothing is
 * moving it there. Neither can be interacted with, so neither needs the page held still —
 * and an element stuck in either state is exactly what leaves a reader with a frozen page.
 *
 * The animation test is what keeps this honest: a popup that is invisible because it is
 * still animating in has not stalled, it is arriving.
 */
function isRetiredOverlay(element: Element): boolean {
  if (element.hasAttribute("data-ending-style")) return true;
  // Closed and standing still: the exit was requested, the animation either never started
  // or already finished, and the unmount that would follow is the thing that is missing.
  if (element.hasAttribute("data-closed") && !isAnimating(element)) return true;
  return !isOverlayVisible(element) && !isAnimating(element);
}

function summarize(state: OverlayScrollLockState): string {
  const parts = [`${state.lock ?? "no"} lock`];
  if (state.overlays.length > 0) parts.push(`overlays: ${state.overlays.join(", ")}`);
  if (state.html.inlineOverflowY) parts.push(`html overflow-y=${state.html.inlineOverflowY}`);
  if (state.html.inlineScrollbarGutter) {
    parts.push(`html scrollbar-gutter=${state.html.inlineScrollbarGutter}`);
  }
  if (state.html.baseUiMarker) parts.push("Base UI marker");
  if (state.body.inlineOverflow) parts.push(`body overflow=${state.body.inlineOverflow}`);
  if (state.body.inlineOverflowY) parts.push(`body overflow-y=${state.body.inlineOverflowY}`);
  if (state.body.inlineHeight) parts.push(`body height=${state.body.inlineHeight}`);
  return parts.join("; ");
}

function recordFinding(finding: OverlayScrollLockFinding): void {
  findings.push(finding);
  if (findings.length > MAX_FINDINGS) findings.shift();
  const target = finding.slot ? `<${finding.slot}> "${finding.label}"` : "an untracked popup";
  const lag = finding.afterCloseMs === null ? "" : ` (${finding.afterCloseMs}ms after close)`;
  const detail =
    finding.kind === "stuck-popup"
      ? `popup never finished ${finding.phase === "entering" ? "entering" : "leaving"} the page — ${summarize(finding.state)}`
      : `page left frozen by ${target}${lag} — ${summarize(finding.state)}`;
  // A finding is the only time this module speaks: nothing is logged on a page that
  // scrolls. It speaks twice, because the two audiences differ. The console line belongs
  // to whoever is looking at the page; the event belongs to whoever is not — a defect this
  // quiet never reaches us as an exception, so a report from a real reader is the only
  // signal we get.
  if (import.meta.env.DEV) console.warn(`[scroll-lock] ${finding.kind}: ${detail}`, finding);
  captureEvent("overlay_scroll_lock_leak", {
    kind: finding.kind,
    phase: finding.phase,
    slot: finding.slot,
    label: finding.label,
    afterCloseMs: finding.afterCloseMs,
    releasedBy: finding.releasedBy,
    pageLocked: finding.state.lock !== null,
    lock: finding.state.lock,
    overlays: finding.state.overlays.join(","),
    htmlInlineOverflowY: finding.state.html.inlineOverflowY,
    bodyInlineOverflowY: finding.state.body.inlineOverflowY,
    bodyInlineHeight: finding.state.body.inlineHeight,
    baseUiMarker: finding.state.html.baseUiMarker,
  });
}

function readAudit(): OverlayScrollLockAudit {
  return {
    findings: [...findings],
    closed: [...closedOverlays],
    open: [...openOverlays.values()],
    state: inspectOverlayScrollLock(),
  };
}

/** Forgets what the audit has seen. Diagnostics only; nothing in the app calls it. */
export function clearOverlayScrollLockAudit(): void {
  closedOverlays.length = 0;
  findings.length = 0;
}

/**
 * The same audit, from a console.
 *
 * This is what makes the instrumentation usable where the bug happens: a reader or an
 * operator on the deployed app can type `pntScrollLockAudit()` after the page freezes and
 * read which popup closed last, when, and what the document still looks like.
 */
function publishAuditBridge(): void {
  if (typeof window === "undefined") return;
  window.pntScrollLockAudit = readAudit;
}

function scheduleStrayLockCheck(closed: ClosedOverlay): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    // Another overlay is on screen: the lock belongs to it, not to the one that closed.
    if (openOverlays.size > 0) return;
    const state = inspectOverlayScrollLock();
    if (!state.lock) return;
    recordFinding({
      kind: "stray-lock",
      phase: null,
      at: Date.now(),
      slot: closed.slot,
      label: closed.label,
      afterCloseMs: Date.now() - closed.closedAt,
      releasedAt: null,
      releasedBy: null,
      state,
    });
  }, STRAY_LOCK_SETTLE_MS);
}

/**
 * Watches a popup that has started moving, and says so when it never arrives or never goes.
 *
 * This is the defect the whole module exists for. Base UI advances its transition state on
 * an animation frame; when that frame is lost — the tab stopped rendering, the window was
 * occluded — the state attribute stays set, no animation is running, and the popup sits on
 * the page forever: invisible, uncancellable, and holding the scroll lock.
 */
function watchForStuckPopup(popup: Element, slot: string, label: string): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const phases = [
    { attribute: "data-ending-style", phase: "leaving" },
    { attribute: "data-starting-style", phase: "entering" },
  ] as const;
  const observers = phases.map(({ attribute, phase }) => {
    const observer = new MutationObserver(() => {
      if (!popup.hasAttribute(attribute)) return;
      observer.disconnect();
      window.setTimeout(() => {
        // The phase cleared while the window was open: Base UI's frame ran, so this popup
        // finished arriving or leaving and there is nothing to report. Reading the
        // attribute again is what keeps an ordinary open popup out of the findings.
        if (!popup.isConnected || !popup.hasAttribute(attribute) || isAnimating(popup)) return;
        recordFinding({
          kind: "stuck-popup",
          phase,
          at: Date.now(),
          slot,
          label,
          afterCloseMs: null,
          releasedAt: null,
          releasedBy: null,
          state: inspectOverlayScrollLock(),
        });
      }, STUCK_POPUP_MS);
    });
    observer.observe(popup, { attributes: true, attributeFilter: [attribute] });
    return observer;
  });
  return () => {
    for (const observer of observers) observer.disconnect();
  };
}

/**
 * Registers one mounted overlay and reports the page it leaves behind.
 *
 * This is an element of its own rather than a hook the popup's wrapper component calls,
 * because a wrapper stays mounted while its popup is closed: the hook would register an
 * overlay that is not on screen, and never see the one that opens later. Rendered inside
 * the popup, this mounts and unmounts with the popup itself.
 */
export function OverlayScrollLockProbe({ slot }: { slot: string }) {
  const markerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    publishAuditBridge();
    const popup = markerRef.current?.parentElement ?? null;
    const probe: OpenOverlay = {
      slot,
      label: describeOverlay(popup),
      openedAt: Date.now(),
    };
    const id = nextOverlayId;
    nextOverlayId += 1;
    openOverlays.set(id, probe);
    // A popup that never unmounts never runs the cleanup below, which is why the transition
    // is watched separately: the leftover element is the thing to name, not the silence.
    const stopWatching = popup ? watchForStuckPopup(popup, slot, probe.label) : () => {};
    return () => {
      stopWatching();
      openOverlays.delete(id);
      // The popup is read once more at the end: a confirmation dialog changes its title to
      // the action it is running, and that is the name worth recording.
      const closed: ClosedOverlay = {
        ...probe,
        label: describeOverlay(popup) || probe.label,
        closedAt: Date.now(),
      };
      closedOverlays.push(closed);
      if (closedOverlays.length > MAX_CLOSED_OVERLAYS) closedOverlays.shift();
      scheduleStrayLockCheck(closed);
    };
  }, [slot]);

  // The popup is the marker's parent, so an empty element is all this needs to be.
  return <span ref={markerRef} data-overlay-scroll-lock-probe="" hidden aria-hidden="true" />;
}

/** Undoes the inline lock an overlay leaves on the root and the body, and nothing else. */
function resetInlineLock(html: HTMLElement, body: HTMLElement): void {
  for (const element of [html, body]) {
    element.style.removeProperty("overflow");
    element.style.removeProperty("overflow-x");
    element.style.removeProperty("overflow-y");
  }
  // The pinned body is how a lock covers a scrollbar that takes layout space: the page is
  // held at one viewport and the scroll is clipped, so the box has to be unpinned too or
  // the document stays exactly as tall as the screen.
  if (body.style.height.includes("dvh")) body.style.removeProperty("height");
  if (body.style.width.includes("vw")) body.style.removeProperty("width");
  if (body.style.position === "relative") body.style.removeProperty("position");
  if (body.style.boxSizing === "border-box") body.style.removeProperty("box-sizing");
  if (html.style.scrollbarGutter !== "") html.style.removeProperty("scrollbar-gutter");
  html.removeAttribute("data-base-ui-scroll-locked");
}

/**
 * Gives the page back when its last overlay is gone — or when the only overlays left are
 * popups that have already stopped being interactive.
 *
 * It only ever undoes what an overlay lock wrote — the inline overflow on the root and the
 * body, the body box Base UI pins for scrollbars that take space, and its own root marker —
 * or retires a popup the stylesheet is holding the page for. It never touches a value a lock
 * did not set, so this cannot fight a stylesheet or a page that scrolls a container rather
 * than the document.
 *
 * @returns whether a stale lock was released.
 */
export function releaseStaleOverlayScrollLock(doc: Document = document): boolean {
  const html = doc.documentElement;
  const body = doc.body;
  if (!body) return false;

  const overlays = [...doc.querySelectorAll(OVERLAY_SELECTOR)];
  const retired = overlays.filter(isRetiredOverlay);
  const live = overlays.length - retired.length;

  if (retired.length > 0) {
    const state = inspectOverlayScrollLock(doc);
    if (!state.lock) return false;
    for (const element of retired) element.setAttribute(RETIRED_ATTRIBUTE, "");
    // Nothing interactive is left, so whatever inline lock outlived its popup goes with it.
    if (live === 0) resetInlineLock(html, body);
    const closed = closedOverlays[closedOverlays.length - 1];
    recordFinding({
      kind: "released-on-scroll-intent",
      phase: null,
      at: Date.now(),
      slot: retired[0]?.getAttribute("data-slot") ?? closed?.slot ?? null,
      label: describeOverlay(retired[0] ?? null) || closed?.label || "",
      afterCloseMs: closed ? Date.now() - closed.closedAt : null,
      releasedAt: Date.now(),
      releasedBy: "overlay-retired",
      state,
    });
    return true;
  }

  // A popup still on screen owns the page: that is the lock doing its job.
  if (live > 0) return false;

  const pinned =
    html.hasAttribute("data-base-ui-scroll-locked") ||
    html.style.scrollbarGutter !== "" ||
    isLocked(html) ||
    isLocked(body);
  if (!pinned) return false;

  const state = inspectOverlayScrollLock(doc);
  resetInlineLock(html, body);

  const closed = closedOverlays[closedOverlays.length - 1];
  const latest = findings[findings.length - 1];
  if (latest && latest.kind === "stray-lock" && latest.releasedAt === null) {
    // The same stranded lock, found a second time by the reader's first scroll attempt.
    latest.releasedAt = Date.now();
    latest.releasedBy = "inline-reset";
    return true;
  }
  recordFinding({
    kind: "released-on-scroll-intent",
    phase: null,
    at: Date.now(),
    slot: closed?.slot ?? null,
    label: closed?.label ?? "",
    afterCloseMs: closed ? Date.now() - closed.closedAt : null,
    releasedAt: Date.now(),
    releasedBy: "inline-reset",
    state,
  });
  return true;
}

/**
 * Asks the question where the reader meets it.
 *
 * A stranded lock is only ever noticed by trying to move the page, so the first scroll
 * intent is the cheapest possible moment to check that nothing is holding it: no observer
 * over a page that mostly has no overlay on it, and no timer.
 */
export function useOverlayScrollLockRecovery(): void {
  useEffect(() => {
    publishAuditBridge();
    const handleScrollIntent = (event: Event) => {
      if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) return;
      releaseStaleOverlayScrollLock();
    };
    const options = { passive: true } as const;
    window.addEventListener("wheel", handleScrollIntent, options);
    window.addEventListener("touchstart", handleScrollIntent, options);
    window.addEventListener("keydown", handleScrollIntent, options);
    return () => {
      window.removeEventListener("wheel", handleScrollIntent);
      window.removeEventListener("touchstart", handleScrollIntent);
      window.removeEventListener("keydown", handleScrollIntent);
    };
  }, []);
}

declare global {
  interface Window {
    /**
     * The overlay scroll-lock audit. Registered by the app shell; safe to call any time.
     * Diagnostic only — nothing in the app reads it.
     */
    pntScrollLockAudit?: () => OverlayScrollLockAudit;
  }
}
