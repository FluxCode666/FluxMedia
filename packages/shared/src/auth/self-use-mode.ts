import { getRuntimeSettingBoolean } from "../system-settings";

export const SELF_USE_MODE_SETTING_KEY = "SELF_USE_MODE_ENABLED";
export const LOCAL_SUPER_ADMIN_EMAIL = "admin@gpt2image.local";

export async function isSelfUseModeEnabled() {
  return getRuntimeSettingBoolean(SELF_USE_MODE_SETTING_KEY, true);
}
