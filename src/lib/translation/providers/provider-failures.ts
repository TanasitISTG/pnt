import { encodeMessage } from "@/lib/i18n/message-code";

/**
 * What a provider call can fail with, as codes rather than sentences.
 *
 * A provider failure is read in more than one place — the settings test's banner and a job's log
 * row — and read long after it happened, by a reader whose language the worker never knew. So the
 * failure travels as a key and the catalog says the words: the same 429 reads in Thai for one
 * reader and in English for the next, and the sentence can be reworded without rewriting rows
 * already stored.
 *
 * The classification is deliberately not the provider's own words. An upstream body can carry the
 * API key, an internal URL, or a page of HTML, so every message here is fixed, chosen from trusted
 * structure alone (a status code, an error class, a code the transport policy set itself).
 *
 * Every code the transport or the client can raise is listed, because a code with no entry is a
 * sentence a reader sees in English: the transport policy's guards are exactly what an operator
 * needs to read when their URL is refused.
 */
export const providerFailureCodes = {
  AUTH_FAILED: encodeMessage("errors.providerAuthFailed"),
  ACCESS_DENIED: encodeMessage("errors.providerAccessDenied"),
  NOT_FOUND: encodeMessage("errors.providerNotFound"),
  RATE_LIMITED: encodeMessage("errors.providerRateLimited"),
  TIMEOUT: encodeMessage("errors.providerRequestTimeout"),
  CONNECTION_FAILED: encodeMessage("errors.providerConnectionFailed"),
  JSON_MODE_UNSUPPORTED: encodeMessage("errors.providerJsonModeUnsupported"),
  INVALID_RESPONSE: encodeMessage("errors.providerInvalidResponse"),
  INVALID_MODEL: encodeMessage("errors.providerModelInvalid"),
  INVALID_URL: encodeMessage("errors.providerUrlInvalid"),
  ORIGIN_MISMATCH: encodeMessage("errors.providerOriginNotAllowed"),
  HTTPS_REQUIRED: encodeMessage("errors.providerHttpsRequired"),
  INVALID_TRANSPORT: encodeMessage("errors.providerTransportNotAllowed"),
  DNS_FAILED: encodeMessage("errors.providerHostUnresolved"),
  DNS_TIMEOUT: encodeMessage("errors.providerHostTimeout"),
  NON_PUBLIC: encodeMessage("errors.providerHostNotPublic"),
  PEER_MISMATCH: encodeMessage("errors.providerPeerNotAllowed"),
  REDIRECT_NOT_ALLOWED: encodeMessage("errors.providerRedirectNotAllowed"),
  RESPONSE_TOO_LARGE: encodeMessage("errors.providerResponseTooLarge"),
  NOT_CONFIGURED: encodeMessage("errors.providerNotConfigured"),
  SNAPSHOT_MISMATCH: encodeMessage("errors.providerSnapshotMismatch"),
} as const;

export type ProviderFailureCode = keyof typeof providerFailureCodes;

/**
 * The message for a code that crossed a module boundary as data.
 *
 * `ProviderRequestError.code` is a string at runtime, so a call site that already holds a failure
 * from somewhere else — the settings form catching whatever the SDK threw — can look the sentence
 * up rather than repeating it. An unknown code has no entry: the caller decides whether to show
 * the generic connection failure or the code itself.
 */
export function providerFailureMessage(code: string): string | null {
  return code in providerFailureCodes ? providerFailureCodes[code as ProviderFailureCode] : null;
}
