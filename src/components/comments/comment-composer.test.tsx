// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COMMENT_BODY_MAX_LENGTH } from "@/lib/comments/schemas";

import { CommentComposer } from "./comment-composer";

afterEach(cleanup);

function renderComposer({
  onSubmit = vi.fn(async () => true),
  initialValue = "",
  onCancel,
}: {
  onSubmit?: (body: string) => Promise<boolean>;
  initialValue?: string;
  onCancel?: () => void;
} = {}) {
  render(
    <CommentComposer
      label="Comment on Ch. 12"
      placeholder="Share your thoughts on Ch. 12…"
      initialValue={initialValue}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );

  const field = screen.getByLabelText("Comment on Ch. 12") as HTMLTextAreaElement;
  const submit = screen.getByRole("button", { name: "Post comment" }) as HTMLButtonElement;
  return { field, submit, onSubmit };
}

describe("CommentComposer", () => {
  it("will not post an empty or whitespace-only comment", () => {
    const { field, submit, onSubmit } = renderComposer();

    expect(submit.disabled).toBe(true);

    fireEvent.change(field, { target: { value: "   " } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(field, { target: { value: "Hello" } });
    expect(submit.disabled).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("posts the trimmed words and clears the field on success", async () => {
    const { field, submit, onSubmit } = renderComposer();
    const onSubmitMock = onSubmit as ReturnType<typeof vi.fn>;

    fireEvent.change(field, { target: { value: "  Great chapter.  " } });
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledWith("Great chapter.");
    await vi.waitFor(() => expect(onSubmitMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(field.value).toBe(""));
  });

  it("keeps every word when the post fails, so nothing has to be retyped", async () => {
    const onSubmit = vi.fn(async () => false);
    const { field, submit } = renderComposer({ onSubmit });

    fireEvent.change(field, { target: { value: "Try again." } });
    fireEvent.click(submit);

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(field.value).toBe("Try again.");
  });

  it("submits on Mod+Enter without needing the button", async () => {
    const { field, onSubmit } = renderComposer();

    fireEvent.change(field, { target: { value: "Shortcut." } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Shortcut."));
  });

  it("shows the remaining room only as the limit approaches", () => {
    const { field } = renderComposer();

    fireEvent.change(field, { target: { value: "x".repeat(100) } });
    expect(screen.queryByText(/characters left/)).toBeNull();

    fireEvent.change(field, { target: { value: "x".repeat(COMMENT_BODY_MAX_LENGTH - 10) } });
    expect(screen.getByText("10 characters left")).toBeTruthy();
  });

  it("offers a cancel control only when there is something to cancel", () => {
    const onCancel = vi.fn();
    const { submit } = renderComposer({ onCancel, initialValue: "Being edited" });

    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancel);

    expect(onCancel).toHaveBeenCalled();
    expect(submit.disabled).toBe(false);
  });
});
