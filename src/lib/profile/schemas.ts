import { z } from "zod";

export const PROFILE_NAME_MAX_LENGTH = 50;

/**
 * Base64 length, not decoded bytes: 2 MiB of upload is ~2.8 M characters, which is
 * also what the browser enforces before sending. Well inside the platform body cap.
 */
export const AVATAR_MAX_BASE64_LENGTH = 2_800_000;

export const profileImageMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export const updateProfileNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(
      PROFILE_NAME_MAX_LENGTH,
      `Display name must be at most ${PROFILE_NAME_MAX_LENGTH} characters`,
    ),
});

export const updateProfileImageSchema = z.object({
  image: z
    .string()
    .min(1, "A profile photo is required")
    .max(AVATAR_MAX_BASE64_LENGTH, "Profile photo must be smaller than 2MB"),
  imageMime: profileImageMimeSchema,
});

export type UpdateProfileNameInput = z.infer<typeof updateProfileNameSchema>;
export type UpdateProfileImageInput = z.infer<typeof updateProfileImageSchema>;
