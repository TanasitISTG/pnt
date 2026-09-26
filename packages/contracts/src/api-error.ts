import { z } from "zod";

export const apiErrorCodeV1Schema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);
export const apiErrorV1Schema = z.strictObject({
  error: z.strictObject({ code: apiErrorCodeV1Schema, message: z.string() }),
});
export type ApiErrorCodeV1 = z.infer<typeof apiErrorCodeV1Schema>;
export type ApiErrorV1 = z.infer<typeof apiErrorV1Schema>;
