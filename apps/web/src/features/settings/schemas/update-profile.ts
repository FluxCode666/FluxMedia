/**
 * 用户资料更新输入契约。
 *
 * 职责：仅允许用户修改显示名称与头像；审核策略等管理员字段必须作为未知键
 * 拒绝。使用方为资料表单和 updateProfileAction。
 */
import { z } from "zod";

/**
 * 更新用户资料的 Zod Schema
 *
 * @field name - 用户显示名称，最少 2 个字符，最多 50 个字符
 * @field image - 用户头像 (存储键名)，可选
 */
export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .min(2, "名称至少需要 2 个字符")
      .max(50, "名称最多 50 个字符")
      .optional(),
    image: z.string().max(255, "头像路径过长").optional(),
  })
  .strict();

/**
 * 表单数据类型，从 Zod Schema 推断
 */
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
