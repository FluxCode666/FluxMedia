import { getRuntimeSettingBoolean } from "../system-settings";

export const SELF_USE_MODE_SETTING_KEY = "SELF_USE_MODE_ENABLED";

/**
 * 解析自用模式是否启用。
 *
 * @returns 数据库设置优先、环境变量次之的自用模式开关。
 * @sideEffects 读取运行时系统设置，设置服务不可用时由调用方处理异常。
 */
export async function isSelfUseModeEnabled() {
  return getRuntimeSettingBoolean(SELF_USE_MODE_SETTING_KEY, true);
}
