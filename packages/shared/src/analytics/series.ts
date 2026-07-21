/**
 * 用户用量统计的规范化桶和稀疏结果补零工具。
 *
 * 小时桶按 UTC 固定 60 分钟推进，天桶按应用时区自然日推进；SQL 只需返回有值桶，
 * 本模块负责验证、排序和补零。所有函数 DB-free，不读取 locale 或运行时设置。
 */
import {
  formatDateInputInTimeZone,
  getTimeZoneOffsetMinutes,
  parseDateInputInTimeZone,
} from "../time-zone";
import type {
  AnalyticsMetric,
  AnalyticsMetricUnit,
  UsageSeriesBucket,
} from "./contracts";
import { getNextCalendarDate, type ResolvedUsageTimeRange } from "./range";

const HOUR_MS = 60 * 60 * 1000;

export type UsageSeriesPoint = {
  bucketStart: string | Date;
  value: number;
};

/**
 * 以稳定数字格式构造小时桶的本地基础标签。
 *
 * @param date 桶起点 UTC 瞬间。
 * @param timeZone 应用时区。
 * @returns `YYYY-MM-DD HH:mm`；无外部副作用。
 */
function formatHourlyBucketLabel(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part(
    "hour"
  )}:${part("minute")}`;
}

/**
 * 将 offset 分钟格式化为不会受运行时 locale 影响的标签。
 *
 * @param offsetMinutes 本地时间减 UTC 的分钟数。
 * @returns `UTC+08:00` 形式；无外部副作用。
 */
function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(
    minutes
  ).padStart(2, "0")}`;
}

/**
 * 生成固定 60 分钟的小时桶，并保留不足一小时的末桶。
 *
 * @param range 已规范化的小时范围。
 * @returns 尚未区分重复本地标签的零值桶；无外部副作用。
 */
function buildHourlyBuckets(
  range: ResolvedUsageTimeRange
): UsageSeriesBucket[] {
  const buckets: UsageSeriesBucket[] = [];
  for (
    let startMs = range.start.getTime();
    startMs < range.end.getTime();
    startMs += HOUR_MS
  ) {
    const start = new Date(startMs);
    const end = new Date(Math.min(startMs + HOUR_MS, range.end.getTime()));
    buckets.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: formatHourlyBucketLabel(start, range.timeZone),
      value: 0,
    });
  }
  const labelCounts = new Map<string, number>();
  for (const bucket of buckets) {
    labelCounts.set(bucket.label, (labelCounts.get(bucket.label) ?? 0) + 1);
  }
  return buckets.map((bucket) => {
    if ((labelCounts.get(bucket.label) ?? 0) < 2) return bucket;
    const start = new Date(bucket.start);
    return {
      ...bucket,
      label: `${bucket.label} ${formatUtcOffset(
        getTimeZoneOffsetMinutes(start, range.timeZone)
      )}`,
    };
  });
}

/**
 * 生成应用时区自然日桶，确保 DST 日可以是 23 或 25 小时。
 *
 * @param range 已规范化的按天范围。
 * @returns 顺序稳定的零值桶；最后一个 preset 桶可截止于 asOf。
 */
function buildDailyBuckets(range: ResolvedUsageTimeRange): UsageSeriesBucket[] {
  const buckets: UsageSeriesBucket[] = [];
  let localDate = formatDateInputInTimeZone(range.start, range.timeZone);
  for (let index = 0; index < range.bucketCount; index += 1) {
    const start = parseDateInputInTimeZone(localDate, {
      timeZone: range.timeZone,
    });
    const nextLocalDate = getNextCalendarDate(localDate);
    const naturalEnd = parseDateInputInTimeZone(nextLocalDate, {
      timeZone: range.timeZone,
    });
    if (!start || !naturalEnd) {
      throw new RangeError("无法构造应用时区自然日桶");
    }
    const end = new Date(Math.min(naturalEnd.getTime(), range.end.getTime()));
    if (start.getTime() >= end.getTime()) break;
    buckets.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: localDate,
      value: 0,
    });
    localDate = nextLocalDate;
  }
  return buckets;
}

/**
 * 为规范化范围生成完整的连续零值桶。
 *
 * @param range resolveUsageTimeRange 的输出。
 * @returns 最多 168 个小时桶或 366 个天桶；无外部副作用。
 * @throws RangeError 当解析后的 bucketCount 与实际构造结果不一致。
 */
export function buildUsageBuckets(
  range: ResolvedUsageTimeRange
): UsageSeriesBucket[] {
  const buckets =
    range.granularity === "hour"
      ? buildHourlyBuckets(range)
      : buildDailyBuckets(range);
  if (buckets.length !== range.bucketCount) {
    throw new RangeError("规范化时间桶数量与范围不一致");
  }
  return buckets;
}

/**
 * 将稀疏 SQL 聚合点合并进完整桶序列。
 *
 * @param buckets buildUsageBuckets 生成的规范桶。
 * @param points SQL 返回的有值桶，起点必须精确匹配规范桶且值为非负整数。
 * @returns 保持原顺序的新桶数组，缺失点为 0；不修改输入且无外部副作用。
 * @throws RangeError 当存在重复、范围外起点或非法聚合值，避免静默掩盖查询口径错误。
 */
export function fillUsageSeries(
  buckets: readonly UsageSeriesBucket[],
  points: readonly UsageSeriesPoint[]
): UsageSeriesBucket[] {
  const values = new Map<string, number>();
  const knownStarts = new Set(buckets.map((bucket) => bucket.start));
  for (const point of points) {
    const bucketStart =
      point.bucketStart instanceof Date
        ? point.bucketStart.toISOString()
        : point.bucketStart;
    if (!knownStarts.has(bucketStart)) {
      throw new RangeError("SQL 时间桶起点不在规范化范围内");
    }
    if (values.has(bucketStart)) {
      throw new RangeError("SQL 时间桶起点重复");
    }
    if (!Number.isInteger(point.value) || point.value < 0) {
      throw new RangeError("SQL 时间桶值必须是非负整数");
    }
    values.set(bucketStart, point.value);
  }
  return buckets.map((bucket) => ({
    ...bucket,
    value: values.get(bucket.start) ?? 0,
  }));
}

/**
 * 映射统计指标到唯一输出单位。
 *
 * @param metric 生图数量或视频秒数。
 * @returns 图片使用 images，视频使用 seconds；无外部副作用。
 */
export function getAnalyticsMetricUnit(
  metric: AnalyticsMetric
): AnalyticsMetricUnit {
  return metric === "imageCount" ? "images" : "seconds";
}
