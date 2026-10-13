import { describe, expect, it } from "vitest";

import {
  deleteReviewSchema,
  listNovelReviewsSchema,
  novelRatingSchema,
  REVIEW_BODY_MAX_LENGTH,
  saveReviewSchema,
} from "./schemas";

describe("saveReviewSchema", () => {
  it("requires a rating in the one-to-five range", () => {
    expect(saveReviewSchema.safeParse({ novelId: "novel-1", rating: 0 }).success).toBe(false);
    expect(saveReviewSchema.safeParse({ novelId: "novel-1", rating: 6 }).success).toBe(false);
    expect(saveReviewSchema.safeParse({ novelId: "novel-1", rating: 3.5 }).success).toBe(false);
    expect(saveReviewSchema.parse({ novelId: "novel-1", rating: 5 }).rating).toBe(5);
  });

  it("treats the written review as optional", () => {
    expect(saveReviewSchema.parse({ novelId: "novel-1", rating: 4 })).not.toHaveProperty("body");
    expect(saveReviewSchema.parse({ novelId: "novel-1", rating: 4, body: "  Good.  " }).body).toBe(
      "Good.",
    );
  });

  it("holds the body to the same bound as the database check", () => {
    const atLimit = "x".repeat(REVIEW_BODY_MAX_LENGTH);
    expect(
      saveReviewSchema.safeParse({ novelId: "novel-1", rating: 4, body: atLimit }).success,
    ).toBe(true);
    expect(
      saveReviewSchema.safeParse({ novelId: "novel-1", rating: 4, body: `${atLimit}x` }).success,
    ).toBe(false);
  });
});

describe("review lookups", () => {
  it("addresses a review by novel for the summary and the deletion", () => {
    expect(novelRatingSchema.parse({ novelId: "novel-1" }).novelId).toBe("novel-1");
    expect(deleteReviewSchema.parse({ novelId: "novel-1" }).novelId).toBe("novel-1");
  });

  it("coerces and defaults the review page", () => {
    expect(listNovelReviewsSchema.parse({ novelId: "novel-1" }).page).toBe(1);
    expect(listNovelReviewsSchema.parse({ novelId: "novel-1", page: "2" }).page).toBe(2);
  });
});
