/**
 * 公开 API 接入文档的数据契约测试。
 *
 * 防止管理员系统文档后续扩充时，把站点扩展参数、扩展响应字段或额外端点误带到
 * 无需登录即可访问的精简接入页。
 */
import { describe, expect, it } from "vitest";

import { getApiIntegrationDocs } from "./api-integration-docs-data";

const EXPECTED_PATHS = [
  "/v1/images/generations",
  "/v1/images/edits",
  "/v1/videos/generations",
  "/v1/images/{task_id}",
  "/v1/videos/{id}",
] as const;

const FORBIDDEN_EXTENSION_NAMES = [
  "force_firefly",
  "forceFirefly",
  "transparent_matte",
  "hd_repair",
  "hdRepair",
  "block_repair",
  "blockRepair",
  "repair_prompt",
  "repairPrompt",
  "async",
  "callback_url",
  "callbackUrl",
  "promptOptimization",
  "prompt_optimization",
  "promptRepair",
  "prompt_repair",
  "gptModel",
  "gpt_model",
  "thinking",
  "web_first",
  "webFirst",
  "force_web",
  "forceWeb",
  "image_url",
  "image_urls",
  "mask_url",
  "mask_image_url",
  "generation_id",
  "generationId",
  "credits_consumed",
  "duration_seconds",
  "video_url",
] as const;

describe("API integration docs data", () => {
  it.each(["zh", "en"])("%s 仅公开指定的五个端点", (locale) => {
    const content = getApiIntegrationDocs(locale);

    expect(content.endpoints.map((endpoint) => endpoint.path)).toEqual(
      EXPECTED_PATHS
    );
  });

  it.each(["zh", "en"])("%s 不展示站点扩展字段或示例", (locale) => {
    const content = getApiIntegrationDocs(locale);
    const visibleNames = content.endpoints.flatMap((endpoint) => [
      ...endpoint.parameters.map((parameter) => parameter.name),
      ...endpoint.responses.map((response) => response.name),
    ]);
    const examples = content.endpoints
      .flatMap((endpoint) => [
        endpoint.requestExample,
        endpoint.responseExample,
      ])
      .join("\n");

    for (const forbiddenName of FORBIDDEN_EXTENSION_NAMES) {
      expect(visibleNames.join("\n")).not.toContain(forbiddenName);
      expect(examples).not.toContain(`"${forbiddenName}"`);
    }
  });

  it("保留两个任务查询端点不可缺少的路径参数", () => {
    const endpoints = getApiIntegrationDocs("zh").endpoints;
    const imageTask = endpoints.find(
      (endpoint) => endpoint.path === "/v1/images/{task_id}"
    );
    const videoTask = endpoints.find(
      (endpoint) => endpoint.path === "/v1/videos/{id}"
    );

    expect(imageTask?.parameters.map((parameter) => parameter.name)).toContain(
      "task_id"
    );
    expect(videoTask?.parameters.map((parameter) => parameter.name)).toContain(
      "id"
    );
  });
});
