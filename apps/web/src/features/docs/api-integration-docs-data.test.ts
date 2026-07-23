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
  "/v1/images/{task_id}",
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
  it.each(["zh", "en"])("%s 仅公开指定的三个图像端点", (locale) => {
    const content = getApiIntegrationDocs(locale);

    expect(content.endpoints.map((endpoint) => endpoint.path)).toEqual(
      EXPECTED_PATHS
    );
    expect(
      content.endpoints.some(
        (endpoint) =>
          endpoint.operation === "video" ||
          endpoint.path.startsWith("/v1/videos")
      )
    ).toBe(false);
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

  it("保留图片任务查询端点不可缺少的路径参数", () => {
    const endpoints = getApiIntegrationDocs("zh").endpoints;
    const imageTask = endpoints.find(
      (endpoint) => endpoint.path === "/v1/images/{task_id}"
    );

    expect(imageTask?.parameters.map((parameter) => parameter.name)).toContain(
      "task_id"
    );
  });

  it("为每个公开可选参数声明默认行为", () => {
    for (const locale of ["zh", "en"] as const) {
      const content = getApiIntegrationDocs(locale);
      for (const endpoint of content.endpoints) {
        for (const parameter of endpoint.parameters) {
          const isOptional =
            parameter.requirement === "可选" ||
            parameter.requirement === "Optional";
          if (isOptional) {
            expect(
              parameter.defaultValue?.trim(),
              `${locale}:${endpoint.id}:${parameter.name}`
            ).toBeTruthy();
          }
        }
      }
    }
  });

  it("与外部图片处理链的真实默认契约保持一致", () => {
    const endpoints = getApiIntegrationDocs("zh").endpoints;
    const generation = endpoints.find(
      (endpoint) => endpoint.id === "image-generations"
    );
    const edit = endpoints.find((endpoint) => endpoint.id === "image-edits");
    const generationDefaults = Object.fromEntries(
      (generation?.parameters ?? [])
        .filter((parameter) => parameter.requirement === "可选")
        .map((parameter) => [parameter.name, parameter.defaultValue])
    );
    const editDefaults = Object.fromEntries(
      (edit?.parameters ?? [])
        .filter((parameter) => parameter.requirement === "可选")
        .map((parameter) => [parameter.name, parameter.defaultValue])
    );
    const commonDefaults = {
      model: "后端默认（兜底 gpt-image-2）",
      n: "1",
      size: "1024x1024",
      quality: "auto",
      moderation: "auto",
      response_format: "b64_json",
      output_format: "未指定（上游决定）",
      output_compression: "未指定（上游决定）",
      background: "未指定（上游决定）",
      stream: "false",
    };

    expect(generationDefaults).toEqual(commonDefaults);
    expect(editDefaults).toEqual({ mask: "无", ...commonDefaults });
  });
});
