/**
 * 外部生成 API 的 relayOnly 隐私策略清单。
 *
 * 图片类 handler 进入同一图像管线，由管线保持扣费/审核但禁止历史与对象存储；
 * 无法纯中转的异步视频和可编辑文件必须在任何任务、副作用或存储前拒绝。
 */

/** 所有可达生成 handler 的穷举策略，新增 handler 必须同步登记和测试。 */
export const RELAY_ONLY_HANDLER_POLICIES = {
  imageGenerations: "image_pipeline",
  imageEdits: "image_pipeline",
  responses: "image_pipeline",
  chatCompletions: "image_pipeline",
  agentImages: "image_pipeline",
  videoGenerations: "reject_before_side_effects",
  pptGenerations: "reject_before_side_effects",
  psdGenerations: "reject_before_side_effects",
} as const;

/**
 * 判断当前 key 是否必须在 handler 入口拒绝。
 *
 * @param relayOnly 当前 API key 的不可变请求模式。
 * @param handler 已登记的 handler 名称。
 * @returns 仅不可纯中转 handler 在 relayOnly 下返回 true；无副作用。
 */
export function shouldRejectRelayOnly(
  relayOnly: boolean,
  handler: keyof typeof RELAY_ONLY_HANDLER_POLICIES
): boolean {
  return (
    relayOnly &&
    RELAY_ONLY_HANDLER_POLICIES[handler] === "reject_before_side_effects"
  );
}
