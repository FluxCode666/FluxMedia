/**
 * 使用日志查询服务测试。
 *
 * 通过 DB-free 仓储注入证明 readiness 门禁、本人隔离、一次主查询和稳定分页。
 */

import { readFileSync } from "node:fs";
import { encodeUsageLogCursor } from "@repo/shared/credits/usage-log-token";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ db: {} }));

import { buildUsageLogListSql } from "./repository";
import {
  loadUsageEventDetail,
  loadUsageEvents,
  type UsageLogRepository,
  type UsageLogServiceError,
} from "./service";

const TOKEN_SECRET = "usage-log-service-test-secret";

/** 创建默认 ready 的 DB-free 仓储，并允许单个场景覆盖目标方法。 */
function createRepository(
  overrides: Partial<UsageLogRepository> = {}
): UsageLogRepository {
  return {
    readCreditUsageState: vi.fn().mockResolvedValue({
      version: 1,
      status: "ready",
    }),
    readListRows: vi.fn().mockResolvedValue([]),
    readRequestDetail: vi.fn().mockResolvedValue(null),
    readRefundDetail: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("usage log service", () => {
  it("returns not_ready before reading historical rows", async () => {
    const repository = createRepository({
      readCreditUsageState: vi.fn().mockResolvedValue({
        version: 1,
        status: "backfilling",
      }),
    });

    await expect(
      loadUsageEvents(
        { userId: "user-1", timeZone: "UTC", input: {} },
        { repository, tokenSecret: TOKEN_SECRET }
      )
    ).rejects.toMatchObject({ code: "not_ready" });
    expect(repository.readListRows).not.toHaveBeenCalled();
  });

  it("builds one bounded parameterized UNION query with relay predicates", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildUsageLogListSql({
        userId: "user-1",
        start: new Date("2026-07-16T00:00:00.000Z"),
        end: new Date("2026-07-23T00:00:00.000Z"),
        asOf: new Date("2026-07-22T12:00:00.000Z"),
        businessType: null,
        status: null,
        cursor: null,
        branchLimit: 21,
      })
    );

    expect(compiled.sql).toContain("with image_rows as");
    expect(compiled.sql).toContain("video_rows as");
    expect(compiled.sql).toContain("historical_rows as");
    expect(compiled.sql).toContain("refund_rows as");
    expect(compiled.sql).toContain("union all");
    expect(compiled.sql).toContain("v.usage_log_visible is true");
    expect(compiled.sql).toContain("t.type = 'refund'");
    expect(compiled.sql).toContain("candidate_operation_keys as");
    expect(compiled.sql).toContain("credit_usage_projection_entry");
    expect(compiled.sql).toContain("c.metadata->>'externalApiKeyId'");
    expect(compiled.sql).not.toContain("sql.raw");
    expect(compiled.params).toContain("user-1");
    expect(compiled.params).toContain(21);
  });

  it("keeps unprojected allowlisted refunds unlinked in detail SQL", () => {
    const source = readFileSync(
      new URL("./repository.ts", import.meta.url),
      "utf8"
    );

    expect(source).toMatch(
      /t\.operation_type in \(\$\{historicalAllowlist\}\) and u\.operation_id is not null/
    );
    expect(source).toContain("left join credit_usage_operation u on");
  });

  it("keeps failed-image deep pagination on raw status and primary-key columns", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildUsageLogListSql({
        userId: "user-1",
        start: new Date("2026-07-16T00:00:00.000Z"),
        end: new Date("2026-07-23T00:00:00.000Z"),
        asOf: new Date("2026-07-22T12:00:00.000Z"),
        businessType: "image",
        status: "failed",
        cursor: {
          eventAt: new Date("2026-07-21T12:00:00.000Z"),
          eventKindRank: 3,
          stableId: JSON.stringify(["generation", "generation-9"]),
          stableKey: ["generation", "generation-9"],
        },
        branchLimit: 21,
      })
    );

    expect(compiled.sql).toContain("g.status = 'failed'");
    expect(compiled.sql).toMatch(/g\.id < \$\d+/);
    expect(compiled.sql).toContain("order by g.created_at desc, g.id desc");
  });

  it("declares idempotent visibility columns and the complete keyset matrix", () => {
    const migration = readFileSync(
      new URL(
        "../../../../../packages/database/drizzle/0054_usage_log_keyset_indexes.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(migration.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2);
    expect(migration.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(6);
    expect(migration).toContain(
      '"user_id", "operation_created_at" DESC, "operation_type" DESC, "operation_id" DESC'
    );
    expect(migration).toContain("WHERE \"type\" = 'refund'");
  });

  it("uses one bounded main query and emits a stable next cursor", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      eventKind: "request" as const,
      businessType: "image" as const,
      operationType: "image_generation",
      factKind: "request" as const,
      generationMode: "generate",
      sourceChannel: "web" as const,
      eventAt: new Date(`2026-07-2${2 - index}T01:00:00.000Z`),
      eventKindRank: 3,
      stableId: JSON.stringify(["generation", `image-${index}`]),
      status: "succeeded" as const,
      rawStatus: "completed",
      grossConsumed: 10,
      refundAmount: 0,
    }));
    const readListRows = vi.fn().mockResolvedValue(rows);
    const repository = createRepository({ readListRows });

    const result = await loadUsageEvents(
      {
        userId: "user-1",
        timeZone: "UTC",
        input: { range: "7d", limit: 2 },
        now: new Date("2026-07-22T12:00:00.000Z"),
      },
      { repository, tokenSecret: TOKEN_SECRET }
    );

    expect(readListRows).toHaveBeenCalledOnce();
    expect(readListRows).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        branchLimit: 3,
        start: new Date("2026-07-16T00:00:00.000Z"),
        end: new Date("2026-07-23T00:00:00.000Z"),
      })
    );
    expect(result.events).toHaveLength(2);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it("does not distinguish a foreign eventRef from a missing event", async () => {
    const repository = createRepository();

    await expect(
      loadUsageEventDetail(
        { userId: "user-2", eventRef: "invalid-or-foreign" },
        { repository, tokenSecret: TOKEN_SECRET }
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<UsageLogServiceError>>({
        code: "not_found",
      })
    );
    expect(repository.readRequestDetail).not.toHaveBeenCalled();
  });

  it("rejects a signed cursor whose sort key falls outside its snapshot", async () => {
    const repository = createRepository();
    const cursor = encodeUsageLogCursor(
      {
        userId: "user-1",
        filters: { range: "7d", businessType: null, status: null },
        asOf: "2026-07-22T12:00:00.000Z",
        sortKey: {
          eventAt: "2026-07-22T12:00:01.000Z",
          eventKindRank: 3,
          stableId: JSON.stringify(["generation", "future-row"]),
        },
      },
      TOKEN_SECRET
    );

    await expect(
      loadUsageEvents(
        {
          userId: "user-1",
          timeZone: "UTC",
          input: { range: "7d", cursor },
          now: new Date("2026-07-22T12:00:00.000Z"),
        },
        { repository, tokenSecret: TOKEN_SECRET }
      )
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(repository.readListRows).not.toHaveBeenCalled();
  });
});
