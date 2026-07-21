/**
 * 展示时区的校验、格式化与本地日期时间解析工具。
 *
 * 使用方包括用户设置、管理端日期筛选、用户统计范围解析和所有需要按展示时区处理
 * 时间的组件。数据库与外部 API 始终使用 UTC，本模块只负责展示与本地输入解释。
 * 本模块只依赖 Intl；解析时通过本地字段 round-trip 拒绝非法日期与 DST 不存在时刻，
 * 对 DST 重复时刻确定性选择较早的 UTC 瞬间。
 */
import { z } from "zod";

export const DEFAULT_APP_TIME_ZONE = "UTC";

export const USER_TIME_ZONE_OPTIONS = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

/**
 * 判断字符串是否为当前运行时支持的 IANA 时区。
 *
 * @param value 待验证的时区名称。
 * @returns 非空且可被 Intl.DateTimeFormat 识别时返回 true；无副作用。
 */
export function isValidTimeZone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * 规范化来自数据库等非可信来源的可空用户时区偏好。
 *
 * @param value 待规范化的用户时区值。
 * @returns 合法 IANA 时区返回去空格后的值；缺失或非法时返回 null；无副作用。
 */
export function normalizeUserTimeZonePreference(
  value?: string | null
): string | null {
  const trimmed = value?.trim();
  return trimmed && isValidTimeZone(trimmed) ? trimmed : null;
}

/** 用户时区偏好输入；null 明确表示继承部署环境 APP_TIME_ZONE。 */
export const userTimeZoneSchema = z
  .string()
  .trim()
  .min(1, "时区不能为空")
  .max(100, "时区名称过长")
  .refine(isValidTimeZone, "无效的 IANA 时区")
  .nullable();

/**
 * 按“用户偏好优先、部署时区兜底、最终 UTC”解析有效展示时区。
 *
 * @param userTimeZone 用户保存的可空 IANA 时区。
 * @param appTimeZone 部署环境 APP_TIME_ZONE。
 * @returns 可安全传给 Intl 的展示时区；无副作用。
 */
export function resolveDisplayTimeZone(
  userTimeZone?: string | null,
  appTimeZone?: string | null
): string {
  const fallback = normalizeTimeZone(appTimeZone, DEFAULT_APP_TIME_ZONE);
  return normalizeTimeZone(userTimeZone, fallback);
}

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

/**
 * 取得具体 UTC 瞬间在指定 IANA 时区中的偏移毫秒数。
 *
 * @param date 已确定的 UTC 瞬间。
 * @param timeZone 已规范化的 IANA 时区。
 * @returns 本地墙上时间减去 UTC 的毫秒数；无外部副作用。
 */
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

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

/**
 * 将一个 UTC 瞬间格式化为指定时区的可比较数字字段。
 *
 * @param date 已确定的 UTC 瞬间。
 * @param timeZone 已规范化的 IANA 时区。
 * @returns 本地日期时间字段；无外部副作用。
 */
function getLocalDateTimeParts(
  date: Date,
  timeZone: string
): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    year: Number(getPart(parts, "year")),
    month: Number(getPart(parts, "month")),
    day: Number(getPart(parts, "day")),
    hour: Number(getPart(parts, "hour")),
    minute: Number(getPart(parts, "minute")),
    second: Number(getPart(parts, "second")),
    millisecond: date.getUTCMilliseconds(),
  };
}

/**
 * 判断本地日期时间字段本身是否构成真实的 Gregorian 日历时刻。
 *
 * @param parts 待验证的本地字段。
 * @returns 字段是否可被 Date 无归一化地表达；无外部副作用。
 */
function isValidLocalDateTime(parts: LocalDateTimeParts): boolean {
  const date = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond
    )
  );
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hour &&
    date.getUTCMinutes() === parts.minute &&
    date.getUTCSeconds() === parts.second &&
    date.getUTCMilliseconds() === parts.millisecond
  );
}

