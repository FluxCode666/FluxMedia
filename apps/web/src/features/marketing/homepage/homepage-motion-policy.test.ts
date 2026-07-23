/**
 * 官网首页动效策略的纯函数契约测试。
 *
 * 使用方：U4 渐进增强实现；确保减动效、窄屏和桌面条件选择稳定模式，且策略
 * 本身无法携带长滚动、固定或人工高度配置。
 */
import { describe, expect, it } from "vitest";

import { getHomepageMotionPolicy } from "./homepage-motion-policy";

describe("getHomepageMotionPolicy", () => {
  it.each([
    { isDesktop: true, reduceMotion: true },
    { isDesktop: false, reduceMotion: true },
  ])("减动效在任意断点都禁用动画", (conditions) => {
    expect(getHomepageMotionPolicy(conditions)).toEqual({
      allowScrollTrigger: false,
      mode: "disabled",
    });
  });

  it("窄屏只启用短入场，不创建滚动绑定", () => {
    expect(
      getHomepageMotionPolicy({ isDesktop: false, reduceMotion: false })
    ).toEqual({
      allowScrollTrigger: false,
      mode: "compact",
    });
  });

  it("普通桌面启用完整但受约束的首页动效", () => {
    expect(
      getHomepageMotionPolicy({ isDesktop: true, reduceMotion: false })
    ).toEqual({
      allowScrollTrigger: true,
      mode: "full",
    });
  });

  it("策略不暴露固定、人工高度或横向滚动配置", () => {
    const serializedPolicies = JSON.stringify([
      getHomepageMotionPolicy({ isDesktop: true, reduceMotion: false }),
      getHomepageMotionPolicy({ isDesktop: false, reduceMotion: false }),
      getHomepageMotionPolicy({ isDesktop: true, reduceMotion: true }),
    ]);

    expect(serializedPolicies).not.toMatch(
      /pin|pinSpacing|containerAnimation|scrollHeight|artificialHeight|horizontal/i
    );
  });
});
