import { describe, expect, it } from "vitest";

import { getCodexRetryAfterSeconds } from "../../apps/web/src/features/image-generation/retry-metadata";

describe("image generation retry metadata", () => {
  it("ignores Codex reset windows that are not exhausted", () => {
    const headers = new Headers({
      "x-codex-primary-used-percent": "13",
      "x-codex-primary-reset-after-seconds": String(5 * 60 * 60),
      "x-codex-primary-window-minutes": "300",
      "x-codex-secondary-used-percent": "4",
      "x-codex-secondary-reset-after-seconds": String(7 * 24 * 60 * 60),
      "x-codex-secondary-window-minutes": "10080",
    });

    expect(getCodexRetryAfterSeconds(headers)).toBeUndefined();
  });

  it("uses the exhausted Codex window reset as retry-after", () => {
    const headers = new Headers({
      "x-codex-primary-used-percent": "100",
      "x-codex-primary-reset-after-seconds": "900",
      "x-codex-primary-window-minutes": "300",
      "x-codex-secondary-used-percent": "20",
      "x-codex-secondary-reset-after-seconds": String(7 * 24 * 60 * 60),
      "x-codex-secondary-window-minutes": "10080",
    });

    expect(getCodexRetryAfterSeconds(headers)).toBe(900);
  });
});
