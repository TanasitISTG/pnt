import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { providerSettings } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { auth } from "@/lib/auth";
import { encrypt, decrypt } from "@/lib/translation/crypto";
import { OpenAIProviderClient, GeminiProviderClient } from "@/lib/translation/provider-client";
import type { ProviderType } from "@/lib/translation/translation.types";
import {
  saveProviderSettingsSchema,
  testProviderConnectionSchema,
  changePasswordSchema,
} from "@/lib/settings.schemas";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export const getProviderSettings = createServerFn({ method: "GET" }).handler(async () =>
  withSafeHandler(async () => {
    const session = await ensureSession();

    const [row] = await db
      .select()
      .from(providerSettings)
      .where(eq(providerSettings.userId, session.user.id))
      .limit(1);

    if (!row) {
      return {
        isConfigured: false,
        provider: "openai" as ProviderType,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o",
        fastModel: null,
        temperature: 0.3,
        requestTimeoutSec: null,
        apiKeyMasked: "",
        hasApiKey: false,
        inputPricePer1M: null,
        outputPricePer1M: null,
      };
    }

    let hasApiKey = false;
    let apiKeyMasked = "";
    try {
      const rawKey = decrypt(row.apiKeyEnc);
      if (rawKey) {
        hasApiKey = true;
        apiKeyMasked = maskApiKey(rawKey);
      }
    } catch {
      hasApiKey = false;
    }

    return {
      isConfigured: true,
      provider: (row.provider as ProviderType) || "openai",
      baseUrl: row.baseUrl,
      model: row.model,
      fastModel: row.fastModel ?? null,
      temperature: row.temperature,
      requestTimeoutSec: row.requestTimeoutSec ?? null,
      apiKeyMasked,
      hasApiKey,
      inputPricePer1M: row.inputPricePer1M,
      outputPricePer1M: row.outputPricePer1M,
    };
  }),
);

export const saveProviderSettings = createServerFn({ method: "POST" })
  .validator(saveProviderSettingsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [existing] = await db
        .select()
        .from(providerSettings)
        .where(eq(providerSettings.userId, session.user.id))
        .limit(1);

      let apiKeyEnc = "";

      if (data.apiKey && data.apiKey.trim().length > 0) {
        apiKeyEnc = encrypt(data.apiKey.trim());
      } else if (existing?.apiKeyEnc) {
        apiKeyEnc = existing.apiKeyEnc;
      } else {
        throw new SafeServerError("API key is required for initial configuration");
      }

      await db
        .insert(providerSettings)
        .values({
          userId: session.user.id,
          provider: data.provider,
          baseUrl: data.baseUrl,
          apiKeyEnc,
          model: data.model,
          fastModel: data.fastModel ?? null,
          temperature: data.temperature,
          requestTimeoutSec: data.requestTimeoutSec ?? null,
          inputPricePer1M: data.inputPricePer1M ?? null,
          outputPricePer1M: data.outputPricePer1M ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: providerSettings.userId,
          set: {
            provider: data.provider,
            baseUrl: data.baseUrl,
            apiKeyEnc,
            model: data.model,
            fastModel: data.fastModel ?? null,
            temperature: data.temperature,
            requestTimeoutSec: data.requestTimeoutSec ?? null,
            inputPricePer1M: data.inputPricePer1M ?? null,
            outputPricePer1M: data.outputPricePer1M ?? null,
            updatedAt: new Date(),
          },
        });

      return { success: true };
    }),
  );

export const testProviderConnection = createServerFn({ method: "POST" })
  .validator(testProviderConnectionSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      let apiKey = data.apiKey?.trim();

      if (!apiKey) {
        const [existing] = await db
          .select()
          .from(providerSettings)
          .where(eq(providerSettings.userId, session.user.id))
          .limit(1);

        if (existing?.apiKeyEnc) {
          apiKey = decrypt(existing.apiKeyEnc);
        }
      }

      if (!apiKey) {
        return {
          success: false as const,
          error: "API key is required to test the connection.",
        };
      }

      try {
        const client =
          data.provider === "gemini"
            ? new GeminiProviderClient({
                apiKey,
                baseUrl: data.baseUrl,
                model: data.model,
                temperature: data.temperature,
                requestTimeoutSec: data.requestTimeoutSec,
              })
            : new OpenAIProviderClient({
                apiKey,
                baseUrl: data.baseUrl,
                model: data.model,
                temperature: data.temperature,
                requestTimeoutSec: data.requestTimeoutSec,
              });

        const startTime = Date.now();

        const response = await client.generateChatCompletion({
          messages: [{ role: "user", content: "Reply with exactly: hello" }],
          maxTokens: 128,
        });

        const latencyMs = Date.now() - startTime;
        const sample = response.content.trim();
        if (!sample) {
          return {
            success: false as const,
            error:
              "Provider returned no visible response. The model may have exhausted its output on reasoning.",
          };
        }
        return {
          success: true as const,
          latencyMs,
          sample,
        };
      } catch (err: unknown) {
        let message = err instanceof Error ? err.message : "Connection failed";
        if (message.includes("<!DOCTYPE") || message.includes("<html")) {
          const statusMatch = message.match(/^(\d{3})/);
          const code = statusMatch ? statusMatch[1] : "";
          const titleMatch = message.match(/<title>(.*?)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : "Server Error";
          message = `${code ? `${code} ` : ""}${title} (Server returned HTML error page)`;
        }
        return {
          success: false as const,
          error: message,
        };
      }
    }),
  );

export const changePassword = createServerFn({ method: "POST" })
  .validator(changePasswordSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      await ensureSession();
      const headers = getRequestHeaders();

      try {
        await auth.api.changePassword({
          headers,
          body: {
            currentPassword: data.currentPassword,
            newPassword: data.newPassword,
            revokeOtherSessions: false,
          },
        });
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to change password";
        throw new SafeServerError(message);
      }
    }),
  );
