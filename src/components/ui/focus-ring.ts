/**
 * One focus convention for the whole app: a 2px ink ring with offset.
 *
 * An outline rather than a box-shadow, because the primary button already spends its
 * box-shadow on the inset signature — a ring that composes beats a ring that replaces.
 * The `:focus-visible` fallback in globals.css covers anything that forgets this.
 */
export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Fields and dense controls, where an outside ring would clip against the container. */
export const focusRingInset =
  "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
