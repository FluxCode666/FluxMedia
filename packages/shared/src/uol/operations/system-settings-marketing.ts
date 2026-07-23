/**
 * 官网营销设置 UOL 操作。
 *
 * 使用方：首页管理员 Server Action；把首页 SLA 可见性写入的 schema、角色权限、
 * 副作用和执行入口集中到统一操作层，传输层只构造 Principal 并编码结果。
 */
import { z } from "zod";

import { setSystemSettings } from "../../system-settings/index";
import { OperationError } from "../errors";
import { defineOperation } from "../registry";

/** 首页 SLA 可见性写入输入，只接受一个布尔值。 */
const marketingSlaVisibilityInputSchema = z
  .object({ enabled: z.boolean() })
  .strict();

/** 首页 SLA 可见性写入结果，不暴露设置快照或审计内部字段。 */
const marketingSlaVisibilityOutputSchema = z
  .object({ enabled: z.boolean() })
  .strict();

/**
 * 设置首页 SLA 展示状态。
 *
 * 权限只允许真实 admin/super_admin 用户，observer_admin 与 system Principal 都不能
 * 通过网关；写入会更新持久化设置并失效缓存，因此显式声明为非幂等写操作。
 */
export const settingsSetMarketingSlaVisibility = defineOperation({
  name: "settings.setMarketingSlaVisibility",
  domain: "system-settings",
  title: "Set Homepage SLA Visibility",
  description: "开启或关闭官网首页的可验证 SLA 统计展示。",
  input: marketingSlaVisibilityInputSchema,
  output: marketingSlaVisibilityOutputSchema,
  access: { kind: "roles", roles: ["admin", "super_admin"] },
  agentExposure: "human-only",
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["cache"],
  async execute(input, principal, _ctx) {
    if (principal.type !== "user") {
      throw new OperationError(
        "forbidden",
        "Homepage SLA visibility requires a user principal"
      );
    }
    await setSystemSettings(
      [
        {
          key: "MARKETING_SLA_STATUS_ENABLED",
          value: input.enabled,
        },
      ],
      principal.userId
    );
    return { enabled: input.enabled };
  },
});
