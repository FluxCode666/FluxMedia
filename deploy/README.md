# FluxMedia 生产部署

本目录提供 `media.flux-code.cc` 的单服务生产部署配置。Docker Compose 只定义
`web` 主服务；PostgreSQL 使用外部 `DATABASE_URL`，注册机与 ChatGPT Web 代理均不
启动。宿主机 Nginx 负责 TLS 终止并反向代理到 `127.0.0.1:3000`。

## 文件

- `docker-compose.yml`：仅包含 `web` 的生产编排、持久卷与健康检查。
- `.env.example`：不含真实机密的服务器环境变量模板。
- `nginx/nginx.conf`：参考 user-service 的宿主机 Nginx 主配置。
- `nginx/conf.d/fluxmedia.conf`：`media.flux-code.cc` 的 HTTPS 站点配置。
- `.github/workflows/deploy-production.yml`：质量门、GHCR 构建与 SSH 部署流水线。

## 首次配置服务器

目标机需要 Docker Engine、Docker Compose v2、Nginx 与 Certbot。先准备部署目录和
真实环境变量：

```bash
sudo install -d -m 750 /opt/fluxmedia
sudo cp deploy/docker-compose.yml /opt/fluxmedia/docker-compose.yml
sudo cp deploy/.env.example /opt/fluxmedia/.env
sudo chmod 600 /opt/fluxmedia/.env
sudo editor /opt/fluxmedia/.env
```

至少填写 `DATABASE_URL` 和 `BETTER_AUTH_SECRET`。数据库必须已创建并完成与当前版本
匹配的迁移；本 Compose 不启动 PostgreSQL 或迁移器。配置完成后先验证展开结果：

```bash
cd /opt/fluxmedia
docker compose config --quiet
docker compose up -d --no-deps web
docker compose ps web
```

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
- `DEPLOY_USER`：具有目标目录和 Docker 权限的 SSH 用户。
- `DEPLOY_SSH_KEY`：专用部署私钥。
- `DEPLOY_KNOWN_HOSTS`：目标主机指纹，可由可信终端执行
  `ssh-keyscan -H -p <port> <host>` 获取并人工核对。
- `GHCR_PAT`：目标机拉取私有 GHCR 镜像使用的只读 token。

可选 Repository Variable `DEPLOY_PATH` 指定部署目录，默认 `/opt/fluxmedia`。服务器
上的真实 `.env` 由运维持久维护；流水线只同步 `docker-compose.yml` 并更新其中的
`FLUXMEDIA_IMAGE`、`FLUXMEDIA_TAG`。部署命令带 `--no-deps web`，不会启动注册机。

生产部署从 Actions 手动触发，版本号必须符合
`v<MAJOR>.<MINOR>.<PATCH>[-<alpha|beta|rc>.<N>]`。新容器未通过健康检查时，流水线
会恢复先前镜像标签并重新启动 `web`。
