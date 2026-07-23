# A/B 影子流量 Relay

`services/ab-shadow-relay` 是默认关闭的内网 sidecar。调用方将一个已明确允许的 JSON 请求发给 relay 后，relay 同步请求生产服务并把生产响应原样返回；同时以最佳努力方式异步将同一正文发送给 A/B 评估服务。

## 安全与语义

- 启动配置必须同时提供固定的生产与影子 origin、入站密钥、影子密钥、精确路径白名单和方法白名单；缺任一项即拒绝启动。
- 只接受非压缩、小体积 JSON，默认上限 1 MiB，最大 8 MiB；不支持 multipart、流式请求或动态目标 URL。
- 生产端保留原有用户认证头；影子端只收到内容协商头、`X-Trace-Id`、`X-AB-Shadow: 1` 和专用 `X-AB-Shadow-Secret`，绝不复制查询参数、`Authorization`、Cookie、API Key 或 `X-Forwarded-*`。
- 影子请求有独立连接池、超时和有界并发槽。影子超时、5xx、网络错误或并发溢出只记录无敏感信息日志，不会影响生产响应；因此这是 best-effort 采样，不是可靠消息队列。
- 不得用于生图、积分、支付、订阅、Webhook、存储写入或其他会改变状态的端点。A/B 接收端必须验证影子专用密钥，并把 `X-AB-Shadow: 1` 当作无副作用评估模式。

## 启动与接入

本地 Compose 使用 `ab-shadow` profile：

```bash
docker compose --profile ab-shadow up -d ab-shadow-relay
```

线上可使用 `Dockerfile.ab-shadow-relay` 构建镜像，或在发版 tag 后拉取 `ghcr.io/<owner>/gpt2image-pro-ab-shadow-relay:<tag>`。只绑定受控 Docker 网络或宿主机回环地址；调用方把指定内网请求的目标改为 relay。若请求实际经过宿主机 Nginx，可在 Nginx 中增加单个精确 `location = /...` 并只代理到 relay，禁止在宽泛 `/api/`、`/v1/` 或默认 location 上启用。

启动前必须把生产与影子服务隔离：影子服务不得共享生产数据库、对象存储、支付/Webhook 凭据、任务调度器或上游生产配额。

## 实验运行

在投流前记录假设、唯一主指标、样本量和错误率/延迟/成本护栏。建议按 0% → 1% → 5% 分阶段放量，并预先定义紧急关闭条件。relay 只负责安全转发和关联日志；指标计算、分桶和胜负判定应由实验平台完成。
