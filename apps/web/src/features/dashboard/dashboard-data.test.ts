/**
 * 控制台快照装配器的 DB-free 测试。
 *
 * 验证首屏与刷新共用一次 UOL 初始化、本人身份和三路并行数据；核心统计失败时拒绝，
 * 非关键近期创作失败时记录原因并降级为空数组。
 */
import type {
  UsageSummaryOutput,
  UsageTrendsInput,
  UsageTrendsOutput,
} from "@repo/shared/analytics/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ db: {} }));

import { loadDashboardSnapshot } from "./dashboard-data";

const trendsInput = {
  granularity: "hour",
  metric: "imageCount",
  range: "last24Hours",
} satisfies UsageTrendsInput;

const summary = {
  asOf: "2026-07-21T05:00:00.000Z",
  timeZone: "Asia/Shanghai",
  todayRange: {
    start: "2026-07-20T16:00:00.000Z",
    end: "2026-07-21T05:00:00.000Z",
  },
  today: { imageCount: 2, videoSeconds: 5, creditsConsumed: 4 },
  lifetime: { imageCount: 20, videoSeconds: 50, creditsConsumed: 40 },
} satisfies UsageSummaryOutput;

const trends = {
  asOf: "2026-07-21T05:00:00.000Z",
  timeZone: "Asia/Shanghai",
  range: {
    start: "2026-07-20T05:00:00.000Z",
    end: "2026-07-21T05:00:00.000Z",
  },
  granularity: "hour",
  metric: "imageCount",
  unit: "images",
  buckets: [],
  distribution: { imageTasks: 2, videoTasks: 1, totalTasks: 3 },
} satisfies UsageTrendsOutput;

describe("dashboard snapshot loader", () => {
  it("loads summary, trends, and recent creations for the same user", async () => {
    const dependencies = {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      loadSummary: vi.fn().mockResolvedValue(summary),
      loadTrends: vi.fn().mockResolvedValue(trends),
      loadRecentCreations: vi.fn().mockResolvedValue([]),
      reportRecentCreationsError: vi.fn(),
    };

    await expect(
      loadDashboardSnapshot(
        { userId: "user-1", role: "user", trendsInput },
        dependencies
      )
    ).resolves.toEqual({ summary, trends, recentCreations: [] });
    expect(dependencies.ensureInitialized).toHaveBeenCalledTimes(1);
    expect(dependencies.loadSummary).toHaveBeenCalledWith({
      userId: "user-1",
      role: "user",
    });
    expect(dependencies.loadTrends).toHaveBeenCalledWith({
      userId: "user-1",
      role: "user",
      trendsInput,
    });
    expect(dependencies.loadRecentCreations).toHaveBeenCalledWith("user-1");
  });

  it("rejects the whole snapshot when one branch fails", async () => {
    const dependencies = {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      loadSummary: vi.fn().mockResolvedValue(summary),
      loadTrends: vi.fn().mockRejectedValue(new Error("trend unavailable")),
      loadRecentCreations: vi.fn().mockResolvedValue([]),
      reportRecentCreationsError: vi.fn(),
    };

    await expect(
      loadDashboardSnapshot(
        { userId: "user-1", role: "user", trendsInput },
        dependencies
      )
    ).rejects.toThrow("trend unavailable");
  });

  it("keeps the core snapshot when recent creations are unavailable", async () => {
    const databaseCause = Object.assign(new Error("read ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
    const recentCreationsError = new Error(
      'Failed query: select * from "generation" where "user_id" = $1\n' +
        "params: private-user-id",
      { cause: databaseCause }
    );
    const dependencies = {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      loadSummary: vi.fn().mockResolvedValue(summary),
      loadTrends: vi.fn().mockResolvedValue(trends),
      loadRecentCreations: vi.fn().mockRejectedValue(recentCreationsError),
      reportRecentCreationsError: vi.fn(),
    };

    await expect(
      loadDashboardSnapshot(
        { userId: "admin-1", role: "admin", trendsInput },
        dependencies
      )
    ).resolves.toEqual({ summary, trends, recentCreations: [] });
    expect(dependencies.reportRecentCreationsError).toHaveBeenCalledWith({
      name: "Error",
      message: "read ETIMEDOUT",
      code: "ETIMEDOUT",
    });
    expect(
      JSON.stringify(dependencies.reportRecentCreationsError.mock.calls)
    ).not.toContain("private-user-id");
  });
});
