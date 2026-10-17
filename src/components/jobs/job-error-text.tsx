import { useTranslations } from "use-intl";

import { translateMessage } from "@/lib/i18n/server-error";

/**
 * A job's stored failure, in the reader's language where it can be.
 *
 * The worker stores a code — `errors.translationEmptyOutput`, a provider failure — or a sentence
 * from a library, and the row is read later by whoever owns the novel, in whatever language they
 * read. So a code is resolved here the way a log row resolves one, and a message this catalog does
 * not know stays exactly as it was stored.
 */
export function JobErrorText({ message }: { message: string }) {
  const t = useTranslations();
  const text = translateMessage(message, t) ?? message;
  return (
    <span className="block max-w-full truncate text-caption text-destructive-text" title={text}>
      {text}
    </span>
  );
}
