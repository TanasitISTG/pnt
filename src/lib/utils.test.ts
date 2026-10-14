import { describe, expect, it } from "vitest";

import { cn } from "./utils";

/**
 * The application's type scale uses `text-*` names that mean a font size, while Tailwind's
 * own `text-*` utilities just as often mean a colour. tailwind-merge has to be told which is
 * which, or it treats `text-caption` and `text-primary-foreground` as the same class and keeps
 * only the last one — which is how a filled `size="sm"` button lost its text colour.
 */
describe("cn", () => {
  const FONT_SIZES = [
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
  ];

  it.each(FONT_SIZES)("keeps the text colour next to a %s size", (size) => {
    expect(cn(`text-primary-foreground`, `text-${size}`)).toContain("text-primary-foreground");
    expect(cn(`text-${size}`, "text-muted-foreground")).toContain("text-muted-foreground");
  });

  it("keeps the size and the colour whichever order they arrive in", () => {
    expect(cn("text-primary-foreground", "text-caption")).toBe(
      "text-primary-foreground text-caption",
    );
  });

  it("still resolves a genuine conflict by the last class", () => {
    expect(cn("text-body", "text-caption")).toBe("text-caption");
    expect(cn("bg-primary", "bg-surface-inset")).toBe("bg-surface-inset");
    expect(cn("text-foreground", "text-ink")).toBe("text-ink");
  });
});
