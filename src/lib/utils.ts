import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { nanoid as generateId } from "nanoid";

/**
 * The application's type scale, as `text-*` class suffixes (DESIGN.md §3.1).
 *
 * tailwind-merge cannot know a token it has never seen, and every one of these looks to it
 * exactly like a text *colour*: without this list, `cn("text-primary-foreground", "text-caption")`
 * drops one of the two, because tailwind-merge believes they are the same class group and keeps
 * whichever came last. That silently deleted the ink from every `size="sm"` filled button
 * (`bg-primary` + a dropped `text-primary-foreground`) and the size from every segmented
 * control — so the list is the fix, not a convenience.
 */
const FONT_SIZE_TOKENS = [
  "display",
  "display-alt",
  "section",
  "sub",
  "title",
  "card-title",
  "body-lg",
  "body",
  "caption",
  "micro",
  "badge-count",
  "metric",
] as const;

const mergeClasses = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: [...FONT_SIZE_TOKENS] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}

export function nanoid(size = 12): string {
  return generateId(size);
}

export const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const formatCost = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

// Browser-only: FileReader. Prefer over URL.createObjectURL when nothing
// provably revokes the object URL — data URLs need no cleanup.
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsDataURL(blob);
  });
}
