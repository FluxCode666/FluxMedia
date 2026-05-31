# Agent 集成架构设计：统一接口层 + MCP 对接 + 站内内置 Agent

- 文档日期：2026-05-31
- 状态：设计稿（待评审与分阶段落地）
- 关联盘点：`docs/plan/2026-05-31-feature-interface-inventory.md`（全功能接口盘点表）
- 关联审计：`docs/plan/2026-05-31-audit-report.md`

---

## 0. 摘要（TL;DR）

本设计把全站约 145 个业务操作（横跨 9 个域）收敛到一个**统一接口层（Unified Operation Layer，UOL / Operation Registry）**作为唯一事实源，并在其之上构建两个并列消费者：

- **MCP 对接层**：把每个注册操作自动生成为 MCP 工具，面向任意外部 agent（Claude Desktop / Codex / 第三方）。默认关闭，经系统设置/env 开启，用单一【MCP 管理秘钥】鉴权。
- **站内内置 Agent**：管理员发起、进程内**直连**接口层（不经 MCP）的 ReAct 工具循环智能体，用自然语言驱动站点运维。

三条核心决策：

1. **先接口化，再暴露**：所有功能必须先在统一接口层暴露为传输无关、类型化、声明式权限的 `OperationDefinition`，再由 MCP / 内置 Agent / 现有 UI server-action / v1 api-route / cron / webhook 作为薄传输适配器调用。
2. **MCP 可配置、默认关闭、管理秘钥鉴权**：MCP 仅是接口层之上的一个适配器，不是新的业务实现；它面向外部 agent，安全靠开关 + Bearer 管理秘钥 + 限流 + 审计 + 最小权限白名单。
3. **内置 Agent 直连接口层**：与 MCP 共享同一 registry、权限模型、幂等与审计装饰，但走进程内直调，省一层序列化与传输，并天然复用 session、`db.transaction`、进程内队列。

---

## 1. 背景与决策记录（ADR）

### 1.1 现状（取证自代码盘点）

- 几乎所有域的业务逻辑**已是 plain async service-fn**：入参为普通对象（POJO）、出参为普通对象、不依赖 next-safe-action / HTTP / React。例如 credits 域的 `grantCredits` / `consumeCredits`、image-generation 的 `runImageGenerationForUser`、image-backend-pool 的全部 `upsert*/delete*/list*/sync*`、system-settings 的 getter 族。
- 现有对外入口是**两套并存**：HTTP api-route（含 v1 外接 API 的 8 对双挂载路由）+ `next-safe-action` 的 server-action（`packages/shared/src/safe-action.ts`）。
- 存在**双实现漂移**：`/api/images/generate` 路由（全量 + 批量 + 流式）与 `generateImageAction`（仅 prompt/size/model）schema 不一致；`admin-users.ts`、`creem.ts` 在 `packages/shared` 与 `apps/web/src/features` 各有一份近似副本。
- 统一接口层 registry **当前尚不存在**（`Glob **/registry/**` 无结果），需与本设计同批构建。

### 1.2 关键不变量（不可破坏，全部取证自代码）

- **单一图像管线**：5 个 v1 handler + 3 个 web 路由全部汇入 `runImageGenerationForUser`（`apps/web/src/features/image-generation/operations.ts:865`）。单点改 operations.ts 即覆盖全部生图路径。
- **财务真相在 `credits_transaction`**（双重记账），非 generation 行。扣费幂等键 per-user 偏唯一索引 `(user_id, type, source_ref)`（迁移 0029）；发放/退款幂等键 `credits_batch(source_type, source_ref)`（迁移 0025）。
- **套餐能力矩阵**：`plan-capabilities.ts` 的 `getPlanCapabilitySnapshot` / `canUsePlanCapability` 是能力判定唯一来源。
- **角色层级**：`APP_USER_ROLES` 升序、`canActOnTargetRole` / `assertCanActOnTarget` 目标护栏、`getUserRoleById` 授权链根（含 local admin 惰性提权写副作用）。
- **审计**：`adminAuditLog` 表 + `writeAdminAuditLog`（含 before/after/reason/metadata）。
- **鉴权标准**：`timingSafeEqual` 恒定时间比对（cron / moderation proxy / external-api / 支付验签四处同标准）。
- **system-settings 为运行时配置真相源**：DB→env→default；secret 键读路径脱敏（displayValue 空串）、写路径空串=不改。
- **进程内可变全局态**：`withImageGenerationQueue`、`backendInflight` Map、async-image-tasks Map、`responseContinuationCache`、settings 10s 内存缓存——多实例不共享，水平扩展会退化。

### 1.3 决策

- **D1**：引入统一接口层 `packages/shared/src/uol/`（Operation Registry）。每个操作 = 一个 `defineOperation()`，携带 Zod 输入 schema、输出类型、声明式权限/能力、只读/破坏性标志、副作用与幂等声明、传输无关 `execute(input, principal, ctx)`。
- **D2**：现有 server-action / api-route 渐进退化为薄传输适配器，只做"解析请求 → 构造 Principal → `invokeOperation(name, input, principal)` → 编码响应"，实现单点鉴权/能力/审计/幂等/错误映射。
- **D3**：MCP 对接层作为 registry 的第一个外部消费者，默认关闭，管理秘钥鉴权。
- **D4**：站内内置 Agent 作为 registry 的第二个消费者，进程内直连，不经 MCP。
- **D5**：财务/存储/审核等高风险操作的接口化**最后做**，且必须先补幂等键与单测。

### 1.4 三者关系图

