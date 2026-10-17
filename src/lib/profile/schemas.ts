import { z } from "zod";

import { encodeMessage } from "@/lib/i18n/message-code";

export const PROFILE_NAME_MAX_LENGTH = 50;

/**
 * Base64 length, not decoded bytes: 2 MiB of upload is ~2.8 M characters, which is
 * also what the browser enforces before sending. Well inside the platform body cap.
 */
export const AVATAR_MAX_BASE64_LENGTH = 2_800_000;

export const profileImageMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

// Every rule here is a key rather than a sentence: the schema is a module with no reader and no
// language, and `FieldError` resolves the code it carries in whichever language the page is in
// (i18n.md §3). The rules are the same ones the two cards beside this module word for themselves.
export const updateProfileNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, encodeMessage("validation.displayNameRequired"))
    .max(
      PROFILE_NAME_MAX_LENGTH,
      encodeMessage("validation.displayNameMax", { max: PROFILE_NAME_MAX_LENGTH }),
    ),
});

export const updateProfileImageSchema = z.object({
  image: z
    .string()
    .min(1, encodeMessage("validation.profilePhotoRequired"))
    .max(AVATAR_MAX_BASE64_LENGTH, encodeMessage("validation.profilePhotoTooLarge")),
  imageMime: profileImageMimeSchema,
});

export type UpdateProfileNameInput = z.infer<typeof updateProfileNameSchema>;
export type UpdateProfileImageInput = z.infer<typeof updateProfileImageSchema>;
