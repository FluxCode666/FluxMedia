/**
 * 平台公开模型目录纯构建器测试。
 *
 * 使用方：首页运行时目录服务；覆盖套餐并集、分组可达性、成员终态、权威分类、
 * 大小写无关去重、稳定排序和快速集成所需的具体图像模型判断。
 */
import { describe, expect, it } from "vitest";

import {
  buildPlatformModelCatalog,
  isConcretePlatformImageModelId,
  type PlatformModelCatalogSource,
} from "./platform-model-catalog";

/** 构造包含动态套餐能力门槛的最小目录事实。 */
function createSource(
  overrides: Partial<PlatformModelCatalogSource> = {}
): PlatformModelCatalogSource {
  return {
    capabilityMinimums: {
      backendGroupsSelect: "starter",
      externalModelsList: "starter",
      externalImagesGenerate: "starter",
      externalChatCompletions: "starter",
      externalResponses: "pro",
      gpt55: "ultra",
    },
    groups: [
      {
        id: "default-group",
        isEnabled: true,
        isDefault: true,
        isUserSelectable: false,
        minPlan: "free",
        backendType: "mixed",
        childGroupIds: [],
      },
    ],
    members: [
      {
        type: "api",
        groupIds: ["default-group"],
        isEnabled: true,
        status: "active",
        interfaceMode: "images",
        imageUpstreamMode: "images",
        model: "gpt-image-2",
        supportedModelIds: [],
        adobeSourced: false,
      },
    ],
    ...overrides,
  };
}

