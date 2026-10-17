/**
 * Pure, dependency-free email bodies.
 *
 * Kept free of `env`, database, and network access so the copy and the links can be
 * asserted in unit tests without a mail credential or a running server.
 *
 * The language is an argument, never ambient. A request runs concurrently with others, so
 * there is no safe place to remember one; `send.server.ts` resolves it from the account and
 * the request and hands it in, and everything below renders the catalog it names.
 */

import { createTranslator } from "use-intl/core";

import { messages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locales";

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

function emailTranslator(locale: Locale) {
  return createTranslator({ locale, messages: messages[locale] });
}

type EmailTranslator = ReturnType<typeof emailTranslator>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Greeting fallback: accounts created through OAuth may not carry a name yet. */
function greeting(t: EmailTranslator, name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? t("email.greetingNamed", { name: trimmed }) : t("email.greeting");
}

interface LayoutInput {
  locale: Locale;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
  linkFallback: string;
}

/**
 * Table-based, inline-styled HTML. Mail clients strip stylesheets, and a plain
 * document keeps the mail small and out of spam heuristics.
 *
 * `lang` follows the language the body is written in, which is the one gesture a mail
 * client can act on: it is what a screen reader reads the message as.
 */
function layout({ locale, heading, paragraphs, action, footnote, linkFallback }: LayoutInput) {
  const body = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK}">${escapeHtml(paragraph)}</p>`,
    )
    .join("");

  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:${INK};color:#ffffff;font-size:15px;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${MUTED}">${escapeHtml(linkFallback)}<br /><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : "";

  const trailing = footnote
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${BORDER};font-size:13px;line-height:1.6;color:${MUTED}">${escapeHtml(footnote)}</p>`
    : "";

  return `<!doctype html>
<html lang="${locale}">
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

function textBody(
  lines: string[],
  footer: string,
  action?: { label: string; url: string },
): string {
  const parts = [...lines];
  if (action) parts.push(`${action.label}: ${action.url}`);
  parts.push(footer);
  return parts.join("\n\n");
}

interface ComposeInput {
  t: EmailTranslator;
  locale: Locale;
  subject: string;
  /** Defaults to the subject: only the duplicate-sign-up notice says it differently. */
  heading?: string;
  paragraphs: string[];
  footnote: string;
  action: { label: string; url: string };
}

/**
 * One message in both bodies. The heading, the paragraphs, the action and the footnote are
 * the same sentences in each, so they are written once and rendered twice.
 */
function compose({ t, locale, subject, heading, paragraphs, footnote, action }: ComposeInput) {
  return {
    subject,
    html: layout({
      locale,
      heading: heading ?? subject,
      paragraphs,
      action,
      footnote,
      linkFallback: t("email.linkFallback"),
    }),
    text: textBody(paragraphs, t("email.footer"), action) + `\n\n${footnote}`,
  };
}

export function verificationEmail(input: {
  locale: Locale;
  name: string | null;
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  const t = emailTranslator(input.locale);
  return compose({
    t,
    locale: input.locale,
    subject: t("email.verificationSubject"),
    paragraphs: [greeting(t, input.name), t("email.verificationBody")],
    footnote: t("email.verificationExpiry", { minutes: input.expiresInMinutes }),
    action: { label: t("email.verificationAction"), url: input.url },
  });
}

export function resetPasswordEmail(input: {
  locale: Locale;
  name: string | null;
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  const t = emailTranslator(input.locale);
  return compose({
    t,
    locale: input.locale,
    subject: t("email.resetSubject"),
    paragraphs: [greeting(t, input.name), t("email.resetBody")],
    footnote: t("email.resetExpiry", { minutes: input.expiresInMinutes }),
    action: { label: t("email.resetAction"), url: input.url },
  });
}

export function changeEmailEmail(input: {
  locale: Locale;
  name: string | null;
  newEmail: string;
  url: string;
}): EmailMessage {
  const t = emailTranslator(input.locale);
  return compose({
    t,
    locale: input.locale,
    subject: t("email.changeSubject"),
    paragraphs: [greeting(t, input.name), t("email.changeBody", { email: input.newEmail })],
    footnote: t("email.changeFootnote"),
    action: { label: t("email.changeAction"), url: input.url },
  });
}

export function deleteAccountEmail(input: {
  locale: Locale;
  name: string | null;
  url: string;
}): EmailMessage {
  const t = emailTranslator(input.locale);
  return compose({
    t,
    locale: input.locale,
    subject: t("email.deleteSubject"),
    paragraphs: [greeting(t, input.name), t("email.deleteBody")],
    footnote: t("email.deleteFootnote"),
    action: { label: t("email.deleteAction"), url: input.url },
  });
}

/** Existing-user notice when someone tries to sign up with an address already in use. */
export function existingUserSignUpEmail(input: {
  locale: Locale;
  name: string | null;
  url: string;
}): EmailMessage {
  const t = emailTranslator(input.locale);
  return compose({
    t,
    locale: input.locale,
    subject: t("email.existingSubject"),
    heading: t("email.existingHeading"),
    paragraphs: [greeting(t, input.name), t("email.existingBody")],
    footnote: t("email.existingFootnote"),
    action: { label: t("email.existingAction"), url: input.url },
  });
}
