/**
 * 平台公开模型目录 UOL 契约测试。
 *
 * 使用方：Vitest；固定 system-only、human-only、只读元数据和严格公开输出边界，
 * 防止平台级营销目录被误投影到 MCP 或混入内部后端字段。
 */
import { describe, expect, it } from "vitest";

import { invokeOperation } from "../invoke";
import type { Principal } from "../principal";
import { bindExecute } from "../registry";
import {
  getPlatformModelCatalog,
  platformModelCatalogOutputSchema,
} from "./external-api-platform-model-catalog";

const systemPrincipal = {
  type: "system",
  reason: "homepage-platform-model-catalog",
} satisfies Principal;

const userPrincipal = {
  type: "user",
  userId: "user-1",
  role: "user",
} satisfies Principal;

describe("externalApi.getPlatformModelCatalog", () => {
  it("声明为仅系统可调用且不向 Agent 暴露的天然幂等只读操作", () => {
    expect(getPlatformModelCatalog).toMatchObject({
      name: "externalApi.getPlatformModelCatalog",
      domain: "external-api",
      access: { kind: "system" },
      agentExposure: "human-only",
      readOnly: true,
      destructive: false,
      idempotency: { kind: "natural" },
      sideEffects: [],
    });
  });

  it("在执行绑定前拒绝非 system Principal", async () => {
    await expect(
      invokeOperation("externalApi.getPlatformModelCatalog", {}, userPrincipal)
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("允许 system Principal 通过真实网关调用已绑定实现", async () => {
    bindExecute("externalApi.getPlatformModelCatalog", async () => ({
      image: [{ id: "gpt-image-2" }],
      video: [],
      conversation: [{ id: "gpt-5.4" }],
    }));

    await expect(
      invokeOperation(
        "externalApi.getPlatformModelCatalog",
        {},
        systemPrincipal
      )
    ).resolves.toEqual({
      image: [{ id: "gpt-image-2" }],
      video: [],
      conversation: [{ id: "gpt-5.4" }],
    });
  });
});

describe("platformModelCatalogOutputSchema", () => {
  it("接受任一分类为空以及全部分类为空", () => {
    expect(
      platformModelCatalogOutputSchema.parse({
        image: [],
        video: [],
        conversation: [],
      })
    ).toEqual({ image: [], video: [], conversation: [] });
  });

  it("拒绝根对象和嵌套模型上的额外字段", () => {
    expect(() =>
      platformModelCatalogOutputSchema.parse({
        image: [],
        video: [],
        conversation: [],
        apiKey: "canary-secret",
      })
    ).toThrow();
    expect(() =>
      platformModelCatalogOutputSchema.parse({
        image: [
          {
            id: "gpt-image-2",
            baseUrl: "https://user:secret@example.test",
          },
        ],
        video: [],
        conversation: [],
      })
    ).toThrow();
  });
});