```
              ┌──────────────────────────────────────────────────────────────┐
              │        统一接口层 UOL / Operation Registry（单一事实源）       │
              │  OperationDefinition[]: name/input(zod)/output/access/         │
              │  capabilities/readOnly/destructive/idempotency/sideEffects/    │
              │  execute(input, principal, ctx)                                │
              │  共享: Principal 解析 / 能力矩阵 / 幂等键 / writeAdminAuditLog  │
              │        / 目标护栏 / 领域错误→OperationError 映射               │
              └───┬───────────┬───────────┬───────────┬───────────┬───────────┘
       直连(进程内)│   委托     │   委托     │   委托     │   验签     │ Bearer
      ┌───────────▼┐ ┌────────▼─┐ ┌───────▼──┐ ┌──────▼───┐ ┌─────▼────────┐
      │ 站内内置    │ │ UI       │ │ v1       │ │ webhook  │ │ MCP 对接层    │
      │ Agent       │ │ server-  │ │ api-     │ │ creem/   │ │ (可配置开关,  │
      │ (本设计)    │ │ action   │ │ route    │ │ epay/    │ │ 管理秘钥)     │
      │             │ │ (薄壳)   │ │ (薄壳)   │ │ cron     │ │  ▲ 外部 agent │
      └─────────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘
            │                                                        │
            └──── 进程内直调，不经 MCP；与 MCP 共享 registry ◄───────┘
```

要点：内置 Agent 与 MCP 是 registry 的**两个并列消费者**，差异仅在传输与 actor 解析（内置 = Next session；MCP = 管理秘钥 → 绑定系统主体），**权限/审计/幂等/能力模型完全一致**——这是把安全不变量集中到一处的核心收益。

---

## 2. 统一接口层（UOL）设计

### 2.1 设计目标与约束对齐

目标：所有 caller（MCP server、内置 Agent、UI server-action、v1 api-route、cron、webhook）通过同一个类型化、传输无关入口调用业务能力，单点完成鉴权、能力校验、审计、幂等、错误映射。

严格对齐的既有事实（§1.2）不重写、不另起一套：能力校验复用 `plan-capabilities.ts`；幂等键复用现有 DB 唯一索引；财务真相只在 `credits_transaction`；role 判定复用 roles.ts 纯函数。

非目标（写入约束而非强行解决）：进程内可变全局态不在本层解决，仅在元数据上标注 `processLocalState: true`，多实例水平扩展属后续基础设施工作（迁 Redis/DB）。

### 2.2 接口契约：OperationDefinition

```ts
// packages/shared/src/uol/types.ts
export type AccessRequirement =
  | { kind: "public" }
  | { kind: "protected" }                          // 任意登录用户
  | { kind: "owner"; resource: string }            // 资源归属校验（防 IDOR），execute 内复核
  | { kind: "admin" }                              // canAccessAdminArea
  | { kind: "superAdmin" }                         // canManageUserPermissions
  | { kind: "imageBackendPoolViewer" }             // canViewImageBackendPool
  | { kind: "apiKey"; planCapability?: string }    // v1 external-api：Bearer key + 可选能力位
  | { kind: "cron" }                               // CRON_SECRET 恒定时间比对
  | { kind: "webhook"; provider: "creem" | "epay" }// 外部验签
  | { kind: "proxySecret" }                        // moderation /moderate 密钥体系
  | { kind: "system" };                            // 启动期/内部维护，禁止经任何外部传输暴露

export type CapabilityRequirement =
  | { capability: string }                         // 静态能力位
  | { derive: (input: unknown) => string[] };      // 动态（count>1→batch, stream→streaming 等）

export interface OperationDefinition<I, O> {
  name: string;                       // 点分命名空间：domain.operation，如 "credits.grant"
  domain: OperationDomain;            // 9 域枚举
  title: string;
  description: string;                // 供 MCP/agent 展示
  input: z.ZodType<I>;                // 单一 schema，去除 camel/snake 双命名歧义
  output: z.ZodType<O>;
  access: AccessRequirement;
  capabilities?: CapabilityRequirement[];
  readOnly: boolean;                  // 语义只读（GET 友好 / MCP readOnlyHint）
  destructive: boolean;               // 不可逆/铸币/删除（MCP destructiveHint，agent 需确认）
  idempotency: IdempotencySpec;
  sideEffects: SideEffect[];          // billing/email/storage/external-call/cache
  processLocalState?: boolean;        // 依赖进程内可变态，多实例语义退化
  execute: (input: I, principal: Principal, ctx: OperationContext) => Promise<O>;
}

export type IdempotencySpec =
  | { kind: "natural" }                                      // 覆盖写/容忍重复
  | { kind: "none" }                                         // 重复会产生副本（调用方注意）
  | { kind: "required"; keyField: string; scope: "per-user" | "global" };
```

要点：

- `idempotency.required` 把当前散落的 `sourceRef` 约定上升为契约。`credits.grant` 声明 `{kind:'required', keyField:'sourceRef', scope:'global'}`（对应 `credits_batch` 唯一索引），`credits.consume` 声明 `scope:'per-user'`（对应 0029）。盘点暴露的缺口（`useCredits`/`adminAdjustCredits`/`adminGrantCredits` 当前未传或用时间戳 sourceRef）在 UOL 中被 schema 强制要求，无法绕过。
- `derive` 解决 `count>1 → imageGeneration.batch`、`stream → externalApi.streaming` 等动态能力位，逻辑从 route.ts 下沉到 definition，单点维护。

### 2.3 身份/主体模型：Principal

调用方必须**显式声明"以谁的身份执行"**，取代 next-safe-action 的隐式 `ctx.userId`：

```ts
export type Principal =
  | { type: "user"; userId: string; role: UserRole }
  | { type: "apiKey"; userId: string; apiKeyId: string; plan: PlanType; relayOnly: boolean }
  | { type: "system"; reason: string }            // bootstrap/维护，禁外部暴露
  | { type: "cron"; job: string }
  | { type: "webhook"; provider: "creem" | "epay" }
  | { type: "proxy"; secretKind: "proxy" | "gateway" };
```

