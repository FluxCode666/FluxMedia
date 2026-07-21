/**
 * 控制台快照装配器的 DB-free 测试。
 *
 * 验证首屏与刷新共用一次 UOL 初始化、本人身份和三路并行数据；任一路失败时不会返回
 * 部分快照，客户端可继续保留旧数据。
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
    };

    await expect(
      loadDashboardSnapshot(
        { userId: "user-1", role: "user", trendsInput },
        dependencies
      )
    ).rejects.toThrow("trend unavailable");
  });
});
