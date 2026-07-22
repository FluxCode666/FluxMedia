/**
 * 外部 API relayOnly 路径清单测试。
 *
 * 所有可达生成 handler 必须显式登记为单一图片管线中转或在副作用前拒绝。
 */

import { describe, expect, it } from "vitest";

import { RELAY_ONLY_HANDLER_POLICIES } from "./relay-policy";

describe("relay-only handler inventory", () => {
  it("covers every generation handler with an explicit policy", () => {
    expect(RELAY_ONLY_HANDLER_POLICIES).toEqual({
      imageGenerations: "image_pipeline",
      imageEdits: "image_pipeline",
      responses: "image_pipeline",
      chatCompletions: "image_pipeline",
      agentImages: "image_pipeline",
      videoGenerations: "reject_before_side_effects",
      pptGenerations: "reject_before_side_effects",
      psdGenerations: "reject_before_side_effects",
    });
  });
});
