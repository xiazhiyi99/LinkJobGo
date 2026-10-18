# 求职助手平台

面向校招与实习求职者的 AI 求职助手，连接职位发现、求职资料管理、浏览器网申辅助填写和投递进度管理。

## 当前定位

这是一个以浏览器插件为核心入口的 SaaS 产品。插件负责读取当前招聘页面、识别表单字段并在用户确认后填写；Web 控制台负责资料、职位和投递记录管理。

## 设计文档

- [当前产品 PRD](docs/product/prd-v0.3.md)
- [产品功能测试计划](docs/testing/product-test-plan-2026-10-18.md)
- [产品功能测试结果与 Bug 表](docs/testing/product-test-results-2026-10-18.md)
- [系统架构设计](docs/architecture.md)
- [自动填写 MVP 计划](docs/autofill-mvp-plan.md)
- [插件源码复用方案](docs/autofill-oss-reuse-plan.md)
- [投递航迹接入交接文档](docs/integration/applications-integration.md)
- [填写引擎迁入准备与 API 对接](docs/integration/autofill-integration.md)
- [AWS 部署说明](docs/deployment-aws.md)
- [阶段进度汇报](docs/progress-report.md)

两个接入文档分别描述 Demo 到主仓的合并边界、数据流、现有/待新增 API、认证方式、幂等规则和验收顺序。投递航迹与填写助手通过事件和 DTO 连接，不互相导入页面或数据库实现。

2026-10-17（P0 记录）：填写引擎的迁移来源确定为 `../resume-autofill-next`，已核对简历契约并整理模块、认证、AI Gateway 与构建接缝。当时只完成迁入准备，`apps/extension` 仍是占位实现，新填写路由尚未接入；旧规则表不直接驱动新引擎。

2026-10-18：P1 公共契约包与资料服务接缝已完成。旧资料 GET 接口共用独立投影服务，新 ResumeClient adapter 已通过隔离数据库验证；当时填写路由与扩展待迁入。

2026-10-18：P2 已完成三条 `/autofill/v2/*` 路由及统一 AI 网关接入，保持已知网站零 AI、未知网站受限 AI 匹配。契约 5 项、API 60 项、隔离 PostgreSQL 集成及 API 构建通过。接口与配置见[填写模块说明](apps/api/src/modules/autofill/README.md)。

2026-10-18：P3 已迁入扩展并接入平台后台认证和新路由，保持页面填写逻辑不变。实际 Chrome 安装包 + 平台 API + 隔离数据库联调通过，覆盖两账号资料隔离、填写、登录失效和取消。安装路径为 `apps/extension/dist`，登录到期需重新登录。见[扩展说明](apps/extension/README.md)。

2026-10-18：P4 全量构建、72 项相关测试、API/Web Docker 和新扩展平台接入链路通过。美团校招个人中心实测 3 轮：每轮正确新增/覆盖 41/68 项，召回率 60.3%，耗时中位数 73.262 秒，AI 调用 0；完整度未通过。见[P4 验收记录](docs/integration/autofill-p4-validation.md)。

## 仓库结构

```text
apps/web/         Next.js 用户端与官网
apps/api/         Node.js API、认证、Prisma 与 AI 网关
apps/worker/      异步任务占位
apps/extension/   页面填写引擎、扩展外壳与平台认证适配
packages/shared/  跨应用共享代码
packages/autofill-contracts/  填写 DTO、字段目录与校验（ESM / CommonJS）
docs/             架构与开发环境说明
```

## 技术栈

Next.js + TypeScript、Node.js、PostgreSQL、Prisma、Redis/BullMQ、Chrome Manifest V3，以及对象存储和 LLM API。

## 本地启动

```bash
docker compose up -d
cp .env.example .env
pnpm install
pnpm --filter @job-assistant/api prisma:generate
pnpm --filter @job-assistant/api prisma:migrate
pnpm dev
```

PDF 解析依赖 Poppler 的 `pdftoppm` 和 `pdfinfo`；macOS 可通过 Homebrew 安装，API 容器使用 `apps/api/Dockerfile` 时会自动安装。生产环境请配置 `AI_*`、`AI_VLM_*`、`MAIL_PROVIDER` 等密钥，不能提交 `.env`。

## 开发原则

- 早期采用模块化单体，AI 解析、职位采集和通知使用异步 Worker。
- 自动填写必须经过用户确认，不自动提交申请。
- 简历和个人信息按敏感数据处理，禁止提交真实个人资料和密钥。
