import { describe, expect, it } from "vitest";

import {
  AVATAR_MAX_BASE64_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  updateProfileImageSchema,
  updateProfileNameSchema,
} from "./schemas";

describe("updateProfileNameSchema", () => {
  it("trims surrounding whitespace", () => {
    expect(updateProfileNameSchema.parse({ name: "  tana  " })).toEqual({ name: "tana" });
  });

  it.each([[""], ["   "]])("rejects %j as an empty display name", (name) => {
    expect(updateProfileNameSchema.safeParse({ name }).success).toBe(false);
  });

  it("accepts exactly the maximum length and rejects one more", () => {
    const atLimit = "n".repeat(PROFILE_NAME_MAX_LENGTH);
    expect(updateProfileNameSchema.safeParse({ name: atLimit }).success).toBe(true);
    expect(updateProfileNameSchema.safeParse({ name: `${atLimit}n` }).success).toBe(false);
  });

  it("keeps a Thai display name intact", () => {
    expect(updateProfileNameSchema.parse({ name: "ตะวัน" })).toEqual({ name: "ตะวัน" });
  });
});

describe("updateProfileImageSchema", () => {
  const base = { image: "AAAA", imageMime: "image/webp" } as const;

  it("accepts the three uploadable types", () => {
    for (const imageMime of ["image/jpeg", "image/png", "image/webp"] as const) {
      expect(updateProfileImageSchema.safeParse({ ...base, imageMime }).success).toBe(true);
    }
  });

  it("rejects a type the server would never re-encode", () => {
    expect(updateProfileImageSchema.safeParse({ ...base, imageMime: "image/gif" }).success).toBe(
      false,
    );
  });

  it("rejects an empty payload and one past the size ceiling", () => {
    expect(updateProfileImageSchema.safeParse({ ...base, image: "" }).success).toBe(false);
    expect(
      updateProfileImageSchema.safeParse({
        ...base,
        image: "A".repeat(AVATAR_MAX_BASE64_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      updateProfileImageSchema.safeParse({
        ...base,
        image: "A".repeat(AVATAR_MAX_BASE64_LENGTH),
      }).success,
    ).toBe(true);
  });
});
