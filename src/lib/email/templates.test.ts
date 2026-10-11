import { describe, expect, it } from "vitest";

import {
  changeEmailEmail,
  deleteAccountEmail,
  existingUserSignUpEmail,
  resetPasswordEmail,
  verificationEmail,
} from "./templates";

const RESET_URL = "https://pnt.example.test/api/auth/reset-password/token-123?callbackURL=/login";

describe("verificationEmail", () => {
  it("carries the confirmation link through both bodies", () => {
    const message = verificationEmail({
      name: "Ada",
      url: "https://pnt.example.test/verify?token=abc",
      expiresInMinutes: 60,
    });

    expect(message.subject).toBe("Confirm your email address");
    expect(message.html).toContain('href="https://pnt.example.test/verify?token=abc"');
    expect(message.html).toContain("Confirm email");
    expect(message.text).toContain("Confirm email: https://pnt.example.test/verify?token=abc");
    expect(message.html).toContain("expires in 60 minutes");
    expect(message.text).toContain("expires in 60 minutes");
  });

  it("greets an account with no name without leaving a placeholder behind", () => {
    const message = verificationEmail({ name: "   ", url: RESET_URL, expiresInMinutes: 60 });

    expect(message.html).toContain("Hi,");
    expect(message.html).not.toContain("undefined");
    expect(message.text.startsWith("Hi,")).toBe(true);
  });
});

describe("resetPasswordEmail", () => {
  it("promises the single use the token store actually enforces", () => {
    const message = resetPasswordEmail({ name: "Ada", url: RESET_URL, expiresInMinutes: 60 });

    expect(message.subject).toBe("Reset your password");
    expect(message.text).toContain(`Choose a new password: ${RESET_URL}`);
    expect(message.html).toContain("Choose a new password");
    expect(message.text).toContain("can only be used once");
  });
});

describe("changeEmailEmail", () => {
  it("names the new address so the current owner can refuse it", () => {
    const message = changeEmailEmail({
      name: null,
      newEmail: "new@example.test",
      url: "https://pnt.example.test/change-email?token=abc",
    });

    expect(message.subject).toBe("Confirm your new email address");
    expect(message.text).toContain("new@example.test");
    expect(message.html).toContain("new@example.test");
  });
});

describe("deleteAccountEmail", () => {
  it("spells out that the deletion is permanent", () => {
    const message = deleteAccountEmail({
      name: "Ada",
      url: "https://pnt.example.test/delete-account?token=abc",
    });

    expect(message.text).toContain("This cannot be undone");
    expect(message.html).toContain("Delete my account");
  });
});

describe("existingUserSignUpEmail", () => {
  it("sends a duplicate sign-up to sign in instead", () => {
    const message = existingUserSignUpEmail({
      name: "Ada",
      url: "https://pnt.example.test/login",
    });

    expect(message.subject).toBe("You already have a Pnt account");
    expect(message.text).toContain("Sign in to Pnt: https://pnt.example.test/login");
    expect(message.text).toContain("No changes were made to your account");
  });
});

describe("escaping", () => {
  it("never lets a name or an address inject markup into the html body", () => {
    const message = changeEmailEmail({
      name: '<script>alert("x")</script>',
      newEmail: "reader+<b>bold</b>@example.test",
      url: 'https://pnt.example.test/change?token=a&next="><img src=x>',
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain("<b>bold</b>");
    expect(message.html).not.toContain("<img src=x>");
    expect(message.html).toContain("&lt;script&gt;");
    // The link stays usable: escaping the ampersand is how a URL survives in HTML.
    expect(message.html).toContain("token=a&amp;next=");
    expect(message.text).toContain('next="><img src=x>');
  });
});
