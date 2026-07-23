/**
 * API 文档电梯的纯滚动判定逻辑。
 *
 * 与 DOM 监听分离后可在 Node 环境单测章节边界，避免浏览器尺寸和滚动事件让测试
 * 变得不稳定。
 */

export type ElevatorSectionPosition = {
  id: string;
  top: number;
};

/**
 * 根据章节顶部与激活线的位置选择当前电梯项。
 *
 * @param sections - 按页面顺序排列的章节及其视口顶部坐标。
 * @param activationLine - 顶栏和粘性导航下方的激活线坐标。
 * @param isAtPageEnd - 是否已经到达页面底部。
 * @returns 当前章节 ID；没有有效章节时返回 null。
 */
export function resolveActiveElevatorSection(
  sections: readonly ElevatorSectionPosition[],
  activationLine: number,
  isAtPageEnd: boolean
) {
  const firstSection = sections[0];
  if (!firstSection) return null;

  if (isAtPageEnd) {
    return sections.at(-1)?.id ?? firstSection.id;
  }

  let activeId = firstSection.id;
  for (const section of sections) {
    if (section.top > activationLine) break;
    activeId = section.id;
  }
  return activeId;
}
