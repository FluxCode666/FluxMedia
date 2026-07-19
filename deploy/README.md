# FluxMedia 生产部署

本目录提供 `media.flux-code.cc` 的生产部署配置。Docker Compose 默认只启动 `web`
主服务；数据库迁移是显式维护 profile，不会常驻运行。PostgreSQL 使用外部
`DATABASE_URL`，注册机与 ChatGPT Web 代理均不启动。宿主机 Nginx 负责 TLS 终止并反向
代理到 `127.0.0.1:3000`。

## 文件

- `docker-compose.yml`：`web` 主服务，以及默认关闭的 `maintenance` 数据库迁移服务；
  `app-bootstrap` 命名卷挂载到 `/app/.fluxMedia`。
- `.env.example`：不含真实机密的服务器环境变量模板。
- `nginx/nginx.conf`：参考 user-service 的宿主机 Nginx 主配置。
- `nginx/conf.d/fluxmedia.conf`：`media.flux-code.cc` 的 HTTPS 站点配置。
- `.github/workflows/deploy-production.yml`：质量门、GHCR 构建与 SSH 部署流水线。

## 首次配置服务器

目标机需要 Docker Engine、Docker Compose v2、Nginx 与 Certbot。先准备部署目录和
真实环境变量：

```bash
sudo install -d -m 750 /root/flux-media
sudo cp deploy/docker-compose.yml /root/flux-media/docker-compose.yml
sudo cp deploy/.env.example /root/flux-media/.env
sudo chmod 600 /root/flux-media/.env
sudo editor /root/flux-media/.env
```

至少填写 `DATABASE_URL` 和 `BETTER_AUTH_SECRET`。数据库必须已创建；迁移由部署流水线
在切换 `web` 前执行。本 Compose 不启动 PostgreSQL。配置完成后先验证默认服务：

```bash
cd /root/flux-media
docker compose config --quiet
docker compose up -d --no-deps web
docker compose ps web
```

手工执行迁移时显式启用维护 profile。迁移成功后再启动主服务：

```bash
docker compose --profile maintenance pull migrate
docker compose --profile maintenance run --rm --no-deps migrate
docker compose up -d --no-deps web
```

迁移提交后通常不可自动降级；如果新版本健康检查失败，流水线只回滚应用镜像，不会
尝试回退已经提交的数据库迁移。因此新增迁移应保持向后兼容，先添加字段/表，再在后续
版本移除旧结构。

## 配置 Nginx 与证书

先确保 `media.flux-code.cc` 已解析到服务器。首次签发证书时，必须先保证 80 端口可
访问且 `/var/www/html` 是 Certbot 与 Nginx 共用的 webroot：

```bash
sudo install -d -m 755 /var/www/html
sudo certbot certonly --webroot -w /var/www/html -d media.flux-code.cc
sudo cp deploy/nginx/nginx.conf /etc/nginx/nginx.conf
sudo cp deploy/nginx/conf.d/fluxmedia.conf /etc/nginx/conf.d/fluxmedia.conf
sudo nginx -t
sudo systemctl reload nginx
```

若服务器尚无可处理 ACME challenge 的 Nginx 站点，应先用 HTTP-only 临时站点完成
签发，再安装包含 443 证书路径的完整配置。证书续期任务需要在续期成功后 reload
Nginx，例如通过 Certbot deploy hook 执行 `systemctl reload nginx`。

## 配置 GitHub Environment

在 GitHub 的 `production` Environment 中配置以下 Secrets：

- `DEPLOY_HOST`：目标服务器地址。
- `DEPLOY_PORT`：SSH 端口，可留空使用 `22`。
- `DEPLOY_USER`：具有目标目录和 Docker 权限的 SSH 用户；默认目录位于 `/root`，通常为
  `root`。
- `DEPLOY_PASSWORD`：SSH 登录密码，必须使用高强度随机密码并仅保存在 GitHub Secret 中。
- `GHCR_PAT`：目标机拉取私有 GHCR 镜像使用的只读 token。

目标机 SSH 服务必须允许密码认证；Workflow runner 会自动安装 `sshpass`。为与 FluxCode
保持一致，流水线设置 `StrictHostKeyChecking=no` 和 `UserKnownHostsFile=/dev/null`，不校验
服务器主机指纹。部署账号需要具备目标目录写权限和 Docker 执行权限。

如果部署账号不是 `root`，必须将 `DEPLOY_PATH` 改为该账号可写的绝对路径。

可选 Repository Variable `DEPLOY_PATH` 指定部署目录，默认 `/root/flux-media`。服务器
上的真实 `.env` 由运维持久维护；流水线只同步 `docker-compose.yml` 并更新其中的
`FLUXMEDIA_IMAGE`、`FLUXMEDIA_MIGRATE_IMAGE`、`FLUXMEDIA_TAG`。部署命令先通过
`maintenance` profile 执行一次迁移，再带 `--no-deps` 启动 `web`，不会启动注册机。

生产部署从 Actions 手动触发，版本号必须符合
`v<MAJOR>.<MINOR>.<PATCH>[-<alpha|beta|rc>.<N>]`。新容器未通过健康检查时，流水线
会恢复先前镜像标签并重新启动 `web`。
