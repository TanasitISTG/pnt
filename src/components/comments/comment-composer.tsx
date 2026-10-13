import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_BODY_MAX_LENGTH } from "@/lib/comments/schemas";

/** How close to the limit the counter has to be before it is worth showing. */
const COUNTER_THRESHOLD = 200;

export interface CommentComposerProps {
  /** Screen-reader label; the visible prompt lives in the placeholder. */
  label: string;
  placeholder: string;
  submitLabel?: string;
  /** Pre-filled for an edit; a fresh comment or reply starts empty. */
  initialValue?: string;
  autoFocus?: boolean;
  /** The surrounding mutation is in flight, e.g. a report while this is open. */
  disabled?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}

/**
 * One composer for every written comment: the top of the discussion, a reply, and an edit.
 *
 * It owns its text so a failed submit keeps every word - the caller returns whether the
 * post landed, and only a success clears the field. Submission is explicit, and
 * `Mod+Enter` is the shortcut rather than a bare Enter, so a paragraph break never posts
 * half a thought.
 */
export function CommentComposer({
  label,
  placeholder,
  submitLabel = "Post comment",
  initialValue = "",
  autoFocus = false,
  disabled = false,
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  const id = useId();
  const [body, setBody] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = body.trim();
  const busy = submitting || disabled;
  const canSubmit = trimmed.length > 0 && !busy;
  const remaining = COMMENT_BODY_MAX_LENGTH - body.length;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const posted = await onSubmit(trimmed);
    setSubmitting(false);
    if (posted) setBody("");
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Textarea
        id={id}
        value={body}
        rows={3}
        autoFocus={autoFocus}
        maxLength={COMMENT_BODY_MAX_LENGTH}
        placeholder={placeholder}
        disabled={busy}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption text-muted-foreground" aria-live="polite">
          {remaining <= COUNTER_THRESHOLD ? `${remaining} characters left` : ""}
        </span>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {submitting ? <Spinner /> : null}
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
