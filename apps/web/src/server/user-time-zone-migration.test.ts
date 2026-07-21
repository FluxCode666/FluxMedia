/**
 * 用户时区迁移的静态契约测试。
 *
 * 保证用户偏好保持可空，并彻底清理曾经可由系统设置覆盖部署环境的 APP_TIME_ZONE 行。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../packages/database/drizzle/0053_user_time_zone.sql"
  ),
  "utf8"
);

describe("user time-zone migration contract", () => {
  it("adds a nullable user preference and removes the legacy system setting", () => {
    expect(migrationSql).toContain(
      'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "time_zone" text'
    );
    expect(migrationSql).not.toContain('"time_zone" text NOT NULL');
    expect(migrationSql).toContain(
      'DELETE FROM "system_setting" WHERE "key" = \'APP_TIME_ZONE\''
    );
  });
});