/**
 * 比较两个本地日期时间字段，避免 DST 候选只靠偏移近似判断。
 *
 * @param left 第一组字段。
 * @param right 第二组字段。
 * @returns 所有字段是否完全一致；无外部副作用。
 */
function localDateTimePartsEqual(
  left: LocalDateTimeParts,
  right: LocalDateTimeParts
): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second &&
    left.millisecond === right.millisecond
  );
}

/**
 * 将本地墙上时刻解析为 UTC，并对 DST 间隙与重复时刻做确定性处理。
 *
 * 候选偏移从目标日期前后 48 小时采样，覆盖常规 DST 与日期线切换；每个候选都必须
 * round-trip 回原字段。不存在时刻没有候选而返回 null，重复时刻按 UTC 排序取较早者。
 *
 * @param timeZone 已规范化的 IANA 时区。
 * @param parts 已验证的本地日期时间字段。
 * @returns 对应的较早 UTC 瞬间；不存在或非法时返回 null；无外部副作用。
 */
function zonedTimeToUtc(
  timeZone: string,
  parts: LocalDateTimeParts
): Date | null {
  if (!isValidLocalDateTime(parts)) return null;
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
  const offsets = new Set<number>();
  const sampleStepMs = 6 * 60 * 60 * 1000;
  const sampleRadiusMs = 48 * 60 * 60 * 1000;
  for (
    let delta = -sampleRadiusMs;
    delta <= sampleRadiusMs;
    delta += sampleStepMs
  ) {
    const sample = new Date(localAsUtc + delta);
    offsets.add(getTimeZoneOffsetMs(sample, timeZone));
  }
  const candidates = Array.from(offsets)
    .map((offset) => new Date(localAsUtc - offset))
    .filter((candidate) =>
      localDateTimePartsEqual(getLocalDateTimeParts(candidate, timeZone), parts)
    )
    .sort((left, right) => left.getTime() - right.getTime());
  return candidates[0] ?? null;
}

/**
 * 解析原生 datetime-local 产生的本地日期时间。
 *
 * @param value `YYYY-MM-DDTHH:mm`，可选秒与最多三位毫秒，不接受 UTC offset。
 * @param options timeZone 是解释墙上时刻的应用时区。
 * @returns UTC Date；格式非法、日历非法或处于 DST 不存在区间时返回 null。重复时刻取
 * 较早 offset，不读取系统设置且无外部副作用。
 */
export function parseDateTimeInputInTimeZone(
  value: string | undefined,
  options?: { timeZone?: string | null | undefined }
): Date | null {
  const match = value?.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
  );
  if (!match) return null;
  const millisecond = Number((match[7] ?? "").padEnd(3, "0") || "0");
  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
    millisecond,
  };
  return zonedTimeToUtc(normalizeTimeZone(options?.timeZone), parts);
}

/**
 * 返回具体 UTC 瞬间在指定时区中的 offset 分钟数。
 *
 * @param date 已确定的 UTC 瞬间。
 * @param timeZone IANA 时区；非法值按既有 normalizeTimeZone 规则回退 UTC。
 * @returns 本地时间减 UTC 的分钟数；无外部副作用。
 */
export function getTimeZoneOffsetMinutes(
  date: Date,
  timeZone?: string | null
): number {
  return getTimeZoneOffsetMs(date, normalizeTimeZone(timeZone)) / (60 * 1000);
}

/**
 * 解析原生 date 输入在应用时区中的日边界。
 *
 * @param value `YYYY-MM-DD` 日期。
 * @param options endOfDay 保留既有 inclusive 末毫秒语义；新统计应使用下一日零点构造
 * 半开区间。timeZone 是解释日期的应用时区。
 * @returns UTC Date；格式、日历或时区映射非法时返回 null；无外部副作用。
 */
export function parseDateInputInTimeZone(
  value: string | undefined,
  options?: { endOfDay?: boolean; timeZone?: string | null }
) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const suffix = options?.endOfDay ? "T23:59:59.999" : "T00:00";
  return parseDateTimeInputInTimeZone(`${value}${suffix}`, {
    timeZone: options?.timeZone,
  });
}
