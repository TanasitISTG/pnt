// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import { afterEach, describe, expect, it } from "vitest";

import { JobErrorText } from "@/components/jobs/job-error-text";
import { FieldError } from "@/components/ui/field";
import { existingUserSignUpEmail } from "@/lib/email/templates";
import {
  formatCompactDateTime,
  formatDate,
  formatDateTime,
  formatRelativeTime,
} from "@/lib/i18n/format";
import { messages } from "@/lib/i18n/messages";
import { encodeMessage } from "@/lib/i18n/message-code";
import { translateMessage, translateServerError } from "@/lib/i18n/server-error";
import { ThaiI18nProvider } from "@/test/i18n";

const th = messages.th;
const en = messages.en;
const thai = createTranslator({ locale: "th", messages: th });

afterEach(cleanup);

/**
 * Thai is the language that ships, while the rest of the unit suite runs in English because its
 * copy assertions are the behaviour contract (i18n.md §7). These cases exist so the default is
 * not the untested one: each drives the real mechanism and reads the words a Thai reader would
 * actually see, which is the one thing `bun run i18n:check` can never confirm.
 */
describe("the Thai default", () => {
  it("resolves a server message code in the reader's language", () => {
    const error = new Error(encodeMessage("errors.rateLimited"));

    expect(translateServerError(error, thai)).toBe(th.errors.rateLimited);
    expect(th.errors.rateLimited).not.toBe(en.errors.rateLimited);
  });

  it("resolves a code that carries a value", () => {
    const error = new Error(encodeMessage("errors.epubTooManyChapters", { max: 5000 }));

    expect(translateServerError(error, thai)).toBe(
      th.errors.epubTooManyChapters.replace("{max}", "5000"),
    );
  });

  it("renders a stored job failure through the Thai catalog", () => {
    // The activity band and the history table read the same stored column, which holds a code
    // rather than a sentence, so the shipped language is the one that has to resolve it.
    render(
      <ThaiI18nProvider>
        <JobErrorText message={encodeMessage("errors.providerConnectionFailed")} />
      </ThaiI18nProvider>,
    );

    expect(screen.getByText(th.errors.providerConnectionFailed)).toBeTruthy();
    expect(screen.queryByText("errors.providerConnectionFailed")).toBeNull();
  });

  it("renders a field error through the Thai catalog", () => {
    render(
      <ThaiI18nProvider>
        <FieldError errors={[{ message: encodeMessage("validation.titleRequired") }]} />
      </ThaiI18nProvider>,
    );

    const alert = screen.getByRole("alert").textContent;
    expect(alert).toBe(th.validation.titleRequired);
    expect(alert).not.toBe(en.validation.titleRequired);
  });

  it("renders an interpolated Thai field error with the value it was given", () => {
    render(
      <ThaiI18nProvider>
        <FieldError
          errors={[{ message: encodeMessage("validation.providerTemperatureMin", { min: 0 }) }]}
        />
      </ThaiI18nProvider>,
    );

    // Thai words its own sentence around the number rather than repeating the English one.
    expect(screen.getByRole("alert").textContent).toBe("อุณหภูมิต้องไม่ต่ำกว่า 0");
  });

  it("passes a message that is not a code through unchanged", () => {
    // What keeps a provider's own error working: only a resolvable code is translated.
    render(
      <ThaiI18nProvider>
        <FieldError errors={[{ message: "Invalid credentials" }]} />
      </ThaiI18nProvider>,
    );

    expect(screen.getByRole("alert").textContent).toBe("Invalid credentials");
  });

  it("writes an email in Thai and stamps the document with its language", () => {
    const message = existingUserSignUpEmail({
      locale: "th",
      name: null,
      url: "https://example.com/reset",
    });

    expect(message.subject).toBe(th.email.existingSubject);
    expect(message.html).toContain('lang="th"');
    expect(message.html).toContain(th.email.greeting);
  });

  it("formats a date in Thai with the Gregorian year, not the Buddhist one", () => {
    const formatted = formatDateTime("2026-01-15T10:00:00Z", "th");

    // `th-TH` defaults to the Buddhist calendar, which would print 2569 here and disagree with
    // every date the database stores and every date the rest of the app shows.
    expect(formatted).toContain("2026");
    expect(formatted).not.toContain("2569");
  });

  it("formats a day and a compact cell in the same Gregorian year", () => {
    // The shapes share one locale tag, so the calendar fix has to hold for the day-only column
    // the operator tables render and the numeric cell the jobs table renders - the two that used
    // to ask the browser instead, and got 2569 back on a Thai machine.
    const day = formatDate("2026-01-15T10:00:00Z", "th");
    expect(day).toContain("2026");
    expect(day).not.toContain("2569");

    // The compact shape prints a two-digit year, so it is asserted on its own, and its hour is
    // the app's zone rather than the machine's: 10:00Z is 17:00 in Bangkok.
    const compact = formatCompactDateTime("2026-01-15T10:00:00Z", "th");
    expect(compact).toContain("26");
    expect(compact).not.toContain("69");
    expect(compact).toContain("17:00");
  });

  it("relates a time in Thai with Thai wording", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    const thaiRelative = formatRelativeTime("2026-01-15T07:00:00Z", "th", now);
    const englishRelative = formatRelativeTime("2026-01-15T07:00:00Z", "en", now);

    expect(thaiRelative.length).toBeGreaterThan(0);
    expect(thaiRelative).not.toBe(englishRelative);
  });
});

/**
 * A nested message gets its own block: a wrapper names the field a file failed on and the rule
 * it failed, and the rule is itself a message. Resolving only the outer key would hand the
 * reader a raw key as the reason.
 */
describe("a message nested inside another", () => {
  it("resolves the outer sentence and the reason it carries", () => {
    const code = encodeMessage("validation.backupFieldInvalid", {
      path: "novels.0.contextTailLength",
      message: encodeMessage("validation.providerTemperatureMin", { min: 100 }),
    });

    expect(translateMessage(code, thai)).toBe(
      "ไฟล์ข้อมูลสำรองไม่ถูกต้องที่ novels.0.contextTailLength: อุณหภูมิต้องไม่ต่ำกว่า 100",
    );
  });

  it("keeps a reason the catalog does not know as the sentence it is", () => {
    // A Zod default message is English and not a key; the wrapper still resolves, and the
    // reason travels as written rather than becoming a placeholder.
    const code = encodeMessage("validation.backupFieldInvalid", {
      path: "chunkSize",
      message: "Too small: expected number to be >=500",
    });

    expect(translateMessage(code, thai)).toContain("Too small: expected number to be >=500");
    expect(translateMessage(code, thai)).toContain("chunkSize");
  });
});
