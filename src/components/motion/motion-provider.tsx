import * as React from "react";
import { LazyMotion } from "motion/react";

/**
 * Motion, loaded lazily.
 *
 * The declarative `motion` component carries its whole feature set (~34KB, not
 * tree-shakeable); `m` plus a feature bundle loaded on demand keeps the initial payload
 * to a few KB, which matters most on the reader — the app's highest-traffic route.
 * `strict` fails loudly if a full `motion` component is ever imported by mistake.
 *
 * Anything that CSS can already do (overlays, drawers, press feedback) uses the CSS
 * tokens instead; Motion is for surfaces that need to interrupt, retarget or respond to
 * a gesture. Every Motion surface branches on `useReducedMotion()`.
 */
const loadFeatures = () => import("motion/react").then((mod) => mod.domAnimation);

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}
