/**
 * 成功图片产物计数证据测试。
 *
 * 确保多产物、当前存储证据、保留清理证据和历史证据不足可明确区分。
 */
import { describe, expect, it } from "vitest";

import { resolveImageOutputCount } from "./output-count";

describe("image output count evidence", () => {
  it("uses the positive billable image output count first", () => {
    expect(
      resolveImageOutputCount({
        status: "completed",
        storageKey: "user/final.png",
        metadata: {
          outputImage: {
            billableImageOutputCount: 4,
            photoRetention: { destroyedAt: "2026-07-21T00:00:00.000Z" },
          },
        },
      })
    ).toEqual({
      status: "counted",
      count: 4,
      evidence: "billableImageOutputCount",
    });
  });

  it("falls back to one for current storage or retained-photo evidence", () => {
    expect(
      resolveImageOutputCount({
        status: "completed",
        storageKey: "user/final.png",
        metadata: null,
      })
    ).toEqual({
      status: "counted",
      count: 1,
      evidence: "storageKey",
    });
    expect(
      resolveImageOutputCount({
        status: "completed",
        storageKey: null,
        metadata: {
          outputImage: {
            photoRetention: { destroyedAt: "2026-07-21T00:00:00.000Z" },
          },
        },
      })
    ).toEqual({
      status: "counted",
      count: 1,
      evidence: "photoRetention",
    });
  });

  it("returns explicit insufficient evidence for completed historical rows", () => {
    expect(
      resolveImageOutputCount({
        status: "completed",
        storageKey: null,
        metadata: {},
      })
    ).toEqual({
      status: "insufficientEvidence",
      count: null,
      reason: "completedWithoutOutputEvidence",
    });
  });

  it("returns zero for unfinished rows and explicit non-positive counts", () => {
    expect(
      resolveImageOutputCount({
        status: "pending",
        storageKey: "user/final.png",
        metadata: { outputImage: { billableImageOutputCount: 3 } },
      })
    ).toEqual({
      status: "notCounted",
      count: 0,
      reason: "notCompleted",
    });
    expect(
      resolveImageOutputCount({
        status: "failed",
        storageKey: "user/final.png",
        metadata: { outputImage: { billableImageOutputCount: 3 } },
      })
    ).toEqual({
      status: "notCounted",
      count: 0,
      reason: "notCompleted",
    });
    expect(
      resolveImageOutputCount({
        status: "completed",
        storageKey: "user/final.png",
        metadata: { outputImage: { billableImageOutputCount: 0 } },
      })
    ).toEqual({
      status: "notCounted",
      count: 0,
      reason: "nonPositiveBillableCount",
    });
    expect(
      resolveImageOutputCount({
        status: "completed",
        storageKey: "user/final.png",
        metadata: { outputImage: { billableImageOutputCount: -1 } },
      })
    ).toEqual({
      status: "notCounted",
      count: 0,
      reason: "nonPositiveBillableCount",
    });
  });
});
