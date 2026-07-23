# 控制台服务与支持区

## 目的

控制台首页在用量统计标题之后展示 Service & Support 服务入口。页面只复用参考图的
信息分组，视觉和交互继续遵循 FluxMedia 控制台。

## 数据边界

- 支持内容统一存入 `DASHBOARD_SUPPORT_CONFIG`，数据库沿用通用
  `system_setting` JSON 列，无需迁移。
- 配置契约位于 `packages/shared/src/support/dashboard-config.ts`：版本固定为 1，
  文案同时包含 `zh`/`en`，服务图标为枚举，最多十二项且 ID 唯一。
- 服务图标支持 Discord、Telegram、QQ、微信、推特、文档、模型、客服和网站。
  QQ、微信和推特不预置虚构的官方地址，由超级管理员按实际渠道新增服务项。
- 链接仅允许站内绝对路径、HTTPS，以及本地开发环境的 HTTP 地址；拒绝
  `javascript:`、`data:`、协议相对地址及反斜杠路径等不安全输入。
- 旧配置中的 `officialSupport` 字段会在读取时完成校验并剔除；管理员下次保存后，
  存储值将自动收敛为当前的服务入口结构。

## 接口与降级

- 用户侧通过只读 UOL operation `support.getDashboardConfiguration` 获取服务配置，
  不直接读取任意系统设置。
- 保存时由 system-settings 写入边界再次执行 Zod 校验；运行时对历史数据和环境
  变量再次校验。
- 支持配置属于可选服务。读取失败或历史值非法时只记录不包含配置正文、用户 ID、
  SQL 的错误，并回退安全默认入口，不影响用量统计。
- 用量统计失败时服务入口仍展示，避免非关键读模型故障吞掉帮助入口。

## 管理入口

超级管理员在“系统设置 → 支持”使用专用表单维护服务项的增删、启停、图标、双语
文案和目标链接。
