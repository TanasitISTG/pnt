// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TestI18nProvider } from "@/test/i18n";
import type { ChapterComment } from "@/lib/comments/types";

import { CommentItem } from "./comment-item";

afterEach(cleanup);

const parent: ChapterComment = {
  id: "comment-1",
  body: "Loved this chapter.",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  editedAt: null,
  deletedAt: null,
  removedAt: null,
  removalReason: null,
  author: { id: "user-1", name: "tana", avatar: null },
  isOwn: false,
  viewerReported: false,
};

/**
 * The reply composer belongs to the thread, not to the parent comment alone: it sits after
 * the replies so a comment posted into it lands above the field the reader is typing in.
 */
describe("CommentItem", () => {
  it("renders the reply composer after the replies, so a new reply appears above it", () => {
    render(
      <TestI18nProvider>
        <CommentItem comment={parent} footer={<textarea aria-label="Reply composer" />}>
          <p>First reply</p>
          <p>Second reply</p>
        </CommentItem>
      </TestI18nProvider>,
    );

    const secondReply = screen.getByText("Second reply");
    const composer = screen.getByLabelText("Reply composer");

    // Node.compareDocumentPosition: FOLLOWING means the composer comes after the reply.
    expect(secondReply.compareDocumentPosition(composer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders a comment with no replies exactly as before, composer directly under it", () => {
    render(
      <TestI18nProvider>
        <CommentItem comment={parent} footer={<textarea aria-label="Reply composer" />} />
      </TestI18nProvider>,
    );

    const body = screen.getByText("Loved this chapter.");
    const composer = screen.getByLabelText("Reply composer");

    expect(body.compareDocumentPosition(composer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