describe("buildPlatformModelCatalog", () => {
  it("将普通 API 后端声明的 gpt-image 模型归入图像分类", () => {
    expect(buildPlatformModelCatalog(createSource()).image).toEqual([
      { id: "gpt-image-2" },
    ]);
  });

  it("按大小写无关方式稳定去重和排序，并在最后一个承接成员停用后移除模型", () => {
    const source = createSource({
      groups: [
        ...createSource().groups,
        {
          id: "selectable-group",
          isEnabled: true,
          isDefault: false,
          isUserSelectable: true,
          minPlan: "starter",
          backendType: "web",
          childGroupIds: [],
        },
      ],
      members: [
        {
          type: "api",
          groupIds: ["default-group"],
          isEnabled: true,
          status: "active",
          interfaceMode: "images",
          imageUpstreamMode: "images",
          model: "Zeta-Image",
          supportedModelIds: ["Zeta-Image", "beta-image"],
          adobeSourced: false,
        },
        {
          type: "api",
          groupIds: ["selectable-group"],
          isEnabled: true,
          status: "limited",
          interfaceMode: "images",
          imageUpstreamMode: "images",
          model: "zeta-image",
          supportedModelIds: ["zeta-image", "Alpha-Image"],
          adobeSourced: false,
        },
      ],
    });

    expect(buildPlatformModelCatalog(source).image).toEqual([
      { id: "Alpha-Image" },
      { id: "beta-image" },
      { id: "Zeta-Image" },
    ]);

    expect(
      buildPlatformModelCatalog({
        ...source,
        members: source.members.map((member) => ({
          ...member,
          isEnabled: false,
        })),
      }).image
    ).toEqual([]);
  });

  it("对三个分类都返回合法空数组", () => {
    expect(buildPlatformModelCatalog(createSource({ members: [] }))).toEqual({
      image: [],
      video: [],
      conversation: [],
    });
  });

  it("仅纳入有效默认或可选组，并只展开一层有效 mixed child", () => {
    const source = createSource({
      groups: [
        {
          id: "mixed-parent",
          isEnabled: true,
          isDefault: true,
          isUserSelectable: false,
          minPlan: "starter",
          backendType: "mixed",
          childGroupIds: [
            "valid-child",
            "disabled-child",
            "mixed-child",
            "nested-child",
            "missing-child",
          ],
        },
        {
          id: "valid-child",
          isEnabled: true,
          isDefault: false,
          isUserSelectable: false,
          minPlan: "starter",
          backendType: "responses",
          childGroupIds: [],
        },
        {
          id: "disabled-child",
          isEnabled: false,
          isDefault: false,
          isUserSelectable: false,
          minPlan: "starter",
          backendType: "web",
          childGroupIds: [],
        },
        {
          id: "mixed-child",
          isEnabled: true,
          isDefault: false,
          isUserSelectable: false,
          minPlan: "starter",
          backendType: "mixed",
          childGroupIds: [],
        },
        {
          id: "nested-child",
          isEnabled: true,
          isDefault: false,
          isUserSelectable: false,
          minPlan: "starter",
          backendType: "web",
          childGroupIds: ["nested-grandchild"],
        },
        {
          id: "orphan-group",
          isEnabled: true,
          isDefault: false,
          isUserSelectable: false,
          minPlan: "free",
          backendType: "web",
          childGroupIds: [],
        },
      ],
      members: [
        ...(
          [
            ["valid-child", "valid-image"],
            ["disabled-child", "disabled-image"],
            ["mixed-child", "mixed-image"],
            ["nested-child", "nested-image"],
            ["orphan-group", "orphan-image"],
          ] satisfies Array<[string, string]>
        ).map(([groupId, model]) => ({
          type: "api" as const,
          groupIds: [groupId],
          isEnabled: true,
          status: "active",
          interfaceMode: "images",
          imageUpstreamMode: "images",
          model,
          supportedModelIds: [],
          adobeSourced: false,
        })),
        {
          type: "api",
          groupIds: ["valid-child"],
          isEnabled: true,
          status: "active",
          interfaceMode: "responses",
          imageUpstreamMode: "images",
          model: "wrong-interface-image",
          supportedModelIds: [],
          adobeSourced: false,
        },
      ],
    });

    expect(buildPlatformModelCatalog(source).image).toEqual([
      { id: "valid-image" },
    ]);
  });

  it("排除终态 error，同时保留 cooldown 和 limited 所表达的平台支持", () => {
    const shared = {
      type: "api" as const,
      groupIds: ["default-group"],
      isEnabled: true,
      interfaceMode: "images",
      imageUpstreamMode: "images",
      supportedModelIds: [],
      adobeSourced: false,
    };
    const catalog = buildPlatformModelCatalog(
      createSource({
        members: [
          { ...shared, status: "error", model: "terminal-model" },
          {
            ...shared,
            status: "active",
            cooldownUntil: "2026-07-24T00:00:00.000Z",
            model: "cooldown-model",
          },
          { ...shared, status: "limited", model: "limited-model" },
        ],
      })
    );

    expect(catalog.image).toEqual([
      { id: "cooldown-model" },
      { id: "limited-model" },
    ]);
  });

  it("按 Adobe 视频、对话常量和图像后端声明的权威来源分类", () => {
    const catalog = buildPlatformModelCatalog(
      createSource({
        members: [
          {
            type: "adobe",
            groupIds: ["default-group"],
            isEnabled: true,
            status: "active",
            mode: "direct",
            enabledModels: ["gpt-image-2"],
            supportsVideo: true,
          },
          {
            type: "account",
            groupIds: ["default-group"],
            isEnabled: true,
            status: "active",
            implementationMode: "responses",
          },
          {
            type: "api",
            groupIds: ["default-group"],
            isEnabled: true,
            status: "active",
            interfaceMode: "images",
            imageUpstreamMode: "images",
            model: "vendor-unknown-image",
            supportedModelIds: [],
            adobeSourced: false,
          },
          {
            type: "api",
            groupIds: ["default-group"],
            isEnabled: true,
            status: "active",
            interfaceMode: "images",
            imageUpstreamMode: "images",
            model: "gpt-5.4",
            supportedModelIds: [],
            adobeSourced: false,
          },
        ],
      })
    );

    expect(catalog.image).toEqual([
      { id: "firefly-gpt-image-2" },
      { id: "gpt-image-2" },
      { id: "vendor-unknown-image" },
    ]);
    expect(catalog.video.length).toBeGreaterThan(0);
    expect(catalog.video[0]?.id.startsWith("firefly-")).toBe(true);
    expect(catalog.conversation).toEqual(
      expect.arrayContaining([{ id: "gpt-5.4" }, { id: "gpt-5.4-mini" }])
    );
    expect(catalog.image).not.toContainEqual({ id: "gpt-5.4" });
  });
});

describe("isConcretePlatformImageModelId", () => {
  it.each([
    "",
    "   ",
    "default",
    "unknown",
    "auto",
  ])("将占位模型 %j 判定为不可执行", (modelId) => {
    expect(isConcretePlatformImageModelId(modelId)).toBe(false);
  });

  it("接受运行时声明的具体图像模型", () => {
    expect(isConcretePlatformImageModelId("gpt-image-2")).toBe(true);
  });
});