- `invokeOperation` 接收**已构造的** Principal，**不自己读 headers/cookie**。这使同一操作可被 MCP（平台预绑定的 user Principal）、内置 Agent（发起管理员 Principal）、UI action（session Principal）调用，行为一致。
- 鉴权发生在各传输适配器的 `PrincipalResolver`：`fromSession`（复用 `auth.api.getSession` + `getUserRoleById`）、`fromBearer`（复用 `authenticateExternalApiRequest`）、`fromCronSecret`（`timingSafeEqual(CRON_SECRET)`）、`fromWebhook`（复用 creem HMAC / epay MD5）。
- 归属类（`owner`）细粒度校验保留在 `execute` 内（需查 DB），UOL 提供 `ctx.assertOwnership(resource, ownerId)` 统一错误码。
- `system` Principal 在网关层被硬性拒绝来自任何外部传输（MCP/HTTP），仅 instrumentation/scheduled-jobs 进程内可构造（对应 `bootstrapSelfUseSuperAdmin`、`getUserRoleById` 惰性提权等不可外暴露的操作）。

### 2.4 统一错误契约

领域错误（业务可预期、结构化、可映射）与系统错误（不可预期、脱敏）分离：

```ts
export class OperationError extends Error {
  constructor(
    readonly code: OperationErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly httpStatus = 400,
  ) { super(message); }
}
export type OperationErrorCode =
  | "unauthenticated" | "forbidden" | "capability_required"
  | "not_found" | "ownership_violation"
  | "insufficient_credits" | "account_frozen" | "quota_exceeded"
  | "validation_error" | "idempotency_conflict"
  | "rate_limited" | "upstream_error" | "moderation_blocked";
```

适配：现有 `InsufficientCreditsError(required, available)` / `AccountFrozenError(userId)` 在 `execute` 边界由 UOL 统一 catch 转结构化错误码（复刻 `useCredits` 当前行为但去重）。能力位不足 → `capability_required`，取代各路由各自抛的中文字符串。**moderation 安全关键**：`ModerationResult.decision==='error'` 必须透传为 `moderation_blocked` 或显式 decision，传输层禁止吞掉。未捕获异常 → 系统错误，生产脱敏为 `internal_error` + `logError`/`captureError`。

### 2.5 中央注册表 Registry 与枚举

```ts
const REGISTRY = new Map<string, OperationDefinition<any, any>>();
export function defineOperation<I, O>(def: OperationDefinition<I, O>) {
  if (REGISTRY.has(def.name)) throw new Error(`duplicate operation: ${def.name}`);
  REGISTRY.set(def.name, def); return def;
}
export function getOperation(name: string) { return REGISTRY.get(name); }
export function listOperations(filter?) { /* … */ }
// MCP 工具清单自动生成：readOnly→readOnlyHint, destructive→destructiveHint, zod→JSON Schema
export function toMcpToolManifest(p: Principal) { /* 仅暴露该主体可达的操作 */ }
```

- 注册按域分文件：`uol/operations/credits.ts` 等，每域一个文件 `defineOperation(...)` 引用对应 service-fn；`operations/index.ts` 汇总 import（确保注册副作用执行）。
- 内置 Agent 通过 `listOperations` 发现能力；MCP 通过 `toMcpToolManifest(principal)` 自动生成工具，主体不可达的操作不出现（最小暴露面）。
- registry 同时是文档真相源，可生成操作目录与权限矩阵，满足可追溯/可验证要求。

### 2.6 invokeOperation 网关：单点鉴权/能力/审计/幂等

```ts
export async function invokeOperation<I, O>(
  name: string, rawInput: unknown, principal: Principal,
  opts?: { idempotencyKey?: string },
): Promise<O> {
  const def = getOperation(name);
  if (!def) throw new OperationError("not_found", `unknown operation: ${name}`, undefined, 404);
  assertAccess(def.access, principal);              // 1) 权限：声明式断言
  const input = def.input.parse(rawInput);          // 2) 输入校验（单一 schema）
  if (def.capabilities) await assertCapabilities(def.capabilities, input, principal); // 3) 能力矩阵
  if (def.idempotency.kind === "required") assertIdempotencyKey(def.idempotency, input); // 4) 幂等
  const ctx = buildContext(principal);
  try {
    const out = await def.execute(input, principal, ctx);   // 5) 执行
    audit({ name, principal, success: true, readOnly: def.readOnly });
    return out;
  } catch (e) { throw mapToOperationError(e); }
}
```

- **审计**：`destructive` 或 admin/superAdmin 操作自动写 `writeAdminAuditLog`（从各 action 末尾上移到网关，统一记录 actor=principal）。
- **`revalidatePath` 等 Next 缓存副作用不进 UOL**（表现层关注点）；UI 适配器在返回后自行 revalidate。
- **事务边界**：底层 service 自带 `db.transaction`，UOL **不**再包外层事务（避免嵌套）。
- **幂等真相**仍由底层 DB 唯一索引兜底，网关 `sourceRef` 强制只是"提前失败"，不在此层造第二记账。

### 2.7 接口签名示例

