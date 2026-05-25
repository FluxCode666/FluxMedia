import { getRuntimeSettingString } from "../system-settings";
import {
  APP_TIME_ZONE_SETTING_KEY,
  DEFAULT_APP_TIME_ZONE,
  normalizeTimeZone,
} from "./index";

export async function getAppTimeZone() {
  return normalizeTimeZone(
    await getRuntimeSettingString(APP_TIME_ZONE_SETTING_KEY),
    DEFAULT_APP_TIME_ZONE
  );
}
