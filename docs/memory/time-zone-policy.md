# 时间与时区策略

## 不变量

- PostgreSQL 应用连接固定使用 `options: "-c timezone=UTC"`。
- 数据库时间字段按 UTC 语义写入和读取；外部 API 只返回 Unix epoch 或带 `Z` 的 ISO 8601。
- `APP_TIME_ZONE` 只存在于部署环境，不属于系统设置，不得从 `system_setting` 覆盖进程环境。

## 站内展示优先级

```text
user.time_zone > process.env.APP_TIME_ZONE > UTC
```

- `user.time_zone` 保存 IANA 时区名称；`NULL` 表示继承部署默认值。
- 用户输入必须通过 `Intl.DateTimeFormat` 兼容性校验，不接受 `UTC+8` 这类固定偏移别名。
- 使用 `Europe/Berlin` 等 IANA 名称自动处理夏令时，禁止手工加减小时。

## 接口与实现

- UOL：`user.getMyTimeZone`、`user.updateMyTimeZone`。
- 服务端解析：`packages/shared/src/time-zone/server.ts`。
- 管理后台不再展示或写入 `APP_TIME_ZONE`；迁移 `0053_user_time_zone.sql` 清理旧数据库行。