```ts
// credits 域 —— 直接委托既有 core.ts
defineOperation({
  name: "credits.grant", domain: "credits", title: "发放积分",
  input: z.object({ userId: z.string(), amount: z.number().positive(),
    sourceType: z.enum(["bonus","subscription","purchase","manual"]),
    sourceRef: z.string().min(1) /* 强制幂等键，修复盘点缺口 */ }),
  output: z.object({ batchId: z.string(), balance: z.number() }),
  access: { kind: "admin" }, readOnly: false, destructive: true,
  idempotency: { kind: "required", keyField: "sourceRef", scope: "global" },
  sideEffects: ["billing"], execute: (i) => grantCredits(i),
});

// image-generation 域 —— 复用单一管线
defineOperation({
  name: "image.generate", domain: "image-generation", title: "图像生成",
  input: runImageGenerationInputSchema,    // 收敛 route 与 action 的双 schema
  output: imageGenerationOperationResultSchema,
  access: { kind: "protected" },           // apiKey 主体走同一 def
  capabilities: [{ derive: (i) => deriveImageCaps(i) }], // count>1→batch, stream→streaming
  readOnly: false, destructive: false,
  idempotency: { kind: "required", keyField: "generationId", scope: "per-user" },
  sideEffects: ["billing","storage","external-call"], processLocalState: true,
  execute: (i, p, ctx) => runImageGenerationForUser(
    { ...i, userId: p.userId, relayOnly: p.type==="apiKey" && p.relayOnly }, ctx.callbacks),
});

// support 域 —— 当前无 service 层，需先下沉
defineOperation({
  name: "ticket.create", domain: "support", title: "创建工单",
  input: z.object({ subject: z.string(), message: z.string(), clientRequestId: z.string().optional() }),
  output: z.object({ ticketId: z.string() }),
  access: { kind: "protected" }, readOnly: false, destructive: false,
  idempotency: { kind: "required", keyField: "clientRequestId", scope: "per-user" },
  sideEffects: ["email"], execute: (i, p) => createTicketService({ ...i, userId: p.userId }),
});
```

流式处理：`OperationContext.callbacks` 承载既有 `ImageGenerationCallbacks`（onPartialImage/onTextDelta…）。SSE 适配器、收集器适配器（MCP/agent 收集完整结果）、keepalive 适配器各自实现 callbacks，内核不变（callbacks 已是干净抽象）。

### 2.8 与现有 action 的委托关系

以最具财务风险的 `credits.grant` 为例，展示同一操作经不同传输入口的一致路径：

```
[UI]    adminGrantCreditsAction → principal=fromSession() → invokeOperation("credits.grant", …) → revalidatePath
[MCP]   mcp.callTool("credits.grant") → 平台 admin Principal → invokeOperation(…)
[webhook] creem 验签 → {type:webhook} → invokeOperation("credits.grant",{sourceRef:`credit_purchase:${orderId}`,…})

invokeOperation 内部（单点）：
 assertAccess → input.parse(缺 sourceRef→validation_error) → 护栏(禁止自发+assertCanActOnTarget)
 → grantCredits(db.transaction: credits_batch 唯一索引兜底幂等 + credits_transaction 双重记账 + credits_balance)
 → 重复 sourceRef → idempotency_conflict（幂等返回既有结果）
 → writeAdminAuditLog(actor=principal) → 返回 {batchId, balance}
```

关键不变量：财务真相只在 `credits_transaction`+`credits_batch`，UOL 不引入第二记账；三入口共享同一 `grantCredits`，消除 packages/shared 与 apps/web 双副本漂移（统一以 packages/shared 为权威，apps/web 旧镜像删除并改为 re-export 或委托）。

---

## 3. MCP 对接层设计

### 3.1 前置假设

MCP 层**不直接调 service-fn**，而是调统一 registry 暴露的 operation。它尊重所有接口层约束（不再包外层事务、强制幂等键、relayOnly/脱敏/SSRF 由内核保证、绝不转发客户端凭据）。

### 3.2 形态选择：HTTP/SSE（主）+ stdio（辅）

两种 transport 共享同一 **MCP server 核心**（`packages/shared/src/mcp/server.ts`，仅依赖 registry + 鉴权 + 审计，transport 无关）。

- **形态 A — 远程 HTTP（Streamable HTTP / SSE）默认主形态**：挂载为 Next.js App Router 路由 `apps/web/src/app/api/mcp/route.ts`（POST=JSON-RPC，GET=SSE 单端点），复用现有 Docker web 容器与 Nginx，**无需新增端口/容器**。用 `@modelcontextprotocol/sdk` 的 Streamable HTTP transport（优先 2025 单端点，保留 SSE 回退）。复用 `withApiLogging` + Pino。
- **形态 B — 本地 stdio**：独立 bin `gpt2image-mcp`（`apps/web/src/server/mcp/stdio-entry.ts`），连同一 DB、同一 registry。本机受信进程，秘钥经 env `MCP_ADMIN_SECRET` 启动校验，仍走同一 actor 解析与审计。

为何 HTTP 为主：现状是 Docker Compose + Nginx + Certbot（**非 Vercel**，无 serverless 冷启动），web 是长驻 Node 进程，把 MCP 挂进同进程能直接复用 DB 连接池、settings 缓存与 registry，零额外编排。

### 3.3 从 registry 自动生成工具

工具名用 `operation.name`（点号 → 下划线，满足 `^[a-zA-Z0-9_-]+$`）；description 拼 title + 语义注解；inputSchema 由 Zod → JSON Schema；破坏性/只读元数据写入 MCP `annotations`。

```ts
export function buildToolsFromRegistry(ops, actor, cfg) {
  return ops
    .filter((op) => actorCanInvoke(actor, op.permission))          // 最小权限
    .filter((op) => !(cfg.readOnlyMode && !op.readOnly))           // 只读模式过滤
    .filter((op) => !cfg.deniedOps.includes(op.id))                // 全局屏蔽极危操作
    .map((op) => {
      let schema = zodToJsonSchema(op.inputSchema);
      if (op.destructive && op.idempotencyKeyParam == null)
        schema = injectRequiredProp(schema, "idempotencyKey", { type:"string", minLength:8 });
      if (op.destructive && cfg.requireConfirmForDestructive)
        schema = injectRequiredProp(schema, "confirm", { const:`CONFIRM:${op.id}` });
      return { name: op.id.replace(/\./g,"_"), description: buildDescription(op),
        inputSchema: schema,
        annotations: { readOnlyHint: op.readOnly, destructiveHint: op.destructive,
          idempotentHint: op.idempotencyKeyParam != null,
          openWorldHint: op.domain === "image-generation" } };
    });
}
```

