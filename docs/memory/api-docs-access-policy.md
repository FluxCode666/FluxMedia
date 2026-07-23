# API 文档访问边界

## 路由与受众

- `/{locale}/api-docs`：公开接入文档，面向外部开发者，无需登录。
- `/{locale}/dashboard/api-docs`：接入文档的控制台镜像，面向所有已登录用户。
- `/{locale}/docs/**`：内部系统文档，仅 `admin`、`super_admin` 可访问。
- `/{locale}/dashboard/backend-help`：内部系统文档的控制台镜像，使用同一管理员守卫。
- `/api/search`：Fumadocs 内部文档搜索索引，未登录返回 401，非管理员返回 403。

公开导航指向 `/api-docs`；控制台侧栏、API 密钥页和支持中心默认入口指向
`/dashboard/api-docs`，避免已登录用户离开控制台框架。管理员控制台额外显示
`/dashboard/backend-help`。

## 公开内容边界

公开页当前只包含以下三个图像端点：

- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `GET /v1/images/{task_id}`

请求参数、响应字段和示例不展示 `custom: true` 或其他明确的 FluxMedia 扩展字段。图片
任务 GET 端点的 `task_id` 虽在旧系统文档中被标成扩展，但属于路径契约不可缺少的参数，
公开页显式保留。视频生成与视频任务端点暂时只保留在管理员系统文档和原始双语数据中，
由公开数据出口统一过滤，恢复时只需调整隐藏端点集合。契约由
`api-integration-docs-data.test.ts` 防回归。

公开页的接口区使用响应式滚动电梯：桌面端显示粘性侧栏，窄屏显示粘性横向导航；活动
章节随滚动位置更新，并通过文字、背景和 `aria-current` 同时表达。
控制台镜像复用相同电梯；控制台内容容器在该路由保持 `overflow: visible`，避免横向滚动
祖先破坏桌面端 `sticky`，具体代码块和长字段仍由组件自身承担横向滚动。
独立接入页内容宽度上限与系统文档一致为 1600px；控制台镜像使用嵌入模式，不重复
叠加文档组件的横向内边距，避免正文两侧留白过大。

## 代码块

shadcn/ui 核心没有官方 Code Block。项目在 `@repo/ui/components/code-block` 按现有
shadcn 模式沉淀共享组件，提供语言标签、行号、横向滚动、复制成功/失败反馈；公开接入
文档与管理员系统文档共用，避免在营销布局引入会覆盖响应式样式的 Fumadocs 全局 CSS。
