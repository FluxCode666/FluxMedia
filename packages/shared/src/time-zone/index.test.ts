import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_TIME_ZONE,
  formatDateInputInTimeZone,
  getTimeZoneOffsetMinutes,
  normalizeTimeZone,
  parseDateInputInTimeZone,
  parseDateTimeInputInTimeZone,
} from "./index";

describe("time-zone helpers", () => {
  it("normalizes invalid IANA time zones to the default", () => {
    expect(normalizeTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(normalizeTimeZone("not-a-time-zone")).toBe(DEFAULT_APP_TIME_ZONE);
  });

  it("formats date inputs in the configured time zone", () => {
    const date = new Date("2026-05-24T16:30:00.000Z");

    expect(formatDateInputInTimeZone(date, "UTC")).toBe("2026-05-24");
    expect(formatDateInputInTimeZone(date, "Asia/Shanghai")).toBe("2026-05-25");
  });

  it("parses date input boundaries in the configured time zone", () => {
    expect(
      parseDateInputInTimeZone("2026-05-25", {
        timeZone: "Asia/Shanghai",
      })?.toISOString()
    ).toBe("2026-05-24T16:00:00.000Z");

    expect(
      parseDateInputInTimeZone("2026-05-25", {
        timeZone: "Asia/Shanghai",
        endOfDay: true,
      })?.toISOString()
    ).toBe("2026-05-25T15:59:59.999Z");
  });

  it("rejects invalid calendar dates instead of normalizing them", () => {
    expect(
      parseDateInputInTimeZone("2026-02-30", {
        timeZone: "Asia/Shanghai",
      })
    ).toBeNull();
    expect(
      parseDateInputInTimeZone("2028-02-29", {
        timeZone: "Asia/Shanghai",
      })?.toISOString()
    ).toBe("2028-02-28T16:00:00.000Z");
  });

  it("rejects nonexistent local times and selects the earlier repeated time", () => {
    expect(
      parseDateTimeInputInTimeZone("2026-03-08T02:30", {
        timeZone: "America/Los_Angeles",
      })
    ).toBeNull();
    expect(
      parseDateTimeInputInTimeZone("2026-11-01T01:30", {
        timeZone: "America/Los_Angeles",
      })?.toISOString()
    ).toBe("2026-11-01T08:30:00.000Z");
  });

  it("returns the effective offset for a concrete instant", () => {
    expect(
      getTimeZoneOffsetMinutes(
        new Date("2026-11-01T08:30:00.000Z"),
        "America/Los_Angeles"
      )
    ).toBe(-420);
    expect(
      getTimeZoneOffsetMinutes(
        new Date("2026-11-01T09:30:00.000Z"),
        "America/Los_Angeles"
      )
    ).toBe(-480);
  });
});
