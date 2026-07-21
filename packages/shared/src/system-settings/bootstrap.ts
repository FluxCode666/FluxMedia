import { db } from "@repo/database";
import { systemSetting } from "@repo/database/schema";
import {
  importMissingSystemSettingsFromEnv,
  initializeMissingSystemSettingsDefaults,
  setBootstrappedProcessSetting,
} from ".";
import { isSettingKey } from "./definitions";

let bootstrapped = false;

export async function bootstrapSystemSettingsEnv() {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    await importMissingSystemSettingsFromEnv();
    await initializeMissingSystemSettingsDefaults();

    const rows = await db
      .select({
        key: systemSetting.key,
        value: systemSetting.value,
      })
      .from(systemSetting);

    for (const row of rows) {
      // 已移除或未知的 DB 键不得反向覆盖真实部署环境；APP_TIME_ZONE 等 env-only
      // 配置由其业务模块直接读取 process.env。
      if (!isSettingKey(row.key)) continue;
      if (row.value === null || row.value === undefined) continue;
      const value =
        typeof row.value === "string"
          ? row.value.trim()
          : typeof row.value === "object"
            ? JSON.stringify(row.value)
            : String(row.value);
      if (value) {
        setBootstrappedProcessSetting(row.key, value);
      }
    }
  } catch {
    // Auth and instrumentation modules must not fail import just because the
    // settings table is not migrated yet. Request-time settings still use env.
  }
}
