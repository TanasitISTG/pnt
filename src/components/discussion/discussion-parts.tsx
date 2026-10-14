import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldOff, Trash2 } from "lucide-react";
import { useTranslations } from "use-intl";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";

/**
 * The vocabulary a conversation is written in, shared by chapter discussions and novel
 * reviews.
 *
 * The two surfaces were built separately and had already drifted into two implementations
 * of the same four things: a titled section with a count, the tombstone that stands in for
 * words that are gone, the pending list, and the invitation to sign in and take part. A
 * reader should not be able to tell which of the two they are looking at, so the four live
 * here and both sections import them.
 */

interface DiscussionHeadingProps {
  /** The id the section's `aria-labelledby` points at. */
  id: string;
  icon: ReactNode;
  title: string;
  /** Shown only when there is something to count. */
  count: number;
}

/**
 * A conversation's heading: the icon, the name, and how many there are.
 *
 * The count is decorative to assistive technology - the list below it says the same thing -
 * so the heading keeps the plain name and a screen reader hears one label rather than a
 * label and a stray digit.
 */
export function DiscussionHeading({ id, icon, title, count }: DiscussionHeadingProps) {
  return (
    <header className="flex min-w-0 items-center gap-2">
      <span className="text-muted-foreground [&_svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <h2 id={id} className="text-body-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {count > 0 ? (
        <Badge variant="muted" size="count" aria-hidden="true">
          {count}
        </Badge>
      ) : null}
    </header>
  );
}

interface DiscussionTombstoneProps {
  /** Who took the words away: an operator, or the person who wrote them. */
  kind: "removed" | "deleted";
  /** The operator's reason, when one was given. Removals always say who did it. */
  reason?: string | null;
  /** A deletion's own sentence, where the surface words it differently. */
  children?: ReactNode;
}

/**
 * What is left in the place of words that are no longer shown.
 *
 * It is a surface rather than an italic line, because a tombstone is not a quiet version of
 * a comment - it is a different thing standing where a comment was, and the thread around it
 * only makes sense if that is obvious at a glance. Replying to, editing or reporting one
 * stays impossible; that is the caller's decision, since only the caller knows which actions
 * it was willing to offer.
 */
export function DiscussionTombstone({ kind, reason, children }: DiscussionTombstoneProps) {
  const t = useTranslations("comments");
  const Icon = kind === "removed" ? ShieldOff : Trash2;
  // A removal always says who did it; whether the operator's reason is shown is a second
  // sentence rather than a suffix, because Thai does not put a colon inside a phrase the way
  // English does.
  const sentence =
    kind === "removed"
      ? reason
        ? t("removedByOperatorWithReason", { reason })
        : t("removedByOperator")
      : (children ?? t("deletedByAuthor"));

  return (
    <p className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-surface-inset px-3 py-2 text-caption text-muted-foreground">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 text-pretty">{sentence}</span>
    </p>
  );
}

/**
 * The pending list, in the shape of the rows it will become: one avatar's worth of circle
 * and two lines of text.
 *
 * It is built on the shared `Skeleton`, not on a hand-rolled `animate-pulse`, because the
 * pulse is decorative and must stop under `prefers-reduced-motion` - a looping animation is
 * exactly what that preference is asking about.
 */
export function DiscussionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3">
          <Skeleton shape="avatar" className="size-7 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface DiscussionSignInPromptProps {
  /** Where to come back to once there is a session. */
  redirect: string;
  /** The sentence that follows the link, which names what signing in would let you do. */
  children: ReactNode;
}

/**
 * The line a signed-out reader meets where a composer would be: what they could do, and the
 * one link that lets them do it. Reading never depends on it.
 */
export function DiscussionSignInPrompt({ redirect, children }: DiscussionSignInPromptProps) {
  const tShell = useTranslations("shell");
  const localized = useLocalizedParams();

  return (
    <p className="text-body text-muted-foreground">
      <Link
        to="/{-$locale}/login"
        params={localized}
        search={{ redirect }}
        className="font-medium text-foreground underline underline-offset-4"
      >
        {tShell("signIn")}
      </Link>{" "}
      {children}
    </p>
  );
}