`tools/call` 分发在 server 核心：二次复核权限（防 list 与 call 间配置变更）、限流（按 actor 指纹 + 操作维度）、破坏性二次确认、Zod 校验、三段式审计（start/success/failure）、领域错误 → 结构化错误码（绝不透传 DB/约束细节）。参数摘要与结果必须脱敏（secret/accessToken/明文 key）。

### 3.4 管理秘钥鉴权

复用全仓【恒定时间比对】标准（`secretMatchesAny`）：

- 秘钥来源（env 与 system-settings 双通道，env 优先）：`MCP_ADMIN_SECRET`（全权 → superAdmin actor）；可选 `MCP_SCOPED_TOKENS`（受限范围 token，映射受限 actor）。
- 传输：HTTP `Authorization: Bearer <secret>`。校验恒定时间；**未配置任何秘钥 → fail-closed 全部 401**（对齐 moderate route）。
- actor 绑定真实 userId（superAdmin → bootstrap 超管；scoped → 配置指定低权用户），使所有下游归属校验/审计/revalidate 链路自然成立——MCP 不发明新主体类型，复用现有角色体系。
- `actorCanInvoke` = 角色门槛（复用 roles.ts 纯函数）+ 受限范围白名单（scope 只读则阻断写操作）。
- **绝不把 MCP 请求里的 Authorization/Cookie 透传到任何上游**（OpenAI OAuth、Sub2API、审核代理）——上游凭据来自 system-settings，与 MCP 主体凭据物理隔离。

### 3.5 安全：标注/二次确认/审计/限流/最小权限

- **破坏性标注 + 二次确认**：destructive op（扣费/铸币/删除/封禁/套餐覆盖/冻结）双重标注 `destructiveHint`；`MCP_REQUIRE_CONFIRM`（默认 true）时注入必填 `confirm: const "CONFIRM:<opId>"`，迫使 agent 精确二次确认。
- **审计**：复用 `writeAdminAuditLog`，`source="mcp"`，记 actorUserId/role/kind、`secretFingerprint`（sha256 前 12 位，**绝不存明文**）、opId、参数摘要（脱敏）、结果状态/耗时/错误码。start/success/failure 三段式。
- **限流**：复用 `rate-limit` 桶，新增 'mcp' 桶按 `fingerprint + opDomain`；破坏性 op 更严桶。Redis 未配置时降级进程内令牌桶（单实例有效，文档标注）。
- **最小权限**：默认 superAdmin 全权仅供受信运维；生产推荐 scoped token + readOnly。`MCP_DENIED_OPS` 永久屏蔽极危操作（bootstrap、adminAdjustCredits 的 set 模式、setUserPassword）即便 superAdmin 也不暴露。`MCP_READONLY_MODE` 一键只暴露只读工具。

### 3.6 可配置开关（默认关闭）

```ts
export async function isMcpEnabled(): Promise<boolean> {
  if (process.env.MCP_ENABLED != null) return process.env.MCP_ENABLED === "true";
  return getRuntimeSettingBoolean("MCP_ENABLED", false);
}
```

关闭语义（严格）：HTTP 路由 disabled → **返回 404**（不暴露端点存在性，不创建 server、不注册工具）；stdio bin disabled → 启动退出；即便 enabled，未配秘钥 → fail-closed 401。开关变更经 `clearSystemSettingsCache()`（10s 缓存）下次请求即生效，无需重启。

### 3.7 配置项清单（新增 system-settings 键）

> 强约束：新增 setting 键须同步 `SettingKey` 联合类型、`SETTING_DEFINITIONS` 数组、`isSettingKey/SETTING_DEFINITION_BY_KEY`，以及 `system-settings-panel.tsx`，否则 plan-capabilities/同步测试失败。建议新增 `SettingCategory "mcp"`。

| key | valueType | secret | default | 说明 |
|---|---|---|---|---|
| `MCP_ENABLED` | boolean | - | false | MCP 总开关（默认关） |
| `MCP_ADMIN_SECRET` | string | true | (空) | 全权管理秘钥；空=fail-closed |
| `MCP_SCOPED_TOKENS` | json | true | [] | 受限 token 列表 |
| `MCP_REQUIRE_CONFIRM` | boolean | - | true | 破坏性工具需 confirm 常量 |
| `MCP_READONLY_MODE` | boolean | - | false | 仅暴露只读工具 |
| `MCP_DENIED_OPS` | json | - | [bootstrap,credits.adminAdjustSet,user.setPassword] | 永久屏蔽 op |
| `MCP_ALLOWED_DOMAINS` | json | - | [] (空=全部) | 域级白名单 |
| `MCP_RATE_LIMIT_PER_MIN` | number | - | 60 | 每 actor 每分钟工具调用上限 |
| `MCP_DESTRUCTIVE_RATE_LIMIT_PER_MIN` | number | - | 10 | 破坏性工具更严限流 |
| `MCP_TRANSPORT` | select | - | http | http \| sse \| both |

env 等价键（部署期硬覆盖，优先 DB）：`MCP_ENABLED`、`MCP_ADMIN_SECRET`、`MCP_SCOPED_TOKENS`。

### 3.8 部署（与现有 Docker/Nginx 关系）

