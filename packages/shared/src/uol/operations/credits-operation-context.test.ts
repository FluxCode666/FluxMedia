/**
 * 积分 UOL operation context 输入契约测试。
 *
 * 保证 generic grant 不能绕过专用退款路径，且退款必须显式携带原操作身份和创建时间。
 */

import { describe, expect, it } from "vitest";

/** 设置测试连接占位后加载 operation 定义；schema 测试不会访问数据库。 */
async function loadCreditOperations() {
  process.env.DATABASE_URL ||=
    "postgres://test:test@127.0.0.1:5432/gpt2image_test";
  return import("./credits");
}

describe("credits UOL operation context contract", () => {
  it("excludes refunds from generic grant", async () => {
    const { grant } = await loadCreditOperations();

    expect(
      grant.input.safeParse({
        userId: "user-1",
        amount: 20,
        sourceType: "refund",
        sourceRef: "generation-1:refund",
      }).success
    ).toBe(false);
  });

  it("requires a complete original operation for refunds", async () => {
    const { refund } = await loadCreditOperations();
    const baseInput = {
      userId: "user-1",
      amount: 20,
      sourceRef: "generation-1:refund",
    };

    expect(refund.input.safeParse(baseInput).success).toBe(false);
    expect(
      refund.input.safeParse({
        ...baseInput,
        operationType: "image_generation",
        operationId: "generation-1",
        operationCreatedAt: "2026-07-20T23:00:00.000Z",
      }).success
    ).toBe(true);
  });
});
