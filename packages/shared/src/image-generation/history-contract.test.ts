/**
 * 统一生成历史共享契约测试。
 *
 * 覆盖调用方身份注入、自然日边界、筛选枚举和 image/video 判别字段，保证 Web、
 * UOL 与未来 Agent 入口共享同一份机器契约。
 */

import { describe, expect, it } from "vitest";
import {
  historyListInputSchema,
  historyListOutputSchema,
} from "./history-contract";

describe("history contract", () => {
  it("normalizes optional filters without accepting caller identity", () => {
    expect(historyListInputSchema.parse({})).toEqual({
      createdFrom: null,
      createdTo: null,
      model: null,
      status: null,
      type: null,
      cursor: null,
      limit: 20,
    });
    expect(
      historyListInputSchema.safeParse({ userId: "forged-user" }).success
    ).toBe(false);
  });

  it("rejects invalid or reversed local calendar ranges", () => {
    expect(
      historyListInputSchema.safeParse({ createdFrom: "2026-02-30" }).success
    ).toBe(false);
    expect(
      historyListInputSchema.safeParse({
        createdFrom: "2026-07-23",
        createdTo: "2026-07-22",
      }).success
    ).toBe(false);
  });

  it("accepts exact model, status, type, cursor and bounded limit", () => {
    expect(
      historyListInputSchema.parse({
        createdFrom: "2026-07-01",
        createdTo: "2026-07-22",
        model: "  gpt-image-2  ",
        status: "completed",
        type: "image",
        cursor: "signed-cursor",
        limit: 50,
      })
    ).toMatchObject({ model: "gpt-image-2", limit: 50 });
    expect(historyListInputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(
      historyListInputSchema.safeParse({ status: "running" }).success
    ).toBe(false);
  });

  it("keeps image and video detail fields mutually exclusive", () => {
    const common = {
      id: "record-1",
      prompt: "prompt",
      model: "model-1",
      status: "completed" as const,
      creditsConsumed: 10,
      error: null,
      createdAt: "2026-07-22T01:00:00.000Z",
      completedAt: "2026-07-22T01:01:00.000Z",
    };
    const parsed = historyListOutputSchema.parse({
      asOf: "2026-07-22T02:00:00.000Z",
      records: [
        {
          ...common,
          kind: "image",
          revisedPrompt: null,
          size: "1024x1024",
          creditDetails: null,
          promptRepairNotice: null,
          referenceImages: [],
          isLayered: false,
          imageUrl: "/api/storage/generations/user/output.png",
        },
        {
          ...common,
          id: "record-2",
          kind: "video",
          family: "sora2",
          resolution: "1080p",
          durationSeconds: 8,
          aspectRatio: "16x9",
          videoUrl: "/api/storage/generations/user/output.mp4",
        },
      ],
      modelOptions: ["model-1"],
      nextCursor: null,
      previousCursor: null,
    });

    expect(parsed.records.map((record) => record.kind)).toEqual([
      "image",
      "video",
    ]);
    expect(
      historyListOutputSchema.safeParse({
        ...parsed,
        records: [
          {
            ...parsed.records[0],
            durationSeconds: 8,
          },
        ],
      }).success
    ).toBe(false);
  });
});
