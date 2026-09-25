# AWS EC2 部署说明

当前仓库使用 `docker-compose.prod.yml` 在一台 EC2 上运行 Next.js、Node API、PostgreSQL、Redis 和 Caddy。Caddy 负责同域名反向代理并自动申请 HTTPS 证书：

```text
https://linkaigo.com/       → web:3000
https://linkaigo.com/api/*  → api:3001（去掉 /api 前缀）
```

PostgreSQL、Redis、API 和 Web 只在 Docker 内部网络可见，公网只开放 Caddy 的 80/443。

## 首次准备

在 AWS 安全组中开放：

| 端口 | 来源 | 用途 |
| --- | --- | --- |
| 22 | 个人固定 IP | SSH |
| 80 | `0.0.0.0/0` | ACME HTTP 挑战和 HTTP 跳转 |
| 443 | `0.0.0.0/0` | HTTPS |

不要开放 3000、3001、5432、6379。DNS 的 A 记录应指向 EC2 的 Elastic IP；当前 `linkaigo.com` 和 `www.linkaigo.com` 都指向 `47.129.142.193`。

Amazon Linux 2023 安装 Docker、Git 和 Compose 插件：

```bash
sudo dnf install -y git docker
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

如果发行版没有 Compose 插件，安装 Docker 官方 CLI 插件到 `/usr/local/lib/docker/cli-plugins/docker-compose`，并确认：

```bash
docker compose version
```

## 配置环境变量

```bash
sudo mkdir -p /opt/lingke
sudo chown "$USER":"$USER" /opt/lingke
git clone https://github.com/xiazhiyi99/LinkJobGo.git /opt/lingke
cd /opt/lingke
cp .env.example .env
chmod 600 .env
```

`.env` 不提交 Git。至少设置：

```env
POSTGRES_USER=lingke
POSTGRES_PASSWORD=<随机强密码>
POSTGRES_DB=lingke
REDIS_PASSWORD=<随机强密码>

WEB_ORIGIN=https://linkaigo.com
APP_URL=https://linkaigo.com
NEXT_PUBLIC_API_URL=/api
SESSION_COOKIE_SECURE=true
NODE_ENV=production
```

生产环境还需要填入 `.env.example` 中的 AI、百度 OCR 和邮件变量。账号验证和找回密码邮件可以使用阿里云 SMTP：

```env
MAIL_PROVIDER=smtp
MAIL_FROM=领客 <no-reply@notify.linkaigo.com>
SMTP_HOST=smtpdm-ap-southeast-1.aliyuncs.com
SMTP_PORT=465
SMTP_USER=no-reply@notify.linkaigo.com
SMTP_PASSWORD=<阿里云发信地址设置的 SMTP 密码>
```

阿里云邮件推送的 SMTP 用户名是完整发信地址，`MAIL_FROM` 中的邮箱地址必须与 `SMTP_USER` 完全一致。新加坡区域使用 `smtpdm-ap-southeast-1.aliyuncs.com`；如果使用阿里云企业邮箱，把主机改为 `smtp.qiye.aliyun.com`，用户名改为企业邮箱完整地址。465 端口使用 SSL，EC2 不需要申请 25 端口。

发信域名和发信地址需要先在阿里云控制台验证，并在 DNS 中配置控制台给出的 SPF、DKIM 等记录。不要把 SMTP 密码提交 Git。配置后重建 API：

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

本地开发仍可使用 `MAIL_PROVIDER=console`；不要在正式环境保留 `console`，否则邮件只会写 API 日志。

### 注册验证码与 CAPTCHA

注册页把确认密码、邮箱验证码和“发送验证码”放在同一页。点击发送按钮后先弹出 CAPTCHA，前端将验证服务返回的参数原样提交给 API；API 通过服务端验签后才会发送 6 位邮箱验证码。验证码只保存 HMAC，不保存明文，10 分钟过期，错误 5 次失效，邮箱 60 秒内不能重复发送。

本项目默认适配阿里云验证码 2.0。它和当前阿里云邮件账号可以使用同一云账号，但建议单独创建 RAM 用户，只授予验证码验证权限，不要把主账号 AccessKey 放到服务器。新加坡实例使用：

```env
EMAIL_CODE_SECRET=<随机高熵字符串>
CAPTCHA_PROVIDER=aliyun
ALIYUN_CAPTCHA_REGION_ID=sgp
ALIYUN_CAPTCHA_ENDPOINT=captcha.ap-southeast-1.aliyuncs.com
ALIYUN_CAPTCHA_SCENE_ID=<验证码控制台的场景 ID>
ALIYUN_CAPTCHA_ACCESS_KEY_ID=<RAM 用户 AccessKey ID>
ALIYUN_CAPTCHA_ACCESS_KEY_SECRET=<RAM 用户 AccessKey Secret>

