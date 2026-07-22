/**
 * 用户资料更新输入契约测试。
 *
 * 职责：确保个人资料接口只接受名称和头像，拒绝已收归管理员控制的审核级别
 * 字段。使用方为 updateProfileSchema；测试不依赖数据库或 Next.js 运行时。
 */
import { describe, expect, it } from "vitest";

import { updateProfileSchema } from "./update-profile";

describe("updateProfileSchema", () => {
  it("接受合法的名称和头像字段", () => {
    expect(
      updateProfileSchema.parse({
        name: "Flux User",
        image: "avatars/user/profile.webp",
      })
    ).toEqual({
      name: "Flux User",
      image: "avatars/user/profile.webp",
    });
  });

  it.each(["low", false, null, "invalid-level"])(
    "拒绝用户提交审核级别字段：%s",
    (moderationBlockRiskLevel) => {
      const result = updateProfileSchema.safeParse({
        name: "Flux User",
        moderationBlockRiskLevel,
      });

      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error("审核级别字段不应通过用户资料输入校验");
      }
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            keys: ["moderationBlockRiskLevel"],
          }),
        ])
      );
    }
  );
});
