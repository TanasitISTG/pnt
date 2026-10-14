import { defaultLocale, type Locale } from "./locales";

/**
 * Every locale-sensitive format in the app.
 *
 * The locale is a parameter rather than something read from the environment, because the
 * same value has to reach a server render, a client render, an email body and a script, and
 * only one of those has a reader's cookie to consult. Forgetting to pass it is a type error.
 *
 * The pipe that a timestamp and a number pass through is `Intl`, so Thai gets Thai month
 * names, Thai digits stay Western, and nothing here has to be translated by hand.
 */

/**
 * The app's timezone.
 *
 * A timestamp the server renders and the client hydrates has to be the same string on both
 * sides, and local time would make that depend on where each machine happens to be. The
 * data, the audience and the operator all sit in one zone, so the zone is part of the
 * format rather than the machine's own setting.
 */
export const APP_TIME_ZONE = "Asia/Bangkok";

/**
 * Thai locale data defaults to the Buddhist calendar, which would print 2569 for 2026 and
 * disagree with every date the database stores and every date a reader sees elsewhere. The
 * Gregorian calendar is pinned explicitly, in the tag rather than in the options, so no call
 * site can forget it.
 */
const INTL_LOCALES: Record<Locale, string> = {
  th: "th-TH-u-ca-gregory",
  en: "en-US",
};

export function intlLocale(locale: Locale): string {
  return INTL_LOCALES[locale];
}

/** The month, day and time, which is the default shape for a record's own timestamp. */
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

export function parseDateTime(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The placeholder for a timestamp that is missing or unreadable, which is never a blank cell. */
const EMPTY = "-";

export function formatDateTime(value: Date | string, locale: Locale): string {
  const date = parseDateTime(value);
  if (!date) return EMPTY;
  return date.toLocaleString(intlLocale(locale), { timeZone: APP_TIME_ZONE, ...DATE_TIME_OPTIONS });
}

/** The clock time to the second, for a job's log lines. */
export function formatTime(value: Date | string, locale: Locale): string {
  const date = parseDateTime(value);
  if (!date) return EMPTY;
  return date.toLocaleTimeString(intlLocale(locale), { timeZone: APP_TIME_ZONE, ...TIME_OPTIONS });
}

/** The exact moment, for the `title` attribute a relative label stands in for. */
export function formatAbsoluteTime(value: Date | string, locale: Locale): string {
  return formatDateTime(value, locale);
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return value.toLocaleString(intlLocale(locale), options);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(locale: Locale, numeric: "always" | "auto"): Intl.RelativeTimeFormat {
  const key = `${locale}:${numeric}`;
  let formatter = relativeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric, style: "narrow" });
    relativeFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * A short label for when something was written: "now", "5m ago", "3d ago", and a real date
 * once that stops being useful.
 *
 * A count is formatted by `Intl.RelativeTimeFormat` rather than by a template with a plural
 * in it, because Thai has no plural forms to select: the unit is "the number and its unit",
 * and each language words that its own way. The single exception is the sub-minute case,
 * where `numeric: "auto"` is what turns a count of zero into "now" / "ขณะนี้".
 */
export function formatRelativeTime(
  value: Date | string,
  locale: Locale,
  now: Date = new Date(),
): string {
  const date = parseDateTime(value);
  if (!date) return "";
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";

  if (seconds < 45) return relativeFormatter(locale, "auto").format(0, "second");

  const format = (amount: number, unit: Intl.RelativeTimeFormatUnit) =>
    relativeFormatter(locale, "always").format(-amount, unit);

  if (seconds < HOUR) return format(Math.max(1, Math.round(seconds / MINUTE)), "minute");
  if (seconds < DAY) return format(Math.round(seconds / HOUR), "hour");
  if (seconds < MONTH) return format(Math.round(seconds / DAY), "day");
  if (seconds < YEAR) return format(Math.round(seconds / MONTH), "month");
  return date.toLocaleDateString(intlLocale(locale), { timeZone: APP_TIME_ZONE });
}

const collators = new Map<string, Intl.Collator>();

/**
 * The comparison a list of titles is sorted with.
 *
 * `new Intl.Collator("en")` orders Thai titles by code point, which puts them in an order no
 * Thai reader recognizes. The locale decides, and the instance is cached because a sort
 * compares hundreds of pairs.
 */
export function collatorFor(locale: Locale): Intl.Collator {
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(intlLocale(locale), { numeric: true, sensitivity: "base" });
    collators.set(locale, collator);
  }
  return collator;
}

/** The locale a non-React script (a seed, a check) formats with when it has no reader. */
export function systemLocale(): Locale {
  return defaultLocale;
}
