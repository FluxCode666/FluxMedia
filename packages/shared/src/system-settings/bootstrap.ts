import { db } from "@repo/database";
import { systemSetting } from "@repo/database/schema";
import {
  importMissingSystemSettingsFromEnv,
  initializeMissingSystemSettingsDefaults,
  setBootstrappedProcessSetting,
} from ".";

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
