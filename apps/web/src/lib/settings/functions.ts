import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { providerSettings } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
import { auth } from "@/lib/auth/auth";
import { log } from "@/lib/log";
import { encrypt, decrypt } from "@/lib/settings/crypto";
import {
  OpenAIProviderClient,
  GeminiProviderClient,
} from "@/lib/translation/providers/provider-client";
import type { ProviderType, ReasoningEffort } from "@/lib/providers/types";
import {
  saveProviderSettingsSchema,
  testProviderConnectionSchema,
  changePasswordSchema,
  type ProviderSettings,
  type SaveProviderSettingsInput,
} from "@/lib/settings/schemas";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

type ProviderFailureCode =
  | "AUTH_FAILED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "CONNECTION_FAILED";

const PROVIDER_FAILURE_MESSAGES: Record<ProviderFailureCode, string> = {
  AUTH_FAILED: "Provider authentication failed. Check the API key.",
  NOT_FOUND: "Provider endpoint or model was not found.",
  RATE_LIMITED: "Provider rate limit reached. Try again later.",
  TIMEOUT: "Provider request timed out.",
  CONNECTION_FAILED: "Could not connect to the provider. Check the settings and try again.",
};

const TIMEOUT_ERROR_NAMES: Record<string, true> = {
  APIConnectionTimeoutError: true,
  TimeoutError: true,
  ConnectTimeoutError: true,
};
const TIMEOUT_ERROR_CODES: Record<string, true> = {
  ETIMEDOUT: true,
  TIMEOUT: true,
  UND_ERR_CONNECT_TIMEOUT: true,
  UND_ERR_HEADERS_TIMEOUT: true,
  UND_ERR_BODY_TIMEOUT: true,
};
const STATUS_FIELDS = ["status", "statusCode"] as const;

type TrustedErrorFields = {
  status: number | undefined;
  code: string | undefined;
  bodyCode: string | undefined;
  timeout: boolean;
};

/**
 * Collects trusted structured metadata (numeric status, error code, class name) from an error and
 * its cause chain. Upstream message text, HTML bodies and payload fields are never read.
 */
function readTrustedErrorFields(error: unknown): TrustedErrorFields {
  let status: number | undefined;
  let code: string | undefined;
  let bodyCode: string | undefined;
  let timeout = false;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    const fields = current as Record<string, unknown>;
    if (status === undefined) {
      for (const key of STATUS_FIELDS) {
        const candidate = fields[key];
        if (typeof candidate === "number" && Number.isInteger(candidate)) {
          status = candidate;
          break;
        }
      }
    }
    const levelCode = fields["code"];
    if (code === undefined && typeof levelCode === "string") code = levelCode;
    if (bodyCode === undefined && typeof fields["body"] === "object" && fields["body"] !== null) {
      const candidate = (fields["body"] as Record<string, unknown>)["code"];
      if (typeof candidate === "string") bodyCode = candidate;
    }
    const name = fields["name"];
    const className = current instanceof Error ? current.constructor.name : undefined;
    if (
      (typeof name === "string" && TIMEOUT_ERROR_NAMES[name] === true) ||
      (className !== undefined && TIMEOUT_ERROR_NAMES[className] === true) ||
      (typeof levelCode === "string" && TIMEOUT_ERROR_CODES[levelCode] === true)
    ) {
      timeout = true;
    }
    current = fields["cause"];
  }
  return { status, code, bodyCode, timeout };
}

function providerFailureCode(fields: TrustedErrorFields): ProviderFailureCode | null {
  if (fields.status === 401 || fields.status === 403) return "AUTH_FAILED";
  if (fields.status === 404) return "NOT_FOUND";
  if (fields.status === 429) return "RATE_LIMITED";
  if (fields.timeout) return "TIMEOUT";
  if (fields.status !== undefined && fields.status >= 500) return "CONNECTION_FAILED";
  return null;
}

/**
 * Maps a provider client failure to a fixed public message using only trusted structured fields
 * (numeric status, error code, class name). Upstream bodies, messages, URLs and keys never escape.
 */
const providerConnectionFailure = createServerOnlyFn(async function providerConnectionFailure(
  error: unknown,
): Promise<{ code: string; message: string }> {
  // Dynamic import is required so this `.server` transport never enters the client graph.
  const { ProviderRequestError } =
    await import("@/lib/translation/providers/provider-network.server");
  // The transport policy classifies unsupported JSON response mode itself; keep its fixed literal.
  if (error instanceof ProviderRequestError && error.code === "JSON_MODE_UNSUPPORTED") {
    return { code: error.code, message: error.message };
  }
  const failure = providerFailureCode(readTrustedErrorFields(error));
  if (failure) return { code: failure, message: PROVIDER_FAILURE_MESSAGES[failure] };
  // Transport policy failures already carry fixed, non-forwarding literals (URL, DNS, redirect).
  if (error instanceof ProviderRequestError) return { code: error.code, message: error.message };
  return { code: "CONNECTION_FAILED", message: PROVIDER_FAILURE_MESSAGES.CONNECTION_FAILED };
});

const PASSWORD_INCORRECT_MESSAGE = "Current password is incorrect.";
const PASSWORD_GENERIC_MESSAGE = "Could not change password. Try again.";

/**
 * Maps a password change failure to its fixed public message using only trusted structured
 * fields. Only Better Auth's documented body.code reports the wrong current password;
 * every other failure (including unrelated errors that merely carry a top-level code) is generic.
 */
