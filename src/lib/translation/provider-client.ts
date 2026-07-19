import "@tanstack/react-start/server-only";
import OpenAI from "openai";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { providerSettings } from "@/lib/db/schema";
import { decrypt } from "@/lib/translation/crypto";

export class ProviderNotConfiguredError extends Error {
  constructor(message = "AI provider settings are not configured") {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export interface ProviderClientConfig {
  client: OpenAI;
  model: string;
  temperature: number;
  baseUrl: string;
}

export async function createProviderClient(userId: string): Promise<ProviderClientConfig> {
  const [settings] = await db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1);

  if (!settings || !settings.apiKeyEnc) {
    throw new ProviderNotConfiguredError();
  }

  const apiKey = decrypt(settings.apiKeyEnc);

  const client = new OpenAI({
    baseURL: settings.baseUrl,
    apiKey,
  });

  return {
    client,
    model: settings.model,
    temperature: settings.temperature,
    baseUrl: settings.baseUrl,
  };
}
