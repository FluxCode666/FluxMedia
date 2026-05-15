import { promises as fs } from "node:fs";
import path from "node:path";

import { db } from "@repo/database";
import { systemSetting } from "@repo/database/schema";

const DEFAULT_ENV_FILE_PATHS = [
  "/root/GPT2Image-Pro/apps/web/.env.local",
  "/home/user1/GPT2Image-Pro/apps/web/.env.local",
];

function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

function serializeEnvLine(key: string, value: unknown) {
  const text = typeof value === "string" ? value : String(value);
  return `${key}=${quoteEnvValue(text)}`;
}

function shouldWriteEnvFile(filePath: string) {
  return filePath.startsWith("/root/") || filePath.startsWith("/home/");
}

export async function syncSystemSettingsToEnvFiles() {
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting);

  if (rows.length === 0) {
    return { files: [] as string[] };
  }

  const managed = [
    "# BEGIN GPT2IMAGE ADMIN SETTINGS",
    ...rows
      .filter((row) => row.value !== null && row.value !== undefined)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => serializeEnvLine(row.key, row.value)),
    "# END GPT2IMAGE ADMIN SETTINGS",
  ].join("\n");

  const writtenFiles: string[] = [];
  for (const filePath of DEFAULT_ENV_FILE_PATHS) {
    if (!shouldWriteEnvFile(filePath)) continue;
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      let current = "";
      try {
        current = await fs.readFile(filePath, "utf8");
      } catch {
        current = "";
      }

      const next = current.includes("# BEGIN GPT2IMAGE ADMIN SETTINGS")
        ? current.replace(
            /# BEGIN GPT2IMAGE ADMIN SETTINGS[\s\S]*?# END GPT2IMAGE ADMIN SETTINGS/g,
            managed
          )
        : `${current.trimEnd()}\n\n${managed}\n`;

      await fs.writeFile(filePath, next.trimStart(), { mode: 0o600 });
      writtenFiles.push(filePath);
    } catch {
      // Best effort. The database remains the source of truth.
    }
  }

  return { files: writtenFiles };
}
