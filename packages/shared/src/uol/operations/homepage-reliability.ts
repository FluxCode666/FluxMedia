/**
 * 官网首页可靠性 UOL 只读操作。
 *
 * 使用方：首页 Server Component 通过 invokeOperation 读取 SLA 展示开关和生成统计；
 * 可见性直接复用 shared 运行时设置，生成统计由 apps/web late binding 注入。
 * 关键依赖：system-settings 运行时读取、UOL 注册表与 Zod 严格契约。
 */
import { z } from "zod";

import { getRuntimeSettingBoolean } from "../../system-settings/index";
import { defineOperation } from "../registry";

/** 首页可靠性只读操作不接受调用方参数。 */
const homepageReliabilityInputSchema = z.object({}).strict();

/** 首页 SLA 展示开关的最小公开输出契约。 */
export const homepageSlaVisibilityOutputSchema = z
  .object({ enabled: z.boolean() })
  .strict();

/** 首页生成 SLA 统计的严格公开输出契约。 */
export const homepageGenerationSlaStatsOutputSchema = z
  .object({
    sampleSize: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
    platformErrors: z.number().int().nonnegative(),
    moderationErrors: z.number().int().nonnegative(),
    userRequestErrors: z.number().int().nonnegative(),
  })
  .strict();

/** 首页 SLA 展示开关读取结果。 */
export type HomepageSlaVisibilityOutput = z.infer<
  typeof homepageSlaVisibilityOutputSchema
>;

/** 首页生成 SLA 统计读取结果。 */
export type HomepageGenerationSlaStatsOutput = z.infer<
  typeof homepageGenerationSlaStatsOutputSchema
>;

/**
 * 注册首页 SLA 展示开关读取操作。
 *
 * 仅允许站内 system Principal 调用且不投影为 Agent 工具；读取失败由运行时设置服务
 * 原样抛给 UOL 网关，调用方负责区块级降级。
 */
export const getHomepageSlaVisibility = defineOperation({
  name: "settings.getHomepageSlaVisibility",
  domain: "system-settings",
  title: "Get Homepage SLA Visibility",
  description: "读取官网首页是否展示可验证的生成 SLA 统计。",
  input: homepageReliabilityInputSchema,
  output: homepageSlaVisibilityOutputSchema,
  access: { kind: "system" },
  agentExposure: "human-only",
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  /**
   * 读取首页 SLA 展示开关。
   *
   * @param _input - 经 strict schema 校验的空对象，不接受调用方覆盖设置键或默认值。
   * @param _principal - 已由 UOL 网关验证的 system Principal，执行体不再重复鉴权。
   * @param _ctx - UOL 请求上下文；本读取不需要归属校验或回调。
   * @returns 仅含 enabled 布尔值的最小公开 DTO。
   * @sideEffects 读取运行时系统设置及其本地缓存，不写入设置或业务数据。
   * @failure 设置事实源不可用时原样抛出，由 UOL 网关稳定映射并交给首页局部降级。
   */
  async execute(_input, _principal, _ctx) {
    const enabled = await getRuntimeSettingBoolean(
      "MARKETING_SLA_STATUS_ENABLED",
      true
    );
    return { enabled };
  },
});

/**
 * 注册首页生成 SLA 统计读取操作。
 *
 * 仅允许站内 system Principal 调用且不投影为 Agent 工具；shared 不依赖 web 的生成
 * 查询服务，未绑定时由网关返回稳定的 not_implemented 错误。
 */
export const getHomepageGenerationSlaStats = defineOperation({
  name: "analytics.getHomepageGenerationSlaStats",
  domain: "analytics",
  title: "Get Homepage Generation SLA Stats",
  description: "读取官网首页展示所需的最近生成任务 SLA 聚合统计。",
  input: homepageReliabilityInputSchema,
  output: homepageGenerationSlaStatsOutputSchema,
  access: { kind: "system" },
  agentExposure: "human-only",
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  /**
   * 表示尚未注入的首页生成 SLA 统计执行体。
   *
   * @param _input - 经 strict schema 校验的空对象，统计窗口由 web binding 固定。
   * @param _principal - 已由 UOL 网关验证的 system Principal。
   * @param _ctx - UOL 请求上下文；真实只读 binding 当前不需要归属校验或回调。
   * @returns stub 不返回结果；web binding 替换后返回严格 SLA 统计 DTO。
   * @sideEffects stub 无副作用；真实 binding 执行只读生成记录聚合查询。
   * @failure 未完成 late binding 时，网关预检返回 not_implemented，直接执行 stub
   * 则抛出固定 Not yet wired 错误；真实查询或输出校验失败由调用方局部降级。
   */
  async execute(_input, _principal, _ctx) {
    throw new Error("Not yet wired: analytics.getHomepageGenerationSlaStats");
  },
});
