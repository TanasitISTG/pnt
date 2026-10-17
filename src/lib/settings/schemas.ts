import { z } from "zod";

import { encodeMessage } from "@/lib/i18n/message-code";
import type { ReasoningEffort } from "@/lib/providers/types";

const reasoningEffortValues = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ReasoningEffort[];

export const saveProviderSettingsSchema = z.object({
  provider: z.enum(["openai", "gemini"]).default("openai"),
  baseUrl: z
    .url(encodeMessage("validation.providerBaseUrlInvalid"))
    .or(z.literal(""))
    .default("https://api.openai.com/v1"),
  apiKey: z.string().optional().nullable(),
  model: z.string().min(1, encodeMessage("validation.providerModelRequired")),
  fastModel: z.string().optional().nullable(),
  temperature: z
    .number()
    .min(0, encodeMessage("validation.providerTemperatureMin", { min: 0 }))
    .max(2, encodeMessage("validation.providerTemperatureMax", { max: 2 })),
  reasoningEffort: z.enum(reasoningEffortValues).optional().nullable(),
  requestTimeoutSec: z.number().int().min(10).max(600).optional().nullable(),
  inputPricePer1M: z.number().min(0).optional().nullable(),
  outputPricePer1M: z.number().min(0).optional().nullable(),
});

export const testProviderConnectionSchema = z.object({
  provider: z.enum(["openai", "gemini"]).default("openai"),
  baseUrl: z
    .url(encodeMessage("validation.providerBaseUrlInvalid"))
    .or(z.literal(""))
    .default("https://api.openai.com/v1"),
  apiKey: z.string().optional().nullable(),
  model: z.string().min(1, encodeMessage("validation.providerModelRequired")),
  fastModel: z.string().optional().nullable(),
  temperature: z
    .number()
    .min(0, encodeMessage("validation.providerTemperatureMin", { min: 0 }))
    .max(2, encodeMessage("validation.providerTemperatureMax", { max: 2 })),
  reasoningEffort: z.enum(reasoningEffortValues).optional().nullable(),
  requestTimeoutSec: z.number().int().min(10).max(600).optional().nullable(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, encodeMessage("validation.currentPasswordRequired"))
      .max(1024),
    newPassword: z.string().min(8, encodeMessage("validation.passwordMin")).max(1024),
    confirmPassword: z.string().min(8, encodeMessage("validation.confirmPasswordMin")).max(1024),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: encodeMessage("validation.passwordsDoNotMatch"),
    path: ["confirmPassword"],
  });

export interface ProviderSettings {
  isConfigured: boolean;
  provider: "openai" | "gemini";
  baseUrl: string;
  model: string;
  fastModel: string | null;
  temperature: number;
  reasoningEffort: ReasoningEffort | null;
  requestTimeoutSec: number | null;
  apiKeyMasked: string;
  hasApiKey: boolean;
  inputPricePer1M: number | null;
  outputPricePer1M: number | null;
}

export type SaveProviderSettingsInput = z.infer<typeof saveProviderSettingsSchema>;
export type TestProviderConnectionInput = z.infer<typeof testProviderConnectionSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
