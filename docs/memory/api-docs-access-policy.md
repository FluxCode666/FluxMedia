# API 文档访问边界

## 路由与受众

- `/{locale}/api-docs`：公开接入文档，面向外部开发者，无需登录。
- `/{locale}/docs/**`：内部系统文档，仅 `admin`、`super_admin` 可访问。
- `/{locale}/dashboard/backend-help`：内部系统文档的控制台镜像，使用同一管理员守卫。
- `/api/search`：Fumadocs 内部文档搜索索引，未登录返回 401，非管理员返回 403。

公开导航、控制台普通用户入口、API 密钥页和支持中心均指向 `/api-docs`；管理员控制台
额外显示 `/dashboard/backend-help`。

## 公开内容边界

公开页只包含以下五个端点：

- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `POST /v1/videos/generations`
- `GET /v1/images/{task_id}`
- `GET /v1/videos/{id}`

请求参数、响应字段和示例不展示 `custom: true` 或其他明确的 FluxMedia 扩展字段。两个
GET 端点的 `task_id` / `id` 虽在旧系统文档中被标成扩展，但属于路径契约不可缺少的
参数，公开页显式保留。契约由 `api-integration-docs-data.test.ts` 防回归。

## 代码块

shadcn/ui 核心没有官方 Code Block。项目在 `@repo/ui/components/code-block` 按现有
shadcn 模式沉淀共享组件，提供语言标签、行号、横向滚动、复制成功/失败反馈；公开接入
文档与管理员系统文档共用，避免在营销布局引入会覆盖响应式样式的 Fumadocs 全局 CSS。
