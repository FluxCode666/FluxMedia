# API 密钥与审核治理发布手册

本文承载 `0056_api_key_moderation_governance.sql` 的生产发布、恢复和备份销毁边界。
实现权威仍是 `docs/plans/2026-07-23-001-feat-api-key-management-moderation-plan.md`。

## 发布前准备

1. 在目标机安装与数据库主版本兼容的 `pg_dump`/`pg_restore`、age、AWS CLI v2。
2. 创建启用版本控制的专用 S3 bucket；部署身份仅授予指定备份前缀的
   `s3:GetBucketVersioning`、`s3:PutObject`、`s3:GetObject`。销毁权限由独立值班身份持有。
3. 离线生成 age 身份。只把 `age1...` 公钥写入目标机 `.env` 的
   `DEPLOY_BACKUP_AGE_RECIPIENT`；私钥放入批准的离线恢复介质，禁止进入服务器、仓库、
   GitHub Secrets、日志或工单。
4. 配置 `DEPLOY_BACKUP_S3_BUCKET`、可选前缀、1 至 30 天保留期，以及实例角色或专用
   `DEPLOY_BACKUP_AWS_PROFILE`。确认目标机 `.env` 权限为 `0600`。
5. 在 GitHub `production` Environment 启用人工审批。审批人核对目标提交、镜像版本、
   维护窗口、当前数据库主版本和 age 私钥的可用性。

## 自动发布顺序

生产 Workflow 按以下固定状态机执行，任一步失败都会终止后续步骤：

1. 跑全仓 lint、typecheck、DB-free 测试、临时 PostgreSQL 迁移与审核事务集成测试、Web
   production build，再构建并拉取不可变 Web/Migrate 镜像。
2. 检查备份工具、S3 版本控制和最小配置；此时旧 Web 仍运行，失败可无中断退出。
3. 停止旧 Web，确认没有运行容器，并要求 `pg_stat_activity.application_name =
   'fluxmedia-web'` 的连接数为 0。
4. 在只读事务中检查 `external_api_key.relay_only IS TRUE` 的数量。非零时迁移尚未开始，
   Workflow 恢复旧镜像元数据并重启旧 Web；不得人工忽略或直接改值后重跑。
5. 用 `pg_dump --format=custom` 创建完整一致性备份，以 `pg_restore --list` 校验 manifest，
   使用 age 公钥加密并立即删除明文，再上传到启用版本控制的 S3 对象。上传后读取指定
   version 的 SHA-256 元数据并比对。
6. 执行 `0056`，随后验证旧三列不存在、全站值合法、所有用户覆盖为空、套餐 JSON 无旧
   节点、覆盖 CHECK 与两个审计索引存在。
7. 只启动新 Web 并等待健康检查。成功摘要记录新镜像/提交、操作者、纯中转预检值、S3
   artifact ID（含 version ID）、密文 SHA-256 和销毁截止时间。

## 迁移后失败

迁移命令开始后，自动恢复旧镜像被禁止。迁移、后置校验、启动或健康检查失败时：

1. 保持 Web 停止和外部流量不可写，不修改回旧镜像标签。
2. 保存 Workflow 日志中的 artifact ID、SHA-256、旧/新提交和失败阶段；不得复制数据库
   行、连接串或凭据。
3. 优先评估前向修复。若必须回退，先按 artifact ID 的 version ID 下载密文并核对
   SHA-256，在隔离环境用离线 age 私钥解密并再次运行 `pg_restore --list`。
4. 在确认维护状态仍生效后恢复完整数据库备份；核对旧三列和迁移表恢复到发布前状态，
   最后才恢复旧镜像并进行健康与关键路径 smoke。

仅恢复旧镜像而不恢复数据库是被禁止的，因为旧代码会访问已删除列。

## 发布后核对

- 以真实会话检查系统设置页和用户管理页的 effective/source、原因必填和单条审计记录。
- 以同一用户检查 Web、User MCP 和受审核 v1 图像入口生效级别一致；旧治理字段必须稳定
  拒绝，Admin/User MCP 工具列表均不暴露人工策略写操作。
- 检查 `moderation_policy_fallback_high`、数据库 timeout、MCP 拒绝和生成失败日志。生产
  全站行合法时不应出现新的 `fallback_high`。
- 在 375px 与 1440px 验收 API 密钥列表、系统审核设置和用户审核覆盖入口。

## 备份销毁

回滚窗口结束后，值班人员从 Workflow 摘要复制 bucket、key 和 version ID，使用独立销毁
身份删除确切对象版本。禁止省略 `--version-id`，否则版本控制 bucket 只会创建 delete
marker，旧密文仍存在。

```bash
aws s3api delete-object \
  --bucket '<bucket>' \
  --key '<key>' \
  --version-id '<version-id>'

aws s3api list-object-versions \
  --bucket '<bucket>' \
  --prefix '<key>'
```

删除后结果中不得再出现该 version ID。把销毁时间、操作者、artifact ID 和无残留验证结果
写入发布审计；不保留密文、明文、age 私钥或数据库内容。
