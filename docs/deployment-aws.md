# AWS 部署说明

本文说明如何把当前仓库部署到一台 AWS EC2 机器上。适用于先上线测试环境，再逐步迁移到 RDS、托管 Redis 和 CI/CD 的阶段。

## 1. 当前仓库状态

当前仓库还不是“一条命令完整上线”的状态：

- 根目录 docker-compose.yml 目前只启动 PostgreSQL 和 Redis。
- API 有 apps/api/Dockerfile，但构建上下文必须是 apps/api。
- Web 目前没有 Dockerfile，可以先在 EC2 宿主机用 pnpm build 和 next start 运行。
- Worker 仍是占位程序，当前 API 还没有真正使用 Redis；第一版可以不启动 Worker。
- 生产环境还需要补充 Web 镜像、生产 Compose、反向代理和 TLS 配置。

不要直接把现有开发 Compose 当作生产配置：它使用默认 PostgreSQL 密码，并且把 PostgreSQL 和 Redis 端口暴露到了主机。

## 2. 推荐的第一版拓扑

第一版先使用一台 EC2，所有公网请求通过同一个域名进入反向代理：

~~~text
浏览器
  ↓ HTTPS
Caddy / Nginx
  ├── /       → Next.js :3000
  └── /api/* → API :3001（转发时去掉 /api 前缀）
                 ├── PostgreSQL
                 └── Redis（当前仅作为基础设施预留）
~~~

建议先使用同域反向代理，而不是 app.example.com 和 api.example.com 两个子域。当前登录 Cookie 没有设置 Domain，使用两个子域会导致 Web 中间件看不到 API 设置的 Cookie，出现登录后仍跳回登录页的问题。

生产环境变量应为：

~~~env
WEB_ORIGIN=https://lingke.example.com
APP_URL=https://lingke.example.com
NEXT_PUBLIC_API_URL=https://lingke.example.com/api
~~~

## 3. AWS 和安全组

EC2 建议使用 Ubuntu 22.04/24.04：

- 测试环境：2 vCPU、4 GB 内存、30 GB EBS
- 生产环境：至少 2 vCPU、4 GB 内存
- 绑定 Elastic IP
- DNS 将域名的 A 记录指向 Elastic IP

安全组只开放：

| 端口 | 来源 | 用途 |
| --- | --- | --- |
| 22 | 你的固定 IP | SSH |
| 80 | 0.0.0.0/0 | HTTP 到 HTTPS 跳转和证书签发 |
| 443 | 0.0.0.0/0 | HTTPS |

不要对公网开放 3000、3001、5432、6379。应用端口只绑定到 127.0.0.1 或 Docker 内部网络。

## 4. 安装运行环境并拉取代码

在 EC2 上安装 Docker Engine、Docker Compose 插件、Git 和 Node.js/pnpm。若 API 和 Web 都使用容器，Node/pnpm 只用于迁移和故障排查。若 API 直接运行在宿主机，还要安装 PDF/DOCX 解析依赖：

~~~bash
sudo apt-get install -y poppler-utils unzip
~~~

~~~bash
sudo mkdir -p /opt/lingke
sudo chown "$USER":"$USER" /opt/lingke
git clone git@github.com:xiazhiyi99/LinkJobGo.git /opt/lingke
cd /opt/lingke
git checkout <要部署的提交或分支>
~~~

上线前必须确认 Prisma migrations、API Dockerfile 和本次功能代码已经提交：

~~~bash
git status --short
~~~

## 5. 配置生产环境变量

不要把真实密钥提交到 Git。可以在服务器上创建 /opt/lingke/.env，或使用 Compose 的 env_file / AWS Secrets Manager 注入。

基础配置：

~~~env
NODE_ENV=production
API_PORT=3001
WEB_ORIGIN=https://lingke.example.com
APP_URL=https://lingke.example.com
NEXT_PUBLIC_API_URL=https://lingke.example.com/api

DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5432/<database>
REDIS_URL=redis://<redis-host>:6379
~~~

如果 PostgreSQL 使用 AWS RDS，把主机替换为 RDS 地址，并根据 RDS 配置追加 `?sslmode=require`；EC2 上的本机 PostgreSQL 容器通常不启用 TLS。

AI、OCR 和邮件配置使用 .env.example 中的变量名：

~~~env
AI_PROVIDER_MODE=production
AI_CHEAP_BASE_URL=...
AI_CHEAP_API_KEY=...
AI_CHEAP_MODEL=...
AI_OFFICIAL_BASE_URL=...
AI_OFFICIAL_API_KEY=...
AI_OFFICIAL_MODEL=...

AI_VLM_CHEAP_BASE_URL=...
AI_VLM_CHEAP_API_KEY=...
AI_VLM_CHEAP_MODEL=...
AI_VLM_OFFICIAL_BASE_URL=...
AI_VLM_OFFICIAL_API_KEY=...
AI_VLM_OFFICIAL_MODEL=...

BAIDU_OCR_API_KEY=...
BAIDU_OCR_SECRET_KEY=...

MAIL_PROVIDER=resend
MAIL_FROM=...
MAIL_API_KEY=...
~~~

生产环境会强制邮箱验证，因此必须配置可用的邮件服务。AI_PROVIDER_MODE=fake 只能用于本地测试。

当前代码没有读取计划中的 AUTH_SESSION_SECRET 和 AUTH_TOKEN_SECRET；会话 ID 和插件 Token 使用随机值生成，并在数据库中保存哈希。不要误以为仅配置这两个变量就已经启用了签名会话。

## 6. PostgreSQL、Redis 和迁移

长期生产建议使用：

- PostgreSQL：AWS RDS
- Redis：ElastiCache 或其他托管 Redis
- 密钥：AWS Secrets Manager

单机测试可以使用 Docker volume 运行 PostgreSQL，但要改随机密码、删除公网端口映射，并准备备份。数据库启动后，在 API 环境中执行：

~~~bash
cd /opt/lingke
pnpm install --frozen-lockfile
set -a
. /opt/lingke/.env
set +a
pnpm --filter @job-assistant/api exec prisma generate --schema apps/api/src/prisma/schema.prisma
pnpm --filter @job-assistant/api exec prisma migrate deploy --schema apps/api/src/prisma/schema.prisma
~~~

生产环境使用 migrate deploy，不要使用 migrate dev。

执行迁移前先备份现有数据库；上线后至少保留定期 pg_dump 或 RDS 自动备份。

## 7. 构建和启动 API

当前仓库建议先直接在 EC2 上运行 API，避免为 Web 和 API 同时补生产镜像。API Dockerfile 可以作为后续容器化方案使用；如果使用它，构建上下文必须是 apps/api，而不是仓库根目录。

宿主机运行 API：

~~~bash
cd /opt/lingke
set -a
. /opt/lingke/.env
set +a
pnpm --filter @job-assistant/api build
node apps/api/src/index.js
~~~

确认可用后，用 systemd 托管 API，避免依赖 SSH 终端：

~~~ini
[Service]
User=lingke
WorkingDirectory=/opt/lingke/apps/api
EnvironmentFile=/opt/lingke/.env
ExecStart=/usr/bin/node /opt/lingke/apps/api/src/index.js
Restart=always
RestartSec=5
~~~

如果 API 和 PostgreSQL 都在 Compose 中，DATABASE_URL 的主机名应使用 Compose 服务名，例如 postgres；如果 PostgreSQL 通过 127.0.0.1 端口映射到宿主机，则使用 127.0.0.1。

## 8. 构建和启动 Web

当前 Web 尚未提供 Dockerfile。先在 EC2 宿主机运行：

~~~bash
cd /opt/lingke
pnpm install --frozen-lockfile
export NEXT_PUBLIC_API_URL=https://lingke.example.com/api
pnpm --filter @job-assistant/web build
pnpm --filter @job-assistant/web start
~~~

NEXT_PUBLIC_API_URL 会在 Next.js 构建时写入客户端代码，修改后必须重新执行 build。

后续建议补充 apps/web/Dockerfile，再把 Web、API、数据库和反向代理统一放进 docker-compose.prod.yml。

如果暂时直接运行 Web 进程，不要依赖 SSH 终端保持运行；使用 systemd 或 PM2 托管。示例 systemd 服务（Node 路径需要按服务器实际安装位置调整）：

~~~ini
[Service]
User=lingke
WorkingDirectory=/opt/lingke/apps/web
EnvironmentFile=/opt/lingke/.env
Environment=NODE_ENV=production
Environment=NEXT_PUBLIC_API_URL=https://lingke.example.com/api
ExecStart=/usr/bin/node /opt/lingke/apps/web/node_modules/next/dist/bin/next start -p 3000
Restart=always
RestartSec=5
~~~

## 9. Caddy 反向代理示例

如果使用 Caddy，可以配置为：

~~~caddyfile
lingke.example.com {
  handle_path /api/* {
    reverse_proxy 127.0.0.1:3001
  }

  reverse_proxy 127.0.0.1:3000
}
~~~

handle_path 会去掉 /api 前缀，因此浏览器请求 /api/auth/me 会转发为 API 的 /auth/me。Caddy 会自动申请和续期 HTTPS 证书。

如果使用 Nginx，需要实现同样的路径重写，并把 WEB_ORIGIN 设置为完整的 HTTPS 域名。

## 10. 部署后验证

先检查 Web：

~~~bash
curl -I https://lingke.example.com/
~~~

当前 API 没有单独的健康检查接口，可以用未登录请求确认进程、反代和数据库连接正常：

~~~bash
curl -i https://lingke.example.com/api/auth/me
~~~

返回 401 是预期结果，说明 API 已经收到请求；如果连接失败、返回 500 或日志出现 Prisma 错误，应检查 API 环境变量和数据库连接。

浏览器中继续验证：

1. 注册、邮箱验证和登录。
2. 访问 /workspace 和 /workspace/profile。
3. 保存个人资料并刷新页面。
4. 请求 /api/profiles/me/autofill-context。
5. 上传测试简历并检查 AI 解析结果是否写入数据库。
6. 测试找回密码邮件和退出登录。

日志查看：

~~~bash
sudo journalctl -u lingke-api -f
sudo journalctl -u lingke-web -f
docker logs -f postgres
docker ps
~~~

## 11. 部署更新和回滚

推荐每次发布使用一个明确的 Git 提交：

~~~bash
cd /opt/lingke
git fetch --all
git checkout <新提交>
pnpm install --frozen-lockfile
set -a
. /opt/lingke/.env
set +a
pnpm --filter @job-assistant/api exec prisma generate --schema apps/api/src/prisma/schema.prisma
pnpm --filter @job-assistant/api exec prisma migrate deploy --schema apps/api/src/prisma/schema.prisma
NEXT_PUBLIC_API_URL=https://lingke.example.com/api pnpm --filter @job-assistant/web build
sudo systemctl restart lingke-api
sudo systemctl restart lingke-web
~~~

如果迁移或构建失败，先停止发布，不要删除数据库 volume。回滚代码前必须确认数据库迁移是否兼容；破坏性迁移需要提前准备回滚方案和数据库备份。

## 12. 正式生产前检查

- [ ] 生产密钥没有提交到 Git。
- [ ] NODE_ENV=production 已设置。
- [ ] AI_PROVIDER_MODE 不再是 fake。
- [ ] 邮件服务可以发送验证和重置密码邮件。
- [ ] HTTPS 已生效，登录 Cookie 带 Secure。
- [ ] PostgreSQL 和 Redis 没有公网端口。
- [ ] 数据库已经执行全部 Prisma migrations。
- [ ] 数据库备份和恢复流程已经验证。
- [ ] API、Web、反向代理都配置了自动重启。
- [ ] 已验证资料导出接口和用户数据隔离。

正式扩大规模后，再把 PostgreSQL、Redis、密钥和镜像迁移到 RDS、ElastiCache、Secrets Manager 和 ECR，并使用 CI/CD 自动构建和发布。

## 官方参考

- [Next.js 自托管](https://nextjs.org/docs/app/guides/self-hosting)
- [Next.js 环境变量](https://nextjs.org/docs/app/guides/environment-variables)
- [Caddy handle_path](https://caddyserver.com/docs/caddyfile/directives/handle_path)
- [AWS EC2 安全组规则](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html)
