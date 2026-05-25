export const APP_TIME_ZONE_SETTING_KEY = "APP_TIME_ZONE";
export const DEFAULT_APP_TIME_ZONE = "UTC";

export const APP_TIME_ZONE_OPTIONS = [
  { label: "UTC", value: "UTC" },
  { label: "中国标准时间 (Asia/Shanghai)", value: "Asia/Shanghai" },
  { label: "香港时间 (Asia/Hong_Kong)", value: "Asia/Hong_Kong" },
  { label: "新加坡时间 (Asia/Singapore)", value: "Asia/Singapore" },
  { label: "日本时间 (Asia/Tokyo)", value: "Asia/Tokyo" },
  { label: "太平洋时间 (America/Los_Angeles)", value: "America/Los_Angeles" },
  { label: "东部时间 (America/New_York)", value: "America/New_York" },
  { label: "伦敦时间 (Europe/London)", value: "Europe/London" },
] as const;

export function normalizeTimeZone(
  value?: string | null,
  fallback = DEFAULT_APP_TIME_ZONE
) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return fallback;
  }
}

export function getDateTimeLocale(locale: string) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

export function formatDateInTimeZone(
  value: Date | string | number | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string | null
) {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(getDateTimeLocale(locale), {
    ...options,
    timeZone: normalizeTimeZone(timeZone),
  }).format(date);
}

function getPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatDateInputInTimeZone(
  date: Date,
  timeZone?: string | null
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${getPart(parts, "year")}-${getPart(parts, "month")}-${getPart(
    parts,
    "day"
  )}`;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const dateWithoutMs = new Date(date.getTime() - date.getMilliseconds());
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(dateWithoutMs);
  const asUtc = Date.UTC(
    Number(getPart(parts, "year")),
    Number(getPart(parts, "month")) - 1,
    Number(getPart(parts, "day")),
    Number(getPart(parts, "hour")),
    Number(getPart(parts, "minute")),
    Number(getPart(parts, "second"))
  );
  return asUtc - dateWithoutMs.getTime();
}

function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number
) {
  const localAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond
  );
  const firstPass = new Date(
    localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone)
  );
  return new Date(localAsUtc - getTimeZoneOffsetMs(firstPass, timeZone));
}

export function parseDateInputInTimeZone(
  value: string | undefined,
  options?: { endOfDay?: boolean; timeZone?: string | null }
) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const timeZone = normalizeTimeZone(options?.timeZone);
  const date = zonedTimeToUtc(
    timeZone,
    year,
    month,
    day,
    options?.endOfDay ? 23 : 0,
    options?.endOfDay ? 59 : 0,
    options?.endOfDay ? 59 : 0,
    options?.endOfDay ? 999 : 0
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
