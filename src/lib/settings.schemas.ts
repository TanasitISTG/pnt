import { z } from "zod";

export const saveProviderSettingsSchema = z.object({
  baseUrl: z.string().url("Base URL must be a valid URL (e.g. https://api.openai.com/v1)"),
  apiKey: z.string().optional().nullable(),
  model: z.string().min(1, "Model name is required"),
  temperature: z.number().min(0, "Min temperature is 0").max(2, "Max temperature is 2"),
  inputPricePer1M: z.number().min(0).optional().nullable(),
  outputPricePer1M: z.number().min(0).optional().nullable(),
});

export const testProviderConnectionSchema = z.object({
  baseUrl: z.string().url("Base URL must be a valid URL (e.g. https://api.openai.com/v1)"),
  apiKey: z.string().optional().nullable(),
  model: z.string().min(1, "Model name is required"),
  temperature: z.number().min(0, "Min temperature is 0").max(2, "Max temperature is 2"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Confirm password must be at least 8 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  });

export type SaveProviderSettingsInput = z.infer<typeof saveProviderSettingsSchema>;
export type TestProviderConnectionInput = z.infer<typeof testProviderConnectionSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
