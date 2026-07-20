import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db";
import { providerSettings } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { auth } from "@/lib/auth";
import { encrypt, decrypt } from "@/lib/translation/crypto";
import {
  saveProviderSettingsSchema,
  testProviderConnectionSchema,
  changePasswordSchema,
} from "@/lib/settings.schemas";

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export const getProviderSettings = createServerFn({ method: "GET" }).handler(async () => {
  const session = await ensureSession();

  const [row] = await db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.userId, session.user.id))
    .limit(1);

  if (!row) {
    return {
      isConfigured: false,
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      temperature: 0.7,
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
    baseUrl: row.baseUrl,
    model: row.model,
    temperature: row.temperature,
    apiKeyMasked,
    hasApiKey,
    inputPricePer1M: row.inputPricePer1M,
    outputPricePer1M: row.outputPricePer1M,
  };
});

export const saveProviderSettings = createServerFn({ method: "POST" })
  .validator(saveProviderSettingsSchema)
  .handler(async ({ data }) => {
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
      throw new Error("API key is required for initial configuration");
    }

    await db
      .insert(providerSettings)
      .values({
        userId: session.user.id,
        baseUrl: data.baseUrl,
        apiKeyEnc,
        model: data.model,
        temperature: data.temperature,
        inputPricePer1M: data.inputPricePer1M ?? null,
        outputPricePer1M: data.outputPricePer1M ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: providerSettings.userId,
        set: {
          baseUrl: data.baseUrl,
          apiKeyEnc,
          model: data.model,
          temperature: data.temperature,
          inputPricePer1M: data.inputPricePer1M ?? null,
          outputPricePer1M: data.outputPricePer1M ?? null,
          updatedAt: new Date(),
        },
      });

    return { success: true };
  });

export const testProviderConnection = createServerFn({ method: "POST" })
  .validator(testProviderConnectionSchema)
  .handler(async ({ data }) => {
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
      const client = new OpenAI({
        baseURL: data.baseUrl,
        apiKey,
      });

      const startTime = Date.now();

      const response = await client.chat.completions.create({
        model: data.model,
        temperature: data.temperature,
        max_tokens: 10,
        messages: [{ role: "user", content: "Say hello." }],
      });

      const latencyMs = Date.now() - startTime;
      const sample = response.choices[0]?.message?.content?.trim() || "OK";

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
  });

export const changePassword = createServerFn({ method: "POST" })
  .validator(changePasswordSchema)
  .handler(async ({ data }) => {
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
      throw new Error(message, { cause: err });
    }
  });
