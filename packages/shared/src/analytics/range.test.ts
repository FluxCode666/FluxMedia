/**
 * 用户用量统计范围解析测试。
 *
 * 覆盖滚动小时窗、自定义上限、应用时区自然日、DST、闰日与输入契约。
 */
import { describe, expect, it } from "vitest";

import { usageSummaryOutputSchema, usageTrendsInputSchema } from "./contracts";
import { resolveUsageTimeRange } from "./range";

const SHANGHAI = "Asia/Shanghai";
const LOS_ANGELES = "America/Los_Angeles";

describe("usage analytics range contracts", () => {
  it.each([
    ["last24Hours", 24],
    ["last48Hours", 48],
  ] as const)("resolves %s as an exact rolling window", (range, hours) => {
    const asOf = new Date("2026-07-21T05:37:42.123Z");
    const resolved = resolveUsageTimeRange(
      { granularity: "hour", metric: "imageCount", range },
      { asOf, timeZone: SHANGHAI }
    );

    expect(resolved.end).toEqual(asOf);
    expect(resolved.end.getTime() - resolved.start.getTime()).toBe(
      hours * 60 * 60 * 1000
    );
    expect(resolved.bucketCount).toBe(hours);
  });

  it("accepts exactly 168 custom hours and rejects one millisecond more", () => {
    const options = {
      asOf: new Date("2026-07-21T16:00:00.000Z"),
      timeZone: SHANGHAI,
    };

    expect(
      resolveUsageTimeRange(
        {
          granularity: "hour",
          metric: "imageCount",
          range: "custom",
          start: "2026-07-15T00:00",
          end: "2026-07-22T00:00",
        },
        options
      ).bucketCount
    ).toBe(168);
    expect(() =>
      resolveUsageTimeRange(
        {
          granularity: "hour",
          metric: "imageCount",
          range: "custom",
          start: "2026-07-15T00:00",
          end: "2026-07-22T00:00:00.001",
        },
        {
          ...options,
          asOf: new Date("2026-07-21T16:00:00.001Z"),
        }
      )
    ).toThrowError(/168/);
  });

  it("rejects invalid, empty, reversed, future, and nonexistent hourly ranges", () => {
    const options = {
      asOf: new Date("2026-03-10T00:00:00.000Z"),
      timeZone: LOS_ANGELES,
    };

    expect(() =>
      resolveUsageTimeRange(
        {
          granularity: "hour",
          metric: "imageCount",
          range: "custom",
          start: "2026-03-08T02:30",
          end: "2026-03-08T03:30",
        },
        options
      )
    ).toThrowError(/开始时间/);
    expect(() =>
      resolveUsageTimeRange(
        {
          granularity: "hour",
          metric: "imageCount",
          range: "custom",
          start: "2026-03-09T10:00",
          end: "2026-03-09T10:00",
        },
        options
      )
    ).toThrowError(/早于/);
    expect(() =>
      resolveUsageTimeRange(
        {
          granularity: "hour",
          metric: "imageCount",
          range: "custom",
          start: "2026-03-09T11:00",
          end: "2026-03-09T10:00",
        },
        options
      )
    ).toThrowError(/早于/);
    expect(() =>
      resolveUsageTimeRange(
        {
          granularity: "hour",
          metric: "imageCount",
          range: "custom",
          start: "2026-03-09T10:00",
          end: "2026-03-10T00:00",
        },
        options
      )
    ).toThrowError(/未来/);
  });

  it("keeps the trends input schema free of caller-supplied identity", () => {
    expect(
      usageTrendsInputSchema.safeParse({
        granularity: "hour",
        metric: "imageCount",
        range: "last24Hours",
        userId: "another-user",
      }).success
    ).toBe(false);
  });

  it("accepts fractional credit totals while preserving integer output counts", () => {
    const result = usageSummaryOutputSchema.safeParse({
      asOf: "2026-07-21T05:37:42.123Z",
      timeZone: SHANGHAI,
      todayRange: {
        start: "2026-07-20T16:00:00.000Z",
        end: "2026-07-21T16:00:00.000Z",
      },
      today: {
        imageCount: 4,
        videoSeconds: 5,
        creditsConsumed: 1.25,
      },
      lifetime: {
        imageCount: 10,
        videoSeconds: 20,
        creditsConsumed: 3.75,
      },
    });

    expect(result.success).toBe(true);
    expect(
      usageSummaryOutputSchema.safeParse({
        asOf: "2026-07-21T05:37:42.123Z",
        timeZone: SHANGHAI,
        todayRange: {
          start: "2026-07-20T16:00:00.000Z",
          end: "2026-07-21T16:00:00.000Z",
        },
        today: {
          imageCount: 1.5,
          videoSeconds: 5,
          creditsConsumed: 1,
        },
        lifetime: {
          imageCount: 10,
          videoSeconds: 20,
          creditsConsumed: 3,
        },
      }).success
    ).toBe(false);
  });

  it("resolves the last seven days and calendar-to-date presets", () => {
    const asOf = new Date("2026-07-21T05:37:42.123Z");

    expect(
      resolveUsageTimeRange(
        { granularity: "day", metric: "imageCount", range: "last7Days" },
        { asOf, timeZone: SHANGHAI }
      )
    ).toMatchObject({
      bucketCount: 7,
      start: new Date("2026-07-14T16:00:00.000Z"),
      end: asOf,
    });
    expect(
      resolveUsageTimeRange(
        {
          granularity: "day",
          metric: "imageCount",
          range: "currentMonth",
        },
        { asOf, timeZone: SHANGHAI }
      ).start.toISOString()
    ).toBe("2026-06-30T16:00:00.000Z");
    expect(
      resolveUsageTimeRange(
        {
          granularity: "day",
          metric: "imageCount",
          range: "currentQuarter",
        },
        { asOf, timeZone: SHANGHAI }
      ).start.toISOString()
    ).toBe("2026-06-30T16:00:00.000Z");
    expect(
      resolveUsageTimeRange(
        {
          granularity: "day",
          metric: "imageCount",
          range: "currentYear",
        },
        { asOf, timeZone: SHANGHAI }
      ).start.toISOString()
    ).toBe("2025-12-31T16:00:00.000Z");
  });

  it("counts custom day ranges by local calendar days across DST", () => {
    const options = {
      asOf: new Date("2026-12-31T20:00:00.000Z"),
      timeZone: LOS_ANGELES,
    };
    const spring = resolveUsageTimeRange(
      {
        granularity: "day",
        metric: "videoSeconds",
        range: "custom",
        start: "2026-03-07",
        end: "2026-03-09",
      },
      options
    );

    expect(spring.bucketCount).toBe(3);
    expect(spring.end.getTime() - spring.start.getTime()).toBe(
      71 * 60 * 60 * 1000
    );
  });

  it("accepts 366 natural days including leap day and rejects 367", () => {
    const options = {
      asOf: new Date("2029-01-02T00:00:00.000Z"),
      timeZone: SHANGHAI,
    };

    expect(
      resolveUsageTimeRange(
        {
          granularity: "day",
          metric: "imageCount",
          range: "custom",
          start: "2028-01-01",
          end: "2028-12-31",
        },
        options
      ).bucketCount
    ).toBe(366);
    expect(() =>
      resolveUsageTimeRange(
        {
          granularity: "day",
          metric: "imageCount",
          range: "custom",
          start: "2028-01-01",
          end: "2029-01-01",
        },
        options
      )
    ).toThrowError(/366/);
  });
});
