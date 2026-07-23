/**
 * 官网首页渐进增强动效策略。
 *
 * 使用方：`HomepageMotion` 客户端岛与 DB-free 单元测试；只决定动效等级和是否允许
 * ScrollTrigger，不承载固定、人工高度或横向滚动配置。
 */

/** 首页动效按设备能力收窄后的等级。 */
export type HomepageMotionMode = "disabled" | "compact" | "full";

/** 决策动效模式所需的最小媒体条件。 */
export type HomepageMotionConditions = {
  isDesktop: boolean;
  reduceMotion: boolean;
};

/** 动效客户端岛可执行的最小策略。 */
export type HomepageMotionPolicy = {
  mode: HomepageMotionMode;
  allowScrollTrigger: boolean;
};

/**
 * 根据断点与用户减动效偏好选择首页动效策略。
 *
 * @param conditions - 当前桌面断点和 `prefers-reduced-motion` 结果。
 * @returns 减动效优先的 disabled、窄屏 compact 或桌面 full 策略。
 * @sideEffects 无；结果可安全序列化，不包含任何 GSAP 运行时对象。
 */
export function getHomepageMotionPolicy({
  isDesktop,
  reduceMotion,
}: HomepageMotionConditions): HomepageMotionPolicy {
  if (reduceMotion) {
    return { allowScrollTrigger: false, mode: "disabled" };
  }

  if (!isDesktop) {
    return { allowScrollTrigger: false, mode: "compact" };
  }

  return { allowScrollTrigger: true, mode: "full" };
}
