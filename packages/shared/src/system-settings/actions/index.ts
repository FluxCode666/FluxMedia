"use server";

import { z } from "zod";

import { adminAction } from "../../safe-action";
import {
  getAdminSystemSettingsSnapshot,
  setSystemSettings,
} from "../index";
import { syncSystemSettingsToEnvFiles } from "../env-file";

const settingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  clear: z.boolean().optional(),
});

export const getSystemSettingsAction = adminAction
  .metadata({ action: "system-settings.get" })
  .action(async () => {
    const settings = await getAdminSystemSettingsSnapshot();
    return { settings };
  });

export const updateSystemSettingsAction = adminAction
  .metadata({ action: "system-settings.update" })
  .schema(
    z.object({
      settings: z.array(settingUpdateSchema).min(1),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const changedKeys = await setSystemSettings(
      parsedInput.settings.map((setting) => ({
        key: setting.key,
        value: setting.value,
        clear: setting.clear,
      })),
      ctx.userId
    );
    const envSync = await syncSystemSettingsToEnvFiles();

    return {
      success: true,
      changedKeys,
      envFiles: envSync.files,
      message: "系统设置已保存",
    };
  });
