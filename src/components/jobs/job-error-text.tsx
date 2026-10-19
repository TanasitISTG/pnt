import { useTranslations } from "use-intl";

import { translateMessage } from "@/lib/i18n/server-error";
import { cn } from "@/lib/utils";

/**
 * A job's stored failure, in the reader's language where it can be.
 *
 * The worker stores a code — `errors.translationEmptyOutput`, a provider failure — or a sentence
 * from a library, and the row is read later by whoever owns the novel, in whatever language they
 * read. So a code is resolved here the way a log row resolves one, and a message this catalog does
 * not know stays exactly as it was stored.
 *
 * Every surface that shows a stored failure renders through this component, because the code is
 * the stored value, not an accident of one screen: the table, the activity bands and both job
 * drawers read the same column. `className` is the layout, not the colour or the type size — a
 * band clamps two lines where a drawer wraps the whole message.
 */
export function JobErrorText({ message, className }: { message: string; className?: string }) {
  const t = useTranslations();
  const text = translateMessage(message, t) ?? message;
  return (
    <span
      className={cn("block max-w-full text-caption text-destructive-text", className ?? "truncate")}
      title={text}
    >
      {text}
    </span>
  );
}
