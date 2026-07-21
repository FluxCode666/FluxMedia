/**
 * generation 历史时间迁移的部署安全契约测试。
 *
 * 迁移必须在旧 Web 仍可能写入时阻断并发 INSERT，拒绝不明确的混合时间口径，最后把
 * 数据库默认值切到 UTC；测试直接约束迁移文本，避免后续机械改写丢失这些边界。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "../../packages/database/drizzle/0052_normalize_generation_created_at_utc.sql"
  ),
  "utf8"
);

describe("generation UTC migration contract", () => {
  it("locks legacy writers before inspecting or converting rows", () => {
    const lockPosition = migrationSql.indexOf(
      'LOCK TABLE "generation" IN ACCESS EXCLUSIVE MODE'
    );
    const inspectionPosition = migrationSql.indexOf('FROM "generation";');
    const updatePosition = migrationSql.indexOf('UPDATE "generation"');

    expect(lockPosition).toBeGreaterThanOrEqual(0);
    expect(inspectionPosition).toBeGreaterThan(lockPosition);
    expect(updatePosition).toBeGreaterThan(inspectionPosition);
  });

  it("rejects ambiguous data and makes future defaults session-independent", () => {
    expect(migrationSql).toContain(
      "legacy_time_zone text := current_setting('TimeZone')"
    );
    expect(migrationSql).toContain("completed_count = 0");
    expect(migrationSql).toContain("检测到混合或不明确");
    expect(migrationSql).toContain(
      "SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')"
    );
  });
});