- **远程 HTTP（主）零新增容器**：`/api/mcp` 随 web 镜像构建，复用 web 服务、Nginx vhost、Certbot 证书。Nginx 仅需确保 `/api/mcp` 走同一 upstream（默认已覆盖）；可选加 `location /api/mcp { ... }` 做 IP 白名单/限流加固。不暴露新端口。
- **本地 stdio（辅）**：产出 `gpt2image-mcp` bin，运维本机/受信网络内启动，不进 compose 常驻。
- **多实例水平扩展注意**（继承现状）：进程内 Map 在多副本不共享。生产建议 MCP 流量定向单一副本（Nginx upstream sticky），或 Redis 就绪后把限流桶切 Redis。

### 3.9 实施落点

新增 `packages/shared/src/mcp/`：`config.ts`、`auth.ts`、`tool-factory.ts`、`server.ts`、`audit.ts`、`redact.ts`。新增 `apps/web/src/app/api/mcp/route.ts`、`apps/web/src/server/mcp/stdio-entry.ts`。修改 `definitions.ts`、`system-settings-panel.tsx`、`packages/shared/package.json`（exports `./mcp`，依赖 `@modelcontextprotocol/sdk`、`zod-to-json-schema`）。必须 DB-free 单测：`redact.test.ts`、`auth.test.ts`、`tool-factory.test.ts`、`config.test.ts`。

---

## 4. 站内内置 Agent 设计

### 4.1 定位

统一接口层有两个并列消费者：MCP server（外部 agent 经 stdio/HTTP-MCP 接入）与站内内置 Agent（**进程内直连 registry，不经 MCP**，省一层序列化与传输）。内置 Agent 优势：与 Next.js 同进程，直接拿 `auth.api.getSession()` 解析的 actor、复用 `db.transaction`、复用进程内队列。

### 4.2 总体架构（7 层）

```
[UI: /dashboard/admin/agent]  ← Server Component 壳 + Client 聊天面板(SSE)
        │  POST /api/admin/agent/sessions/[id]/turn (SSE)
        ▼
[1] Agent Orchestrator (loop runner)   ← ReAct 循环，stop/步数/预算/interrupt 恢复
[2] Planner (可选，计划模式)            ← 高影响任务先产计划，人确认后执行
[3] LLM Adapter                         ← Claude tool-use，prompt caching，流式
[4] Tool Registry Bridge                ← registry operation 投影成 LLM tools（单一事实源）
[5] Approval Gate (interrupt)           ← 危险操作阻塞，等管理员裁决
[6] Operation Executor                  ← registry.invoke(opId, input, actorCtx)
        │           ▲ 共享
        └─── [统一接口层 Registry] ───── MCP server (并列 consumer)
[7] Session Store + Context Manager + Audit ← 会话/记忆/裁剪/写 adminAuditLog
```

### 4.3 工具集 = Registry 投影（Tool Bridge）

Agent **不手写工具**，从 registry 读 operation 元数据，`zodToJsonSchema` 生成 tool schema，新增 operation 自动可用（经能力过滤）。

```ts
function buildAgentTools(actor: ActorCtx): LlmTool[] {
  return registry.list()
    .filter(op => canActorSeeOperation(actor, op.permission))     // 能力预过滤，减少越权尝试
    .filter(op => !op.permission.systemOnly)                       // 排除 system/startup 危险面
    .map(op => ({ name: op.id.replace(/\./g, "__"),
      description: `${op.description}${op.readOnly ? "" : " [写操作]"}`,
      input_schema: zodToJsonSchema(op.input) }));
}
```

初期工具白名单（按域，优先暴露运维高频且已干净的 service-fn）：

- credits：`getCreditsBalance`/`getUserTransactions`（读）、`adminGrantCredits`（sensitive）、`adminAdjustCredits`（destructive,superAdmin）、`setUserCreditsStatus`
- user-auth：`listUsers`/`getUserDetail`（读）、`banUser`（sensitive）、`setUserPlan`（destructive）、`updateUserRole`（destructive,superAdmin）
- support：`getAllTickets`/`getAdminTicketDetail`（读）、`adminReplyTicket`（sensitive）、`updateTicketStatus`、公告 CRUD
- image-backend-pool：`getAdminImageBackendPool`（读）、`refreshImageBackendAccountInfo`、`bulkUpdateImageBackendAccounts`（sensitive）、Sub2API `runManualSync`
- system-settings：`getAdminSettingsSnapshot`（读，**secret 已脱敏**）、`updateSystemSettings`（destructive,superAdmin）
- image-generation/external-api：**只读优先**（`getGenerationStats`/`getExternalApiKeys`）；生图本身默认不放进运维 Agent（避免代刷）

### 4.4 身份与权限（继承发起者权限）

执行主体 = 已登录管理员；Agent **以该管理员身份执行**，不引入独立 service account。`ActorCtx` 在 turn 入口一次性解析（`auth.api.getSession` + 封禁复查 + `getUserRoleById`），贯穿全循环，标记 `via:"builtin-agent"`。

权限继承 = **能力收敛，而非提权**：Bridge 按 actor.role 预过滤工具（observer_admin 只读、admin 普通、super_admin 全量），Executor 再次硬校验（纵深防御）。对作用于他人账户的写操作，Executor 调用前执行 `assertCanActOnTarget`；保留 `adminGrantCredits` 的"禁止给自己发"护栏。

审计：每个写 operation 复用 `writeAdminAuditLog` 写 `adminAuditLog`，`action: agent.${op.id}`、`metadata.channel: "builtin-agent"` + agentSessionId/llmTurnId/idempotencyKey/planStepId/approvalReason，与人工后台操作进同一审计流。

### 4.5 危险操作审批门 + 沙箱边界

三档 dangerLevel：

| 档 | 判定 | 默认策略 |
|---|---|---|
| safe | readOnly=true 查询 | 自动执行 |
| sensitive | 写且可逆/影响有限 | 需管理员确认；可设"本会话自动批准 sensitive" |
| destructive | 不可逆/铸币扣费/全局配置 | **强制逐次人审**，不可整会话豁免 |

