# 开发环境与启动方式

## 当前环境

- Node.js `v26.8.1`
- npm `11.19.0`
- pnpm `11.19.0`
- Docker Desktop 已安装；使用根目录的 `docker-compose.yml` 运行 PostgreSQL 和 Redis。

## 本地配置

复制 `.env.example` 为 `.env.local`，填写本机配置。`.env.local` 不提交到 Git。

## 目录说明

- `apps/web`：未来的 Next.js 用户端和管理后台，目前是启动占位。
- `apps/api`：未来的 NestJS API，目前只验证启动入口。
- `apps/worker`：未来的 AI、职位采集和通知任务，目前是 Worker 占位。
- `apps/extension`：Manifest V3 插件壳，目前只有 Background Service Worker。
- `packages/shared`：跨应用共享的类型、常量和校验规则。

## 当前命令

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
```

当前占位应用只输出启动信息，不监听 HTTP 端口，也不连接数据库。下一步加入真实框架时，再补充 PostgreSQL、Redis 和端口健康检查。
