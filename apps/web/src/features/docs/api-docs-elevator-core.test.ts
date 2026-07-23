/**
 * API 文档电梯章节判定测试。
 *
 * 覆盖首屏、跨章节与页面底部，确保滚动高亮不会停在上一个长章节。
 */
import { describe, expect, it } from "vitest";

import { resolveActiveElevatorSection } from "./api-docs-elevator-core";

const SECTIONS = [
  { id: "generation", top: -640 },
  { id: "edit", top: 80 },
  { id: "task", top: 920 },
] as const;

describe("resolveActiveElevatorSection", () => {
  it("首个章节尚未越过激活线时仍高亮首项", () => {
    expect(
      resolveActiveElevatorSection(
        [
          { id: "generation", top: 400 },
          { id: "edit", top: 1200 },
        ],
        112,
        false
      )
    ).toBe("generation");
  });

  it("高亮最后一个越过激活线的章节", () => {
    expect(resolveActiveElevatorSection(SECTIONS, 112, false)).toBe("edit");
  });

  it("到达页面底部时强制高亮最后一项", () => {
    expect(resolveActiveElevatorSection(SECTIONS, 112, true)).toBe("task");
  });

  it("没有可见章节时返回 null", () => {
    expect(resolveActiveElevatorSection([], 112, false)).toBeNull();
  });
});
