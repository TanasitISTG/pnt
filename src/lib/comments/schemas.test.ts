import { describe, expect, it } from "vitest";

import {
  COMMENT_BODY_MAX_LENGTH,
  createCommentSchema,
  deleteCommentSchema,
  listChapterCommentsSchema,
  updateCommentSchema,
} from "./schemas";

describe("createCommentSchema", () => {
  it("trims the body and keeps the chapter and parent", () => {
    expect(
      createCommentSchema.parse({
        chapterId: "chapter-1",
        parentId: "comment-1",
        body: "  Thanks for the warning.  ",
      }),
    ).toEqual({ chapterId: "chapter-1", parentId: "comment-1", body: "Thanks for the warning." });
  });

  it("refuses an empty or whitespace-only comment", () => {
    expect(createCommentSchema.safeParse({ chapterId: "chapter-1", body: "   " }).success).toBe(
      false,
    );
  });

  it("holds the body to the same bound as the database check", () => {
    const atLimit = "x".repeat(COMMENT_BODY_MAX_LENGTH);
    expect(createCommentSchema.safeParse({ chapterId: "chapter-1", body: atLimit }).success).toBe(
      true,
    );
    expect(
      createCommentSchema.safeParse({ chapterId: "chapter-1", body: `${atLimit}x` }).success,
    ).toBe(false);
  });

  it("accepts a top-level comment without a parent", () => {
    expect(
      createCommentSchema.parse({ chapterId: "chapter-1", body: "First." }),
    ).not.toHaveProperty("parentId");
  });
});

describe("updateCommentSchema and deleteCommentSchema", () => {
  it("requires a nonblank edited body", () => {
    expect(updateCommentSchema.safeParse({ commentId: "comment-1", body: " " }).success).toBe(
      false,
    );
    expect(updateCommentSchema.parse({ commentId: "comment-1", body: " Fixed. " }).body).toBe(
      "Fixed.",
    );
  });

  it("addresses a deletion by comment id alone", () => {
    expect(deleteCommentSchema.parse({ commentId: "comment-1" })).toEqual({
      commentId: "comment-1",
    });
  });
});

describe("listChapterCommentsSchema", () => {
  it("coerces the page and defaults to the first one", () => {
    expect(listChapterCommentsSchema.parse({ chapterId: "chapter-1" }).page).toBe(1);
    expect(listChapterCommentsSchema.parse({ chapterId: "chapter-1", page: "3" }).page).toBe(3);
  });

  it("refuses a page before the first", () => {
    expect(listChapterCommentsSchema.safeParse({ chapterId: "chapter-1", page: 0 }).success).toBe(
      false,
    );
  });
});