export function passwordChangeFailureMessage(error: unknown): string {
  const bodyCode = readTrustedErrorFields(error).bodyCode;
  return bodyCode === "INVALID_PASSWORD" ? PASSWORD_INCORRECT_MESSAGE : PASSWORD_GENERIC_MESSAGE;
}

/** Rejects provider URLs the runtime transport would refuse to dial, reporting the fixed policy message. */
const assertProviderSettingsUrl = createServerOnlyFn(async function assertProviderSettingsUrl(
  baseUrl: string,
  provider: ProviderType,
): Promise<void> {
  // Dynamic import is required so this `.server` transport never enters the client graph.
  const { assertProviderBaseUrl, ProviderRequestError } =
    await import("@/lib/translation/providers/provider-network.server");
  try {
    await assertProviderBaseUrl(baseUrl, provider);
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      log("warn", "Provider URL rejected by policy", {
        provider,
        code: error.code,
        status: error.status,
      });
      throw new SafeServerError(error.message);
    }
    log("warn", "Provider URL validation failed", { provider });
    throw new SafeServerError("Provider URL is invalid");
  }
});

export const getProviderSettings = createServerFn({ method: "GET" }).handler(async () =>
  withSafeHandler(async (): Promise<ProviderSettings> => {
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
        reasoningEffort: null,
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
      reasoningEffort: (row.reasoningEffort as ReasoningEffort | null) ?? null,
      requestTimeoutSec: row.requestTimeoutSec ?? null,
      apiKeyMasked,
      hasApiKey,
      inputPricePer1M: row.inputPricePer1M,
      outputPricePer1M: row.outputPricePer1M,
    };
  }),
);

export const saveProviderSettingsForUser = createServerOnlyFn(
  async function saveProviderSettingsForUser(
    userId: string,
    data: SaveProviderSettingsInput,
  ): Promise<{ success: true }> {
    await assertProviderSettingsUrl(data.baseUrl, data.provider);

    const [existing] = await db
      .select()
      .from(providerSettings)
      .where(eq(providerSettings.userId, userId))
      .limit(1);

    const suppliedApiKey = data.apiKey?.trim();
    const newApiKeyEnc = suppliedApiKey ? encrypt(suppliedApiKey) : undefined;

    const insertApiKeyEnc = newApiKeyEnc ?? existing?.apiKeyEnc;
    if (!insertApiKeyEnc) {
      throw new SafeServerError("API key is required for initial configuration");
    }

    const updatedAt = new Date();
    const conflictUpdates = {
      provider: data.provider,
      baseUrl: data.baseUrl,
      model: data.model,
      fastModel: data.fastModel ?? null,
      temperature: data.temperature,
      reasoningEffort: data.reasoningEffort ?? null,
      requestTimeoutSec: data.requestTimeoutSec ?? null,
      inputPricePer1M: data.inputPricePer1M ?? null,
      outputPricePer1M: data.outputPricePer1M ?? null,
      updatedAt,
    };

    await db
      .insert(providerSettings)
      .values({
        userId,
        ...conflictUpdates,
        apiKeyEnc: insertApiKeyEnc,
      })
      .onConflictDoUpdate({
        target: providerSettings.userId,
        set: newApiKeyEnc ? { ...conflictUpdates, apiKeyEnc: newApiKeyEnc } : conflictUpdates,
      });

    return { success: true };
  },
);

export const saveProviderSettings = createServerFn({ method: "POST" })
  .validator(saveProviderSettingsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return saveProviderSettingsForUser(session.user.id, data);
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
        await assertProviderSettingsUrl(data.baseUrl, data.provider);

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
                reasoningEffort: data.reasoningEffort,
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
      } catch (error: unknown) {
        const failure =
          error instanceof SafeServerError
            ? { code: "INVALID_URL", message: error.message }
            : await providerConnectionFailure(error);
        const fields = readTrustedErrorFields(error);
        log("warn", "Provider connection test failed", {
          provider: data.provider,
          code: failure.code,
          status: fields.status,
          errorCode: fields.code,
          errorName: error instanceof Error ? error.constructor.name : typeof error,
        });
        return {
          success: false as const,
          error: failure.message,
        };
      }
    }),
  );

export const changePassword = createServerFn({ method: "POST" })
  .validator(changePasswordSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const headers = getRequestHeaders();

      try {
        await auth.api.changePassword({
          headers,
          body: {
            currentPassword: data.currentPassword,
            newPassword: data.newPassword,
            revokeOtherSessions: true,
          },
        });
        return { success: true };
      } catch (error: unknown) {
        const fields = readTrustedErrorFields(error);
        // Better Auth reports a wrong current password with the documented INVALID_PASSWORD code.
        if (passwordChangeFailureMessage(error) === PASSWORD_INCORRECT_MESSAGE) {
          log("warn", "Password change rejected", {
            userId: session.user.id,
            code: fields.bodyCode,
            status: fields.status,
          });
        } else {
          log("error", "Password change failed", {
            userId: session.user.id,
            code: fields.code ?? fields.bodyCode,
            status: fields.status,
            errorName: error instanceof Error ? error.constructor.name : typeof error,
          });
        }
        throw new SafeServerError(passwordChangeFailureMessage(error));
      }
    }),
  );
