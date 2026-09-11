# 求职助手平台

面向校招与实习求职者的 AI 求职助手，连接职位发现、求职资料管理、浏览器网申辅助填写和投递进度管理。

## 当前定位

这是一个以浏览器插件为核心入口的 SaaS 产品。插件负责读取当前招聘页面、识别表单字段并在用户确认后填写；Web 控制台负责资料、职位和投递记录管理。

## 设计文档

- [系统架构设计](docs/architecture.md)
- [自动填写 MVP 计划](docs/autofill-mvp-plan.md)
- [插件源码复用方案](docs/autofill-oss-reuse-plan.md)

## 仓库结构

```text
apps/web/         Next.js 用户端与官网
apps/api/         NestJS API 占位
apps/worker/      异步任务占位
apps/extension/   浏览器插件占位
packages/shared/  跨应用共享代码
docs/             架构与开发环境说明
```

## 规划技术栈

Next.js + TypeScript、NestJS、PostgreSQL、Prisma、Redis/BullMQ、Chrome Manifest V3，以及对象存储和 LLM API。

## 开发原则

- 早期采用模块化单体，AI 解析、职位采集和通知使用异步 Worker。
- 自动填写必须经过用户确认，不自动提交申请。
- 简历和个人信息按敏感数据处理，禁止提交真实个人资料和密钥。
