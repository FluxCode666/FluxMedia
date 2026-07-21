/**
 * 生成类计费操作上下文的 DB-free 契约测试。
 *
 * 确保图片、视频与可编辑文件在初扣、补扣、轮次费和退款间
 * 复用同一稳定操作身份，不依赖 sourceRef 后缀。
 */

import { describe, expect, it } from "vitest";

import {
  createEditableFileCreditOperation,
  createImageCreditOperation,
  createVideoCreditOperation,
} from "./credit-operation-context";

describe("generation credit operation context", () => {
  it("uses one parent image operation for generate, edit, chat, agent, and repair contributions", () => {
    const createdAt = new Date("2026-07-21T01:00:00.000Z");
    const initial = createImageCreditOperation("generation-1", createdAt);
    const settlement = createImageCreditOperation("generation-1", createdAt);
    const refund = createImageCreditOperation("generation-1", createdAt);

    expect(initial).toEqual({
      operationType: "image_generation",
      operationId: "generation-1",
      operationCreatedAt: createdAt,
    });
    expect(settlement).toEqual(initial);
    expect(refund).toEqual(initial);
  });

  it("uses the persisted video id and creation time for charge and refund", () => {
    const createdAt = new Date("2026-07-21T02:00:00.000Z");
    expect(createVideoCreditOperation("video-1", createdAt)).toEqual({
      operationType: "video_generation",
      operationId: "video-1",
      operationCreatedAt: createdAt,
    });
  });

  it("shares one editable-file operation between generation and chat round", () => {
    const createdAt = new Date("2026-07-21T03:00:00.000Z");
    const generation = createEditableFileCreditOperation(
      "ppt",
      "task-1",
      createdAt
    );
    const chatRound = createEditableFileCreditOperation(
      "ppt",
      "task-1",
      createdAt
    );

    expect(generation).toEqual({
      operationType: "editable_file_ppt",
      operationId: "task-1",
      operationCreatedAt: createdAt,
    });
    expect(chatRound).toEqual(generation);
  });
});
