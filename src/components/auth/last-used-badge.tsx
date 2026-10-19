import { useTranslations } from "use-intl";

import { Badge } from "@/components/ui/badge";

/**
 * The marker a returning reader sees on the method they used last.
 *
 * One component for both placements - the password form's submit button and the provider
 * button it names - so the two can never disagree about wording, tone, or geometry. It is a
 * tag pinned to that button's top-right corner, the shape every product that offers this hint
 * uses: the control underneath already says "Google" or "Sign in", so the chip only has to say
 * "this one", and pinning it to the corner says it without taking space from the label.
 *
 * It uses the primitive's `tag` treatment, the one opaque chip, because part of it hangs over
 * a filled primary button: a translucent fill and muted text would disappear into that fill.
 * An opaque surface keeps the same contrast whether it straddles the outline of a provider
 * button or the charcoal primary one.
 *
 * The text is real content, not decoration: a screen reader reads it immediately after the
 * button it follows, with no extra label needed.
 *
 * It settles onto that corner rather than blinking into place. The entrance belongs to the
 * primitive's `tag` treatment (the chip's own bottom-right origin, 3px of travel, 160ms), so
 * both placements get the same motion and this component only decides where it sits.
 */
export function LastUsedBadge({ className }: { className?: string }) {
  const t = useTranslations("auth");

  return (
    <Badge variant="tag" className={className}>
      {t("lastUsed")}
    </Badge>
  );
}
