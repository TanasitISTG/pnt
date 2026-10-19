import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";

import { messages } from "@/lib/i18n/messages";
import { translateServerError } from "@/lib/i18n/server-error";
import { authErrorMessage, BANNED_USER } from "./error-codes";

describe("authErrorMessage", () => {
  it("turns a rejected credential into the catalog's sign-in message", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" }, "auth.requestFailed")).toBe(
      "auth.signInFailed",
    );
  });

  it("keeps a suspension distinct from a wrong password", () => {
    expect(authErrorMessage({ code: BANNED_USER }, "auth.signInFailed")).toBe(
      "auth.accountSuspended",
    );
  });

  it("maps an existing account and a spent link to their own copy", () => {
    expect(authErrorMessage({ code: "USER_ALREADY_EXISTS" }, "auth.createAccountFailed")).toBe(
      "auth.emailExists",
    );
    expect(authErrorMessage({ code: "TOKEN_EXPIRED" }, "auth.linkInvalid")).toBe(
      "auth.linkInvalid",
    );
  });

  it("calls a rate-limited request what it is", () => {
    expect(authErrorMessage({ status: 429 }, "auth.signInFailed")).toBe("auth.rateLimited");
  });

  it("resolves a suspension in the reader's language", () => {
    const thai = createTranslator({ locale: "th", messages: messages.th });

    expect(
      translateServerError(
        new Error(authErrorMessage({ code: BANNED_USER }, "auth.signInFailed")),
        thai,
      ),
    ).toBe(messages.th.auth.accountSuspended);
  });

  it("uses the page's own sentence for a code it does not know", () => {
    expect(
      authErrorMessage({ code: "SOMETHING_NEW", status: 500 }, "auth.providerFailed", {
        provider: "Google",
      }),
    ).toBe('auth.providerFailed|{"provider":"Google"}');
  });
});