审批门 = 循环 interrupt：模型请求危险 tool → Executor 预检 → 发 SSE `approval_required`（含目标脱敏邮箱/语义/before-after diff/不可逆标记）→ 循环挂起（持久化 pending interrupt）→ 管理员 POST `/approve` → 批准则执行+审计，拒绝则把"用户拒绝"作为 tool_result 回模型改道。

沙箱 7 条硬边界：① 只能调 registry operation（无 SQL/shell/文件/任意 fetch）；② 角色天花板（Bridge 过滤 + Executor 硬校验 + assertCanActOnTarget）；③ systemOnly 排除（bootstrap/env 同步/cron）；④ secret 不外泄（只暴露已脱敏 snapshot，禁 raw getter）；⑤ 幂等强制（`agent:{sessionId}:{turnId}:{toolCallId}` 透传 sourceRef）；⑥ 资源预算（单 turn ≤25 工具调用、token 预算、写次数上限、超时）；⑦ 进程态约束（内置 Agent 与 Next **同进程运行**，天然共享队列/inflight 等单进程态）。

### 4.6 上下文与记忆

会话持久化（新增表，与 support 工单同风格）：`agent_session`、`agent_message`；审计经现有 `adminAuditLog`（channel=builtin-agent）关联，不另起表。

上下文构成（每 turn 组装）：① System prompt（稳定可 cache：运维者人设 + 安全准则 + actor role + 工具摘要）；② 工具定义（稳定可 cache）；③ 运维事实注入（按需注入待处理工单数等，降低盲查往返）；④ 会话历史（裁剪，destructive 审批记录不裁剪）；⑤ 长期记忆（只读注入 `docs/MEMORY.md`；写长期记忆作为显式 sensitive operation 经审批）。

只读副作用陷阱（取证）：`getCreditsBalance`/`getUserGenerations`/`getUserRoleById` 等"读中带写"，Bridge 以**业务语义**判 readOnly，仍归 safe，但元数据注 `hasMaintenanceWrite:true` 供审计透明。

### 4.7 工具循环（ReAct + 计划模式 + interrupt）要点

(a) 循环唯一副作用出口是 `registry.invoke`，与 MCP 共用；(b) interrupt 通过持久化 pending 状态 + 第二个 HTTP 端点 `/approve` 恢复，不阻塞 Node 事件循环；(c) Zod schema、错误映射、审计、幂等、目标护栏全部复用既有实现，Agent 层不重写业务。纵深校验：工具名/角色/目标护栏在 Executor 二次硬校验（防模型臆造工具名）。

### 4.8 借鉴对比

- **Claude Code**：工具 + 三档权限（ask/allow/deny）、Plan Mode、`accept-edits` 会话级豁免 → 三档 dangerLevel + 计划模式 + "本会话自动批准 sensitive"（destructive 不可豁免）。
- **Codex**：沙箱 + 审批分级（read-only/workspace-write/danger-full-access），网络默认禁 → 无 shell/SQL/任意网络的"registry-only 沙箱" + 按 dangerLevel 分级审批。
- **opencode**：provider 无关、工具循环与模型解耦、工具集即配置 → LLM Adapter 抽象 + Tool Bridge 自动生成，新增 operation 零改 Agent。
- **openclaw**：自治多步 + 护栏可中断 → 多步 ReAct + 步数/预算上限 + interrupt 随时人工介入。

### 4.9 UI 集成

入口 `apps/web/src/app/[locale]/(dashboard)/dashboard/admin/agent/page.tsx`（与 admin/users、admin/settings 同级，受 admin 布局守卫；observer_admin 仅得只读工具集）。流式输出复用项目 SSE 模式（参考 `createImageStreamResponse`），事件类型：`text`/`tool_call`/`tool_result`/`plan`/`approval_required`/`final`/`aborted`。人审介入：面板内联渲染 `approval_required` 卡片（目标/语义/before-after diff/不可逆标记/理由输入框），按钮 [批准]/[批准并记录理由]/[拒绝]，POST `/approve` 恢复挂起 turn。可观测：每个高敏操作一键跳 `adminAuditLog` 对应记录，UI→审计闭环。

---

## 5. 分阶段实现路线图

原则：每阶段独立可验证（typecheck + 既有单测 + 行为回归），UOL 与旧路径并存，适配器是唯一改动点，可单独 revert。验收门：**旧 action 输出 == invokeOperation 输出**，杜绝行为漂移。按"风险低/价值高先行、财务与存储后置"排序。

### 阶段 0 — 接口层脚手架（零行为变更）

新增 `packages/shared/src/uol/{types,principal,errors,registry,invoke}.ts` 与空 `operations/`。`PrincipalResolver` 复用现有 `getSession`/`getUserRoleById`/`authenticateExternalApiRequest`/验签。无任何现有代码改动。**可独立测试**：registry 注册/枚举、assertAccess、错误映射单测。

### 阶段 1 — 已干净的 service-fn 直接注册（低风险，高覆盖）

把盘点确认"入参 POJO、无 ctx 耦合"的 service-fn 写 `defineOperation` 薄包装，service 零改动：credits 全套、subscription 能力矩阵族、image-backend-pool 全部 service-fn、system-settings getter 族、storage provider 方法、moderation `moderateContent`、image-generation `runImageGenerationForUser`。补网关鉴权/能力/错误映射单测。**优先**：只读查询族（balance/transactions/listUsers/snapshot）先注册并验证循环。

### 阶段 2 — server-action 改为委托（去重，逐个对拍）

`actions.ts` 系列改为 `principal=fromSession(); return invokeOperation(name, input, principal)` + 末尾 `revalidatePath`。每迁一个断言新旧返回形态一致。**收敛双 schema**：image.generate 以 route 全量 schema 为准，`generateImageAction` 改委托同一 def。同步删除 admin-users/creem 重复副本（packages/shared 为权威）。

