import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_TIME_ZONE,
  formatDateInputInTimeZone,
  normalizeTimeZone,
  parseDateInputInTimeZone,
} from "./index";

describe("time-zone helpers", () => {
  it("normalizes invalid IANA time zones to the default", () => {
    expect(normalizeTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(normalizeTimeZone("not-a-time-zone")).toBe(DEFAULT_APP_TIME_ZONE);
  });

  it("formats date inputs in the configured time zone", () => {
    const date = new Date("2026-05-24T16:30:00.000Z");

    expect(formatDateInputInTimeZone(date, "UTC")).toBe("2026-05-24");
    expect(formatDateInputInTimeZone(date, "Asia/Shanghai")).toBe(
      "2026-05-25"
    );
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
});