# 这些值会在 web 镜像构建时写入浏览器端，只放公开配置，不放密钥。
NEXT_PUBLIC_CAPTCHA_PROVIDER=aliyun
NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION=sgp
NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX=<验证码实例 prefix>
NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID=<验证码控制台的场景 ID>
```

阿里云验证码场景需要选择 Web/H5 接入方式。后端使用 `VerifyIntelligentCaptcha` 验签，前端脚本必须由阿里云官方地址动态加载，不能复制到项目中。修改 `NEXT_PUBLIC_*` 后必须重新构建 web 镜像：

```bash
docker compose -f docker-compose.prod.yml build web api
docker compose -f docker-compose.prod.yml up -d --force-recreate web api
```

本地可以显式设置 `CAPTCHA_PROVIDER=disabled` 和 `NEXT_PUBLIC_CAPTCHA_PROVIDER=disabled`，按钮会使用开发占位令牌，邮件会通过 `MAIL_PROVIDER=console` 输出到 API 日志。生产环境如果没有配置 CAPTCHA 或 `EMAIL_CODE_SECRET`，API 会拒绝发送验证码。

如果还要启用投递航迹的邮箱自动同步，再配置：

```env
MAIL_OAUTH_CALLBACK_BASE_URL=https://linkaigo.com/api
MAIL_GMAIL_CLIENT_ID=...
MAIL_GMAIL_CLIENT_SECRET=...
MAIL_OUTLOOK_CLIENT_ID=...
MAIL_OUTLOOK_CLIENT_SECRET=...
```

Gmail 和 Outlook 的 OAuth 应用都把下面两个回调地址加入 Web redirect URI：

```text
https://linkaigo.com/api/mail-accounts/oauth/callback?provider=gmail
https://linkaigo.com/api/mail-accounts/oauth/callback?provider=outlook
```

QQ、163、126、iCloud 和其他 IMAP 邮箱不需要 OAuth Client ID；用户在工作台里输入邮箱地址和授权码/应用专用密码。`MAIL_CREDENTIAL_KEY` 用于服务端加密这些凭据，生成后不要随意更换，并应单独备份。

本次首次部署为了先完成端到端测试，服务器使用了 `NODE_ENV=development`、HTTPS Cookie 仍强制开启，注册用户会自动验证邮箱。配置真实邮件服务后，将 `NODE_ENV` 改为 `production` 并重新创建 API 容器：

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

## 启动和迁移

```bash
cd /opt/lingke
docker compose -f docker-compose.prod.yml build api web
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml run --rm api \
  pnpm exec prisma migrate deploy --schema src/prisma/schema.prisma
docker compose -f docker-compose.prod.yml up -d api web caddy
```

迁移使用 `migrate deploy`，不要在服务器执行 `migrate dev`。数据库数据保存在 Compose volumes 中；升级时不要使用全局 `docker system prune --volumes`。

## 验证

```bash
docker compose -f docker-compose.prod.yml ps
curl -fsS https://linkaigo.com/api/health
curl -I https://linkaigo.com/
```

健康接口应返回 `{"ok":true}`。未登录访问 `/api/auth/me` 返回 401 是预期行为；带登录 Cookie 访问 `/workspace/profile` 应返回 200。

日志：

```bash
docker compose -f docker-compose.prod.yml logs -f api web caddy
```

## 更新和回滚

每次发布使用一个明确的 Git 提交：

```bash
cd /opt/lingke
git fetch origin
git checkout main
git reset --hard origin/main
docker compose -f docker-compose.prod.yml build api web
docker compose -f docker-compose.prod.yml run --rm api \
  pnpm exec prisma migrate deploy --schema src/prisma/schema.prisma
docker compose -f docker-compose.prod.yml up -d api web caddy
```

`reset --hard` 只作用于代码目录，`.env` 被 `.gitignore` 忽略，不会被覆盖。更新失败时先保留数据库 volume，查看日志后回滚到上一个提交；回滚代码前确认迁移向后兼容。

## 正式生产检查

- `NODE_ENV=production` 且邮件服务可以发送验证、重置密码邮件。
- HTTPS 证书已由 Caddy 成功签发并自动续期。
- AI 和 OCR 密钥只在服务器 `.env` 或 Secrets Manager 中保存。
- PostgreSQL、Redis 没有公网端口映射。
- 已完成数据库备份和恢复演练。
- 已测试用户数据隔离、资料导入、投递记录和退出登录。