### 阶段 3 — 内置 Agent 与 MCP 适配器（价值兑现）

- 实现 Bridge + Executor（幂等/审计/目标护栏），只读工具优先上线验证循环 → 加审批门 + interrupt + UI → 加计划模式与上下文裁剪。
- MCP：实现 `mcp/` 全套 + `/api/mcp` 路由 + stdio bin + system-settings 新键 + 面板。默认关闭，DB-free 单测先行。
- 两者均依赖阶段 1/2 已注册的 operation，**只读能力先可用**，写能力随阶段 4/5 逐步放开。

### 阶段 4 — v1 api-route 改为薄适配器

v1 的 8 对路由退化为"解析 → fromBearer → invokeOperation → 编码（SSE/JSON/keepalive）"。multipart/formData 解析、`filesToImageInputs`、SSRF 校验抽成传输无关的输入构建器（File/Buffer 入参），供 HTTP 与非 HTTP 复用。

### 阶段 5 — 缺 service 层的域补齐 + 财务/存储谨慎收尾

- support/tickets 业务逻辑下沉为 `createTicketService` 等参数化 service-fn，再由 action 与 UOL 共用；补幂等键（clientRequestId 唯一索引）与事务（create+update 当前非原子）。
- **财务谨慎项**（必须最后、必须先补幂等键与单测）：`useCredits`/`adminGrantCredits`/`adminAdjustCredits` 强制 sourceRef；`adminAdjustCredits` set 模式 TOCTOU 竞态处理；`reportImageBackendResult` 补断言/单测（审计 C-M9/C-M11）。
- **存储谨慎项**：两套并存存储栈（shared provider 抽象 vs `upload/presigned` 直 new S3Client）收敛到 provider 抽象；local provider 预签名直传不可用（仅 S3）作为已知限制透传。

### 风险/价值/谨慎度标注

| 阶段 | 主要内容 | 风险 | 价值 | 谨慎度 |
|---|---|---|---|---|
| 0 | 脚手架 | 极低 | 基础 | 低 |
| 1 | 干净 service-fn 注册 | 低 | 高（覆盖广） | 中（能力/错误映射对齐） |
| 2 | action 委托去重 | 中 | 高（消除漂移） | 中（逐个对拍） |
| 3 | 内置 Agent + MCP | 中 | 高（能力兑现） | 高（审批/秘钥/限流/审计） |
| 4 | v1 路由薄适配 | 中 | 中 | 高（多 transport / 流式 / SSRF） |
| 5 | 补 service + 财务存储 | 高 | 中 | 极高（财务/存储/幂等/事务） |

---

## 6. 风险与开放问题

1. **进程内可变全局态多实例退化**：队列/inflight/async-Map/responseContinuation/settings 缓存/降级限流桶单进程有效。MCP 远程多副本或内置 Agent 独立 worker 会失效。缓解：MCP 流量定向单副本（Nginx sticky）、内置 Agent 约束同进程、Redis 就绪后迁移。**本设计不在接口层解决，仅元数据标注 `processLocalState`。**
2. **幂等缺口收敛风险**：现有 `useCredits`/`adminGrantCredits`/`adminAdjustCredits`/工单创建无幂等键，UOL 强制 sourceRef/clientRequestId 后，调用方迁移期需保证 key 稳定生成，否则重试重复执行。需阶段 5 单测守护。
3. **双副本权威化**：admin-users/creem 在两处存在，统一以 packages/shared 为权威；删除 apps/web 旧镜像前需确认无独立引用差异（shared 侧 creem 多 Zod 校验与缺 secret 抛错）。
4. **只读语义 vs 读中带写**：多个"只读"操作内部触发过期处理/注册奖励/惰性提权写库。MCP `readOnlyHint` 与 Agent safe 档据**业务语义**而非函数名判定，需在 operation 元数据显式标 `hasMaintenanceWrite`，避免误判为无副作用。
5. **moderation fail-open/closed 透传**：传输层（MCP/HTTP/Agent）禁止吞掉 `decision==='error'`，否则等价放行。需在错误映射与适配器编码两处断言。
6. **存储两栈与 local 预签名**：`upload/presigned` 绕过 provider 抽象，收敛前后行为需对拍；local 后端预签名直传不可用，统一接口暴露时需在 S3 后端才启用，作为已知限制文档化。
7. **MCP 秘钥泄露/轮换**：单一管理秘钥泄露 = 全权。建议生产强制 scoped token + readOnly + `MCP_DENIED_OPS` + Nginx IP 白名单；秘钥轮换顺序约束（出/入站不对称，参照 moderation proxy）。
8. **LLM 成本与误操作**：内置 Agent 多步循环 token 成本与误触风险，靠步数/预算上限 + destructive 强制人审 + 计划模式控制；需监控 turn 级 token 与审批拒绝率。
9. **registry 注册副作用顺序**：`operations/index.ts` 汇总 import 必须在 invoke 前执行，serverless/边缘环境的模块加载顺序需验证（当前长驻 Node 进程无此顾虑）。
10. **开放问题**：是否需要为 MCP/Agent 提供 dry-run（仅校验 + 预览 before/after 不落库）模式？是否需要 operation 级 feature flag 以便灰度单个能力？留待评审。

---

## 7. 参考

- 全功能接口盘点表：`docs/plan/2026-05-31-feature-interface-inventory.md`
- 审计报告（含 C-M9/C-M11 等）：`docs/plan/2026-05-31-audit-report.md`
- 计费/生成管线关键事实：`docs/memory/gpt2image-credits-billing-architecture.md`
- 纯中转 key 设计：`docs/plan/2026-05-30-relay-only-api-key.md`
