/**
 * When something was written, in the two forms a comment or review needs: a short relative
 * label for the row ("3h ago") and the exact timestamp for its `title`, so the precise
 * moment is never more than a hover away.
 *
 * Pure and browser-safe: the reader renders comments inside an SSR payload, so nothing
 * here may depend on the request or on `Intl` options a server and browser render
 * differently at the boundary. The absolute form uses the locale's own formatting, which
 * is why the relative form is computed from a coarse number of seconds rather than from
 * calendar differences.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** A short "just now" / "5m ago" / "3d ago" label; dates older than a year read as a date. */
export function formatRelativeTime(value: Date | string, now: Date = new Date()): string {
  const date = toDate(value);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);

  if (!Number.isFinite(seconds)) return "";
  if (seconds < 45) return "just now";
  if (seconds < HOUR) return `${Math.max(1, Math.round(seconds / MINUTE))}m ago`;
  if (seconds < DAY) return `${Math.round(seconds / HOUR)}h ago`;
  if (seconds < MONTH) return `${Math.round(seconds / DAY)}d ago`;
  if (seconds < YEAR) return `${Math.round(seconds / MONTH)}mo ago`;
  return date.toLocaleDateString();
}

/** The full timestamp, for the row's `title` attribute. */
export function formatAbsoluteTime(value: Date | string): string {
  return toDate(value).toLocaleString();
}
