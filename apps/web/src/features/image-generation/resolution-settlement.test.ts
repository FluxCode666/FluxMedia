/**
 * 分辨率结算档位测试。
 *
 * 锁定最长边分档、阈值边界与非法输入行为，避免历史快照和实际计价档位漂移。
 */

import { describe, expect, it } from "vitest";
import { resolveImageResolutionSettlement } from "./resolution-settlement";

describe("resolveImageResolutionSettlement", () => {
  it.each([
    ["1024x1024", "1024"],
    ["1248x832", "1K"],
    ["2048x1152", "2K"],
    ["2160x3840", "4K"],
  ] as const)("把 %s 映射为 %s 档", (size, expected) => {
    expect(resolveImageResolutionSettlement(size)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    "",
    "auto",
    "not-a-size",
  ])("无法确定 %s 的档位时返回 null", (size) => {
    expect(resolveImageResolutionSettlement(size)).toBeNull();
  });
});
