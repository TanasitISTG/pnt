/**
 * Pure, dependency-free email bodies.
 *
 * Kept free of `env`, database, and network access so the copy and the links can be
 * asserted in unit tests without a mail credential or a running server.
 */

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
}

const BRAND = "Pnt";
const INK = "#1c1917";
const MUTED = "#78716c";
const SURFACE = "#faf9f7";
const BORDER = "#e7e5e4";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Greeting fallback: accounts created through OAuth may not carry a name yet. */
function greeting(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? `Hi ${trimmed},` : "Hi,";
}

interface LayoutInput {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

/**
 * Table-based, inline-styled HTML. Mail clients strip stylesheets, and a plain
 * document keeps the mail small and out of spam heuristics.
 */
function layout({ heading, paragraphs, action, footnote }: LayoutInput): string {
  const body = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK}">${escapeHtml(paragraph)}</p>`,
    )
    .join("");

  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:${INK};color:#ffffff;font-size:15px;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${MUTED}">If the button does not work, copy this link into your browser:<br /><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : "";

  const trailing = footnote
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${BORDER};font-size:13px;line-height:1.6;color:${MUTED}">${escapeHtml(footnote)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto">
      <tr>
        <td style="padding:0 0 20px;font-size:17px;font-weight:600;color:${INK}">${BRAND}</td>
      </tr>
      <tr>
        <td style="padding:24px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px">
          <h1 style="margin:0 0 16px;font-size:19px;font-weight:600;color:${INK}">${escapeHtml(heading)}</h1>
          ${body}
          ${button}
          ${trailing}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function textBody(lines: string[], action?: { label: string; url: string }): string {
  const parts = [...lines];
  if (action) parts.push(`${action.label}: ${action.url}`);
  parts.push("Pnt, Personal Novel Translator");
  return parts.join("\n\n");
}

export function verificationEmail(input: {
  name: string | null;
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  const paragraphs = [
    greeting(input.name),
    "Confirm this email address to finish setting up your Pnt account.",
  ];
  const footnote = `This link expires in ${input.expiresInMinutes} minutes. If you did not create an account, you can ignore this email.`;
  return {
    subject: "Confirm your email address",
    html: layout({
      heading: "Confirm your email address",
      paragraphs,
      action: { label: "Confirm email", url: input.url },
      footnote,
    }),
    text: textBody(paragraphs, { label: "Confirm email", url: input.url }) + `\n\n${footnote}`,
  };
}

export function resetPasswordEmail(input: {
  name: string | null;
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  const paragraphs = [
    greeting(input.name),
    "We received a request to reset the password for your Pnt account.",
  ];
  const footnote = `This link expires in ${input.expiresInMinutes} minutes and can only be used once. If you did not request a reset, no action is needed. Your password is unchanged.`;
  return {
    subject: "Reset your password",
    html: layout({
      heading: "Reset your password",
      paragraphs,
      action: { label: "Choose a new password", url: input.url },
      footnote,
    }),
    text:
      textBody(paragraphs, { label: "Choose a new password", url: input.url }) + `\n\n${footnote}`,
  };
}

export function changeEmailEmail(input: {
  name: string | null;
  newEmail: string;
  url: string;
}): EmailMessage {
  const paragraphs = [
    greeting(input.name),
    `Confirm that you want to change the email address on your Pnt account to ${input.newEmail}.`,
  ];
  const footnote =
    "The change takes effect once you confirm. If you did not request it, ignore this email and your address stays the same.";
  return {
    subject: "Confirm your new email address",
    html: layout({
      heading: "Confirm your new email address",
      paragraphs,
      action: { label: "Confirm new email", url: input.url },
      footnote,
    }),
    text: textBody(paragraphs, { label: "Confirm new email", url: input.url }) + `\n\n${footnote}`,
  };
}

export function deleteAccountEmail(input: { name: string | null; url: string }): EmailMessage {
  const paragraphs = [
    greeting(input.name),
    "We received a request to permanently delete your Pnt account.",
  ];
  const footnote =
    "Confirming removes your novels, chapters, translations, reader progress, and uploaded files. This cannot be undone. If you did not request it, ignore this email and your account stays as it is.";
  return {
    subject: "Confirm account deletion",
    html: layout({
      heading: "Confirm account deletion",
      paragraphs,
      action: { label: "Delete my account", url: input.url },
      footnote,
    }),
    text: textBody(paragraphs, { label: "Delete my account", url: input.url }) + `\n\n${footnote}`,
  };
}

/** Existing-user notice when someone tries to sign up with an address already in use. */
export function existingUserSignUpEmail(input: { name: string | null; url: string }): EmailMessage {
  const paragraphs = [
    greeting(input.name),
    "Someone tried to create a Pnt account with this email address, but one already exists.",
  ];
  const footnote =
    "If that was you, sign in instead, or reset your password if you no longer remember it. No changes were made to your account.";
  return {
    subject: "You already have a Pnt account",
    html: layout({
      heading: "You already have an account",
      paragraphs,
      action: { label: "Sign in to Pnt", url: input.url },
      footnote,
    }),
    text: textBody(paragraphs, { label: "Sign in to Pnt", url: input.url }) + `\n\n${footnote}`,
  };
}
