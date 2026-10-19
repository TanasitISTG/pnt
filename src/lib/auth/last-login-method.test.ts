import { describe, expect, it } from "vitest";

import {
  LAST_LOGIN_METHOD_COOKIE,
  LAST_LOGIN_METHOD_MAX_AGE_SECONDS,
  parseLastLoginMethod,
} from "./last-login-method";

/**
 * The hint is only as trustworthy as its reading: a cookie header carries every cookie the
 * browser has for the site, and a parser that is loose about the name or the value would mark
 * the wrong method - or let a stray pair decide what the sign-in page says.
 */
describe("parseLastLoginMethod", () => {
  it("reads the method out of a header that carries several cookies", () => {
    const header = `pnt-consent-v1=granted; ${LAST_LOGIN_METHOD_COOKIE}=google; theme=dark`;

    expect(parseLastLoginMethod(header)).toBe("google");
  });

  it("tolerates the whitespace a header may carry", () => {
    expect(parseLastLoginMethod(`  ${LAST_LOGIN_METHOD_COOKIE} = email  `)).toBe("email");
  });

  it("does not match a cookie whose name merely starts the same way", () => {
    expect(parseLastLoginMethod(`better-auth.last_used_login_method_extra=google`)).toBeNull();
  });

  it("treats an unknown method as no hint at all", () => {
    // A method this deployment does not offer, or one added by a later release, names no
    // control on the page; an empty marker would be worse than none.
    expect(parseLastLoginMethod(`${LAST_LOGIN_METHOD_COOKIE}=passkey`)).toBeNull();
  });

  it("decodes an encoded value, and refuses a malformed one", () => {
    expect(parseLastLoginMethod(`${LAST_LOGIN_METHOD_COOKIE}=%65mail`)).toBe("email");
    expect(parseLastLoginMethod(`${LAST_LOGIN_METHOD_COOKIE}=%E0%A4%A`)).toBeNull();
  });

  it("returns null when the cookie is empty or absent", () => {
    expect(parseLastLoginMethod(`${LAST_LOGIN_METHOD_COOKIE}=`)).toBeNull();
    expect(parseLastLoginMethod("theme=dark")).toBeNull();
    expect(parseLastLoginMethod("")).toBeNull();
    expect(parseLastLoginMethod(null)).toBeNull();
    expect(parseLastLoginMethod(undefined)).toBeNull();
  });

  it("lets the first pair with the name decide, rather than a later duplicate", () => {
    expect(
      parseLastLoginMethod(
        `${LAST_LOGIN_METHOD_COOKIE}=discord; ${LAST_LOGIN_METHOD_COOKIE}=email`,
      ),
    ).toBe("discord");
  });

  it("keeps the stated lifetime a month, which is what the cookie policy says", () => {
    expect(LAST_LOGIN_METHOD_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30);
  });
});
