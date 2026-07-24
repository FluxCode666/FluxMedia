/**
 * 管理端全局历史 SQL 构造器测试。
 *
 * 不连接数据库，仅编译 Drizzle SQL，证明全局查询通过 user 表受控关联、邮箱使用参数化、
 * 图片/视频分支各自有界，并保留稳定 keyset 排序。
 */

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ db: {} }));

import {
  buildAdminHistoryListSql,
  buildAdminHistoryModelOptionsSql,
  buildAdminHistoryUserOptionsSql,
} from "./admin-history-repository";

const baseQuery = {
  start: new Date("2026-07-01T00:00:00.000Z"),
  end: new Date("2026-07-23T00:00:00.000Z"),
  asOf: new Date("2026-07-22T12:00:00.000Z"),
  model: "gpt-image-2",
  status: "completed" as const,
  type: null,
  userEmail: "member@example.com",
  cursor: null,
  branchLimit: 21,
};

describe("admin history repository SQL", () => {
  it("builds a bounded global image/video union with an email join", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildAdminHistoryListSql(baseQuery)
    );

    expect(compiled.sql).toContain('inner join "user" u on u.id = g.user_id');
    expect(compiled.sql).toContain('inner join "user" u on u.id = v.user_id');
    expect(compiled.sql).toContain("u.email::text as user_email");
    expect(compiled.sql).toContain("union all");
    expect(compiled.sql).toContain("order by g.created_at desc, g.id desc");
    expect(compiled.sql).toContain("order by v.created_at desc, v.id desc");
    expect(compiled.params).toContain("member@example.com");
    expect(compiled.params.filter((value) => value === 21)).toHaveLength(3);
    expect(compiled.sql).not.toContain("sql.raw");
    expect(compiled.sql).not.toContain("webConversation");
  });

  it("reverses global ordering for a signed previous cursor", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildAdminHistoryListSql({
        ...baseQuery,
        cursor: {
          createdAt: new Date("2026-07-20T12:00:00.000Z"),
          kindRank: 1,
          id: "image-20",
          direction: "previous",
        },
      })
    );

    expect(compiled.sql).toMatch(/g\.created_at > \$\d+/);
    expect(compiled.sql).toMatch(/g\.id > \$\d+/);
    expect(compiled.sql).toContain(
      "order by created_at asc, kind_rank asc, id asc"
    );
  });

  it("scopes model options by email and returns only users with matching history types", () => {
    const modelSql = new PgDialect().sqlToQuery(
      buildAdminHistoryModelOptionsSql({
        userEmail: "member@example.com",
        type: "image",
        limit: 200,
      })
    );
    const userSql = new PgDialect().sqlToQuery(
      buildAdminHistoryUserOptionsSql({ type: "video", limit: 200 })
    );

    expect(modelSql.sql).toContain('inner join "user" u on u.id = g.user_id');
    expect(modelSql.params).toContain("member@example.com");
    expect(userSql.sql).toContain("exists (select 1 from video_generation v");
    expect(userSql.sql).not.toContain("exists (select 1 from generation g");
    expect(userSql.params).toContain(200);
  });
});
