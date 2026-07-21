/**
 * 用户用量统计时间范围解析器。
 *
 * 将已校验的小时/天范围转成唯一的 UTC 半开区间，并显式接收应用时区和 asOf。
 * 本模块不读取系统设置、不访问数据库；所有失败均抛出可映射为用户输入错误的 RangeError。
 */
import {
  formatDateInputInTimeZone,
  parseDateInputInTimeZone,
  parseDateTimeInputInTimeZone,
} from "../time-zone";
import type {
  AnalyticsGranularity,
  AnalyticsMetric,
  UsageTrendsInput,
} from "./contracts";

const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURLY_RANGE_MS = 168 * HOUR_MS;
const MAX_DAILY_BUCKETS = 366;

export type ResolvedUsageTimeRange = {
  granularity: AnalyticsGranularity;
  metric: AnalyticsMetric;
  range: UsageTrendsInput["range"];
  timeZone: string;
  asOf: Date;
  start: Date;
  end: Date;
  bucketCount: number;
};

type ResolveUsageTimeRangeOptions = {
  timeZone: string;
  asOf: Date;
};

/**
 * 验证 asOf 是可用于确定范围的有效时间。
 *
 * @param asOf 调用方捕获的查询时刻。
 * @returns 同一个 Date；无外部副作用。
 * @throws RangeError 当 asOf 非法。
 */
function requireValidAsOf(asOf: Date): Date {
  if (Number.isNaN(asOf.getTime())) {
    throw new RangeError("查询时间无效");
  }
  return asOf;
}

/**
 * 将 YYYY-MM-DD 作为纯 Gregorian 日期移动指定天数。
 *
 * @param value 合法日期字符串。
 * @param days 可正可负的整数天数。
 * @returns 移动后的日期字符串；不受服务器本地时区或 DST 影响。
 * @throws RangeError 当输入不是可 round-trip 的日历日期。
 */
