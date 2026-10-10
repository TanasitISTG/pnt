const LOCAL_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

const LOCAL_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

export function parseDateTime(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalTime(value: Date | string): string {
  const date = parseDateTime(value);
  return date ? date.toLocaleTimeString(undefined, LOCAL_TIME_OPTIONS) : "—";
}

export function formatLocalDateTime(
  value: Date | string,
  options: Intl.DateTimeFormatOptions = LOCAL_DATE_TIME_OPTIONS,
): string {
  const date = parseDateTime(value);
  return date ? date.toLocaleString(undefined, options) : "—";
}
