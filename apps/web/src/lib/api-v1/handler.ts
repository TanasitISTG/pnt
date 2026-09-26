import "@tanstack/react-start/server-only";

import type { ZodType } from "zod";
import { auth } from "@/lib/auth/auth";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import { NotFoundError, RateLimitError } from "@/lib/server-fn-error";
import { checkGuestRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { apiErrorV1Schema, type ApiErrorCodeV1 } from "@pnt/contracts/api-error";

export class InvalidRequestError extends Error {}

export function parseV1<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidRequestError();
  return result.data;
}

function searchParams(request: Request): URLSearchParams {
  try {
    return new URL(request.url).searchParams;
  } catch {
    throw new InvalidRequestError();
  }
}

export function queryPair(request: Request, name: string): string | null {
  const values = searchParams(request).getAll(name);
  if (values.length > 1) throw new InvalidRequestError();
  return values[0] ?? null;
}

export function noOtherQueries(request: Request, names: string[]) {
  for (const key of searchParams(request).keys()) {
    if (!names.includes(key)) throw new InvalidRequestError();
  }
}

export async function bodyV1<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new InvalidRequestError();
  }
  return parseV1(schema, value);
}

export function jsonV1(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function notFound(message: string): never {
  throw new NotFoundError(message);
}

type V1Context = { userId: string | null; request: Request; requireUser: () => string };

// Native requests can omit Origin, but browser forms cannot send application/json.
// Browsers that do send Origin must come from the configured backend origin.
function assertSafeMutationRequest(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let trustedOrigin: string;
    try {
      trustedOrigin = new URL(env.BETTER_AUTH_URL).origin;
    } catch {
      throw new Error("Invalid configured auth origin");
    }
    if (origin !== trustedOrigin) throw new InvalidRequestError();
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    throw new InvalidRequestError();
  }
}

export async function handleV1(
  request: Request,
  action: (context: V1Context) => Promise<Response>,
  options: { account?: boolean; guestBucket?: "read" | "covers" } = {},
): Promise<Response> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user.id ?? null;
    if (options.account && !userId) return errorV1(401, "UNAUTHORIZED", "Sign in required");
    if (options.account && request.method !== "GET" && request.method !== "HEAD") {
      assertSafeMutationRequest(request);
    }
    if (!userId && options.guestBucket) {
      await checkGuestRateLimit(
        options.guestBucket,
        options.guestBucket === "covers" ? 120 : GUEST_READ_LIMIT,
        request.headers,
      );
    }
    return await action({
      request,
      userId,
      requireUser: () => {
        if (!userId) throw new Error("Account route missing authentication");
        return userId;
      },
    });
  } catch (error) {
    if (error instanceof InvalidRequestError)
      return errorV1(400, "INVALID_REQUEST", "Invalid request");
    if (error instanceof NotFoundError) return errorV1(404, "NOT_FOUND", "Not found");
    if (error instanceof RateLimitError) return errorV1(429, "RATE_LIMITED", "Too many requests");
    log("error", "Unhandled v1 API error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorV1(500, "INTERNAL_ERROR", "Something went wrong");
  }
}

function errorV1(status: number, code: ApiErrorCodeV1, message: string) {
  return jsonV1(apiErrorV1Schema.parse({ error: { code, message } }), status);
}