function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  if (
    !year ||
    !month ||
    !day ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("日期格式无效");
  }
  date.setUTCDate(date.getUTCDate() + days);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(
    date.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * 计算包含首尾日期的自然日数量。
 *
 * @param start 起始 YYYY-MM-DD。
 * @param end 结束 YYYY-MM-DD。
 * @returns inclusive 自然日数量；无外部副作用。
 */
function countInclusiveCalendarDays(start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

/**
 * 将有效本地日期解析为应用时区零点，否则转成一致的范围错误。
 *
 * @param value YYYY-MM-DD。
 * @param timeZone 应用时区。
 * @param fieldName 面向用户的字段名。
 * @returns 对应 UTC 瞬间。
 * @throws RangeError 当日期或其时区边界不存在。
 */
function requireLocalDateStart(
  value: string,
  timeZone: string,
  fieldName: string
): Date {
  const parsed = parseDateInputInTimeZone(value, { timeZone });
  if (!parsed) throw new RangeError(`${fieldName}无效`);
  return parsed;
}

/**
 * 解析自定义小时范围并实施绝对时长和未来边界限制。
 *
 * @param input 小时自定义输入。
 * @param options 显式应用时区与查询时刻。
 * @returns 规范化范围。
 * @throws RangeError 当字段非法、顺序错误、超过 168 小时或结束处于未来。
 */
function resolveCustomHourlyRange(
  input: Extract<UsageTrendsInput, { granularity: "hour"; range: "custom" }>,
  options: ResolveUsageTimeRangeOptions
): ResolvedUsageTimeRange {
  const start = parseDateTimeInputInTimeZone(input.start, {
    timeZone: options.timeZone,
  });
  const end = parseDateTimeInputInTimeZone(input.end, {
    timeZone: options.timeZone,
  });
  if (!start) throw new RangeError("开始时间无效或在时区中不存在");
  if (!end) throw new RangeError("结束时间无效或在时区中不存在");
  const durationMs = end.getTime() - start.getTime();
  if (durationMs <= 0) throw new RangeError("开始时间必须早于结束时间");
  if (durationMs > MAX_HOURLY_RANGE_MS) {
    throw new RangeError("按小时查询范围不能超过 168 小时");
  }
  if (end.getTime() > options.asOf.getTime()) {
    throw new RangeError("结束时间不能处于未来");
  }
  return {
    granularity: input.granularity,
    metric: input.metric,
    range: input.range,
    timeZone: options.timeZone,
    asOf: options.asOf,
    start,
    end,
    bucketCount: Math.ceil(durationMs / HOUR_MS),
  };
}

/**
 * 解析按天 preset 的本地起始日期。
 *
 * @param range preset 名称。
 * @param today 应用时区中的当前日期。
 * @returns preset 的第一天；无外部副作用。
 */
function resolveDailyPresetStart(
  range: Exclude<
    Extract<UsageTrendsInput, { granularity: "day" }>["range"],
    "custom"
  >,
  today: string
): string {
  if (range === "last7Days") return addCalendarDays(today, -6);
  const [year, month] = today.split("-").map(Number);
  if (!year || !month) throw new RangeError("当前日期无效");
  if (range === "currentYear") return `${year}-01-01`;
  const startMonth =
    range === "currentQuarter" ? Math.floor((month - 1) / 3) * 3 + 1 : month;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

/**
 * 将统计输入解析成唯一 UTC 半开区间与有界桶数。
 *
 * @param input 已通过 usageTrendsInputSchema 的范围输入。
 * @param options 显式应用时区和一次请求统一捕获的 asOf。
 * @returns 规范化范围。小时 preset 是以 asOf 锚定的固定 60 分钟桶；天 preset 截止
 * asOf，自定义天覆盖选择日期的完整自然日。
 * @throws RangeError 当输入非法、越界、反向或选择未来日期。
 */
export function resolveUsageTimeRange(
  input: UsageTrendsInput,
  options: ResolveUsageTimeRangeOptions
): ResolvedUsageTimeRange {
  const asOf = requireValidAsOf(options.asOf);
  if (input.granularity === "hour") {
    if (input.range === "custom") {
      return resolveCustomHourlyRange(input, { ...options, asOf });
    }
    const bucketCount = input.range === "last24Hours" ? 24 : 48;
    return {
      granularity: input.granularity,
      metric: input.metric,
      range: input.range,
      timeZone: options.timeZone,
      asOf,
      start: new Date(asOf.getTime() - bucketCount * HOUR_MS),
      end: new Date(asOf),
      bucketCount,
    };
  }

  const today = formatDateInputInTimeZone(asOf, options.timeZone);
  if (input.range === "custom") {
    const bucketCount = countInclusiveCalendarDays(input.start, input.end);
    if (bucketCount <= 0)
      throw new RangeError("开始日期必须早于或等于结束日期");
    if (bucketCount > MAX_DAILY_BUCKETS) {
      throw new RangeError("按天查询范围不能超过 366 个自然日");
    }
    if (input.end > today) throw new RangeError("结束日期不能处于未来");
    return {
      granularity: input.granularity,
      metric: input.metric,
      range: input.range,
      timeZone: options.timeZone,
      asOf,
      start: requireLocalDateStart(input.start, options.timeZone, "开始日期"),
      end: requireLocalDateStart(
        addCalendarDays(input.end, 1),
        options.timeZone,
        "结束日期"
      ),
      bucketCount,
    };
  }

  const startDate = resolveDailyPresetStart(input.range, today);
  return {
    granularity: input.granularity,
    metric: input.metric,
    range: input.range,
    timeZone: options.timeZone,
    asOf,
    start: requireLocalDateStart(startDate, options.timeZone, "范围起始日期"),
    end: new Date(asOf),
    bucketCount: countInclusiveCalendarDays(startDate, today),
  };
}

/**
 * 将 YYYY-MM-DD 移动一天，供天桶迭代复用。
 *
 * @param value 合法日期字符串。
 * @returns 下一自然日；输入非法时抛出 RangeError。
 */
export function getNextCalendarDate(value: string): string {
  return addCalendarDays(value, 1);
}
