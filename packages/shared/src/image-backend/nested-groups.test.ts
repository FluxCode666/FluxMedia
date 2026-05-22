import { describe, expect, it } from "vitest";

import { validateNestedGroupConfig } from "./nested-groups";

const groups = [
  { id: "web", name: "Web", backendType: "web" as const },
  { id: "responses", name: "Codex", backendType: "responses" as const },
  { id: "mixed", name: "Mixed", backendType: "mixed" as const },
];

describe("image backend nested groups", () => {
  it("allows one mixed group to contain non-mixed child groups", () => {
    expect(
      validateNestedGroupConfig({
        groupId: "parent",
        backendType: "mixed",
        childGroupIds: ["web", "responses", "web"],
        groups,
      })
    ).toEqual({
      ok: true,
      childGroupIds: ["web", "responses"],
    });
  });

  it("clears child groups when the parent is not mixed", () => {
    expect(
      validateNestedGroupConfig({
        groupId: "web-parent",
        backendType: "web",
        childGroupIds: ["responses"],
        groups,
      })
    ).toEqual({ ok: true, childGroupIds: [] });
  });

  it("rejects mixed child groups", () => {
    expect(
      validateNestedGroupConfig({
        groupId: "parent",
        backendType: "mixed",
        childGroupIds: ["mixed"],
        groups,
      })
    ).toMatchObject({
      ok: false,
      error: "只允许 mixed 分组内嵌套非 mixed 分组",
    });
  });

  it("rejects self nesting and second-level nesting", () => {
    expect(
      validateNestedGroupConfig({
        groupId: "parent",
        backendType: "mixed",
        childGroupIds: ["parent"],
        groups,
      })
    ).toMatchObject({ ok: false, error: "分组不能嵌套自身" });

    expect(
      validateNestedGroupConfig({
        groupId: "parent",
        backendType: "mixed",
        childGroupIds: ["web"],
        groups: [
          { id: "web", name: "Web", backendType: "web", childGroupIds: ["x"] },
        ],
      })
    ).toMatchObject({
      ok: false,
      error: "分组嵌套只允许一层，子分组不能再包含子分组",
    });
  });

  it("does not allow an already nested group to become mixed", () => {
    expect(
      validateNestedGroupConfig({
        groupId: "web",
        backendType: "mixed",
        childGroupIds: [],
        groups: [
          {
            id: "parent",
            name: "父组",
            backendType: "mixed",
            childGroupIds: ["web"],
          },
          { id: "web", name: "Web", backendType: "web" },
        ],
      })
    ).toMatchObject({
      ok: false,
      error: "分组「父组」已嵌套当前分组，被嵌套的分组不能设为 mixed",
    });
  });
});
