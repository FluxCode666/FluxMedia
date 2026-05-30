# 2026-05-31 大规模测试 / 审计 / 重构 计划

> 授权来源：用户 2026-05-31 明确指令"workflow 大规模测试与审计，确保单元测试高覆盖率，找出代码中潜藏的风险和后续不易维护需要重构的部分，进行大规模安全审计和安全分析，实际通过浏览器进行UI测试确保无bug"。
> 经 AskUserQuestion 二次确认：
> - 浏览器 UI 测试目标 = **生产库 + 真实 API 全流程（一次性测试账号）**。用户已接受会写真实数据库、消耗真实积分、调用付费上游。
> - 修复范围 = **报告 + 全部修复（含大重构）**。授权对 create-page-client.tsx 等大文件做结构性重构。
> 全部工作在 `dev` 分支。`main` 仅用户明确要求时合并。

## 基线（2026-05-31）

- DB-free 单测全绿：packages/shared 10 文件 / 45 测试；apps/web 20 文件 / 126 测试 = 171 通过。
- 既有审计：docs/security-audit-2026-05.md（高危多数已修）；docs/TODO.md 列出仍存在的代码层问题。
- 远程库：DATABASE_URL 指向 104.248.226.34:8888（生产/暂存）。PLATFORM_API_KEY 为真实付费图像 API。

## 阶段

### 阶段 A：静态审计（进行中）
- Workflow `gpt2image-static-audit`（run wf_b088fe29-961）：12 子系统 x 3 镜头（覆盖率/可维护性/安全）并行取证 + 逐项对抗式复核 + 汇总。
- 产出：docs/plan/2026-05-31-audit-report.md（确认项，带 file:line）。

### 阶段 B：修复与重构
- 按报告 severity 顺序修复确认的安全/Bug 问题。
- 对识别出的大文件/职责混杂处做结构性重构（含 create-page-client.tsx）。
- 每步 typecheck + test 验证，小步 commit。

### 阶段 C：浏览器 UI 测试（独立测试环境，2026-05-31 改向）
- 决策变更：原定"生产库全流程"不可行——远程 DB 104.248.226.34:8888 从本机不可达（防火墙），本机无 Docker。用户改定"重新部署一套独立测试环境到任意可达服务器"。
- 目标宿主 = `api2`（152.42.197.239，可达，有 Docker v5.1.3 / node v24.14.1 / git）。注意 api2 上跑着无关的 cmpc-* 竞赛系统，必须隔离、不可干扰。
- 隔离栈：独立 Postgres 容器(`gpt2image-test-pg`，绑 127.0.0.1:5433) + 主机 `next dev`(绑 127.0.0.1:3100)；工作目录 `/root/gpt2image-test/repo`(clone dev 分支)。
- 超管：SELF_USE_MODE 自动播种 admin@gpt2image.local，凭据写 `/root/gpt2image-test/super-admin-credentials.txt`。
- 访问：本地 `ssh -L 3100:127.0.0.1:3100 api2` 隧道 → 本地 Playwright 打 http://localhost:3100。不公网暴露。
- 真实生图后端走后端池(DB 配置，非 env)，登录后在后台配置指向 mynav.website 再测生成。
- Playwright MCP 驱动：落地页 → 登录 → 瀑布流(#15/#16) → 后台用户管理(#1) → 关键流程，截图记录，发现 bug 即修(git pull + HMR)。

### 阶段 D：单测覆盖率提升
- 针对审计覆盖率缺口为核心逻辑（积分/扣费/订阅/鉴权/幂等/并发）补 DB-free 单测。
- 目标：核心逻辑高覆盖，全部 turbo typecheck/test 绿。

## 阶段 C 浏览器 UI 测试结果（2026-05-31，已完成）

测试栈：api2 隔离栈（Postgres 容器 5433 + 主机 next dev 3100），本地 SSH 隧道 localhost:3100。超管 admin@gpt2image.local。dev HEAD 853f0c5。

- [x] 落地页 /zh：完整渲染（hero/功能/5档定价/FAQ/页脚/Cookie）HTTP 200。
- [x] 登录/登出：Better Auth 凭据登录正常。
- [x] **#16 数字输入+滚轮**：文生图"重复生成"为数字输入(type=number,max=100=Enterprise并发,min=1)；输入 999 失焦钳制为 100；鼠标滚轮下滚 100→99、上滚 99→100。验证通过。
- [x] **#15 瀑布流**：tier 选择器"每批生成张数(并发)"选项 [1,5,10,20] 默认5；质量/尺寸(尺寸：1024x1024)/背景/思考强度控件齐全；首次进入弹"额度消耗提醒"首次警告。验证通过。
- [x] **#1 用户管理**：新增用户(testuser1)→列表出现(总用户2)；编辑资料(改用户名+邮箱)→列表反映;行操作菜单含"编辑资料/重设密码"；**用建号所设密码成功登录新用户→哈希链路端到端可用**。验证通过。
- [x] 全程控制台 0 error / 0 warning。
- 备注（非 Bug）：注册积分(100)由内部任务异步发放，首屏渲染可能短暂显示余额 0，重载即显示 100（DB 实为 100）。轻微 UX 瑕疵，自愈。

测试环境保留运行，可在修复后 git pull + HMR 复测。SSH 隧道命令：ssh -L 3100:127.0.0.1:3100 api2。

## 进行中 / 待办

- [x] dev server Windows 启动验证（可编译启动；缺 DB 时 SSR 500，已用 api2 隔离栈解决）
- [ ] 阶段 A 审计 workflow：首轮因会话用量上限中断，需复核/重跑产出报告
- [ ] 阶段 B 依审计报告修复+重构
- [ ] 阶段 D 补单测提升覆盖率

## 风险与注意

- 浏览器测试写真实数据：测试账号与生成内容会留在生产库；测试后视情况清理。
- Windows 本地 `turbo build` 因文件名含 `:` 报 EINVAL（不影响 Linux CI）；dev 模式可行性待验证。
- create-page-client.tsx 约 9000 行：重构前需充分理解其状态机与 runtime store 依赖，避免破坏既有行为。
