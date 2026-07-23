/**
 * 成功产物读模型写入语义测试。
 *
 * 使用内存存储验证事件唯一冲突、并发回放和汇总条件递增，不依赖真实数据库。
 */
import { describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("@repo/database", () => ({
  db: { transaction: databaseMocks.transaction },
}));

import {
  applyOutputUsageEvent,
  completeImageGenerationWithUsage,
  type OutputUsageEvent,
  type OutputUsageEventStore,
} from "./output-usage-read-model";

const imageEvent = {
  outputKind: "image",
  sourceTaskId: "generation-1",
  userId: "user-1",
  operationCreatedAt: new Date("2026-07-21T00:15:00.000Z"),
  imageCount: 4,
  videoSeconds: 0,
} satisfies OutputUsageEvent;

describe("output usage read model", () => {
  it("always completes image generation inside a database transaction", async () => {
    databaseMocks.transaction.mockClear();
    const returning = vi.fn().mockResolvedValue([
      {
        id: "chat-1",
        userId: "user-1",
        createdAt: new Date("2026-07-21T00:15:00.000Z"),
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    databaseMocks.transaction.mockImplementation(
      async (
        callback: (transaction: { update: typeof update }) => Promise<unknown>
      ) => callback({ update })
    );

    await expect(
      completeImageGenerationWithUsage({
        generationId: "chat-1",
        output: { kind: "none", reason: "chatTextOnly" },
        update: { completedAt: new Date("2026-07-21T00:20:00.000Z") },
      })
    ).resolves.toEqual({ completed: true, eventInserted: false });
    expect(databaseMocks.transaction).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("increments the summary only after a new event was inserted", async () => {
    const insertEvent = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const incrementSummary = vi.fn().mockResolvedValue(undefined);
    const store = {
      insertEvent,
      incrementSummary,
    } satisfies OutputUsageEventStore;

    await expect(applyOutputUsageEvent(store, imageEvent)).resolves.toEqual({
      inserted: true,
    });
    await expect(applyOutputUsageEvent(store, imageEvent)).resolves.toEqual({
      inserted: false,
    });

    expect(insertEvent).toHaveBeenCalledTimes(2);
    expect(incrementSummary).toHaveBeenCalledTimes(1);
    expect(incrementSummary).toHaveBeenCalledWith(imageEvent);
  });

  it("keeps one event and one summary increment under concurrent replay", async () => {
    const keys = new Set<string>();
    let imageCount = 0;
    const store = {
      async insertEvent(event: OutputUsageEvent) {
        const key = `${event.outputKind}:${event.sourceTaskId}`;
        if (keys.has(key)) return false;
        keys.add(key);
        await Promise.resolve();
        return true;
      },
      async incrementSummary(event: OutputUsageEvent) {
        imageCount += event.imageCount;
      },
    } satisfies OutputUsageEventStore;

    const results = await Promise.all([
      applyOutputUsageEvent(store, imageEvent),
      applyOutputUsageEvent(store, imageEvent),
    ]);

    expect(results).toEqual([{ inserted: true }, { inserted: false }]);
    expect(keys).toHaveLength(1);
    expect(imageCount).toBe(4);
  });

  it("records a completed five-second video and increments seconds once", async () => {
    const videoEvent = {
      outputKind: "video",
      sourceTaskId: "video-5s",
      userId: "user-1",
      operationCreatedAt: new Date("2026-07-20T23:55:00.000Z"),
      imageCount: 0,
      videoSeconds: 5,
    } satisfies OutputUsageEvent;
    const insertEvent = vi.fn().mockResolvedValue(true);
    const incrementSummary = vi.fn().mockResolvedValue(undefined);

    await expect(
      applyOutputUsageEvent({ insertEvent, incrementSummary }, videoEvent)
    ).resolves.toEqual({ inserted: true });
    expect(insertEvent).toHaveBeenCalledWith(videoEvent);
    expect(incrementSummary).toHaveBeenCalledOnce();
    expect(incrementSummary).toHaveBeenCalledWith(videoEvent);
  });

  it("rejects invalid video output before writing either table", async () => {
    const store = {
      insertEvent: vi.fn().mockResolvedValue(true),
      incrementSummary: vi.fn().mockResolvedValue(undefined),
    } satisfies OutputUsageEventStore;
    const invalidVideo = {
      outputKind: "video",
      sourceTaskId: "video-1",
      userId: "user-1",
      operationCreatedAt: new Date("2026-07-21T00:15:00.000Z"),
      imageCount: 0,
      videoSeconds: 0,
    } satisfies OutputUsageEvent;

    await expect(applyOutputUsageEvent(store, invalidVideo)).rejects.toThrow(
      /视频秒数/
    );
    expect(store.insertEvent).not.toHaveBeenCalled();
    expect(store.incrementSummary).not.toHaveBeenCalled();
  });
});
