# 填写后端模块

2026-10-18：P2 已完成。平台 API 已接入 readiness / analyze / plan、站点规则及统一 AI Gateway；浏览器扫描、controls、runner、扩展仍留在独立工程，本阶段没有修改页面填写逻辑。

## 边界与依赖

```text
API index.js（配置、认证、分派）
  → routes.js（有界 JSON、截止时间、取消、ApiResult）
    → core（校验、路由、生成有来源依据的计划）
      → sites（集中存放确定性规则）
      → ai（提示词、候选目录/optionId 校验）
      → ResumeClient 端口

adapters/resume-client → 注入的 profileService → 注入的 Prisma
adapters/ai-provider   → 注入的 aiGateway → 平台现有模型配置/供应商
```

`index.js` 只组合依赖，不监听端口。core/sites/ai 不读取环境、数据库或凭据，不执行 DOM 动作。共享类型来自 `@job-assistant/autofill-contracts`；可信账户与 AI phase/runId 位于服务端 `types.ts`。旧资料 GET 接口与新 ResumeClient 使用同一投影服务；认证策略与旧 API 共享 `auth/request-user.js`，各自序列化错误信封。

TypeScript 引擎经 `scripts/build-autofill.mjs` 严格检查后，局部打包到忽略的 `dist/engine.cjs`。契约包及 `errors.js` 保持外部引用，与 CommonJS HTTP/资料适配器共用一个错误类型。没有跨目录运行时依赖，也没有迁入独立引擎的 start.ts、HTTP 回环资料客户端或直连模型 provider。

## 接口

三条均为已认证的 POST；支持平台 Cookie 或插件 Bearer，不接受客户端传来的整份简历、userId、principal、模型配置。请求协议保留 `autofill.next.v2`。

| 路由 | 元数据之外的输入 | `data` |
| --- | --- | --- |
| `/autofill/v2/readiness` | 无 | `{profileVersion}` |
| `/autofill/v2/analyze` | `snapshot` | `SemanticPage` |
| `/autofill/v2/plan` | `snapshot, semanticPage, optionEvidence, scope, expectedProfileVersion?` | `FillPlan` |

元数据为 `protocolVersion, requestId, runId, deadlineAt`，后两种 ID 为非空字符串且不超过 128 字符。成功 `{ok:true,requestId,data}`，失败 `{ok:false,requestId,error:{code,message,retryable}}`；鉴权先于 body，失败时 requestId 可以是服务器生成的。响应均 `Cache-Control: no-store`。

- 请求最多 512 KiB，响应最多 1 MiB；总等待最多 45 秒，取客户端 deadline 与服务器上限较早者，包含认证和收 body。
- 400 无效输入、401 未登录/过期/撤销、403 来源不允许或生产邮箱未验证、409 资料/规则版本变化、413 请求超限、502 来源/结果无效、504 取消或超时。模型无法匹配可以产生明确 unresolved，不能伪造成功值。
- plan 重新按页面身份判断规则路径，不相信客户端 `resolvedBy`；资料每次从当前认证账户读取，记录数来自数据库。未提供选项证据时保留 `needs-options`。
- 断开连接终止上游等待及模型请求/退避。Prisma 查询本身不能被这里的 AbortSignal 中止，资料适配器仅停止等待并丢弃晚到结果。

## 规则与 AI

规则集中在 `sites/`；美团、腾讯、阿里保持迁入前的身份范围、匹配和限制。Moka 只拥有已验证的 Baai/作业帮两条精确 path + hashRoute。默认 `MOKA_RULES_MODE=off`；显式设置 `candidate` 或 `enabled` 才注册，与独立引擎一致。不启用 Lever/Greenhouse 草稿，不读取旧 `page-rules.v1` 表。

已知站点全流程 AI 0，包括漏配、选项歧义、重规划、未支持路径及规则异常。只有未知页进入统一网关：

- `autofill.map-fields`：页面字段结构 + 有限来源目录 → candidateId。
- `autofill.match-options`：所需单个源值 + 当前真实候选 → optionId。

账户 ID、requestId/runId 是任务元数据，不拼入模型 messages；完整简历不发给模型。所有供应商、模型和重试策略沿用平台 `AI_*` 配置，适配层不另行重试。模型 HTTP 包体限 128 KiB、内容限 64 KiB，禁止重定向；结果继续经过引擎目录、单选、禁用项、歧义和来源校验。Gateway 支持可选的 signal/deadlineAt，旧调用不必新增参数；`onAttempt` 注入钩子只暴露任务/尝试元数据，不包含资料或提示词。

来源白名单由 API 入口注入：默认包含 `WEB_ORIGIN`，扩展 origin 用 `AUTOFILL_EXTENSION_ORIGINS` 逗号分隔显式配置。不带 Origin 的认证服务器请求可用；有 Origin 时必须精确匹配。P3 迁扩展时再配置实际 ID 与权限。

## 构建与验收

从仓库根目录运行：

```bash
pnpm --filter @job-assistant/api dev
pnpm --filter @job-assistant/api build
pnpm --filter @job-assistant/api test
```

三条入口自动先构建公共契约和局部填写引擎。`build:autofill` 只检查/构建这两部分；Dockerfile 已加入相应步骤。隔离数据库联调：

```bash
DATABASE_URL='<临时测试库连接串>' API_TEST_PORT=58623 \
  MAIL_PROVIDER=console FAKE_RESUME_PATH=/tmp/no-personal-resume.txt \
  pnpm --filter @job-assistant/api test:integration
```

集成脚本会创建账号和资料，必须使用独立测试库；不存在的 FAKE_RESUME_PATH 使用脚本内合成文本。没有测试数据回退到正式代码。

已执行：契约 5 项、API 60 项、API 生产构建、真实 API + 临时 PostgreSQL 16 集成。覆盖已知零 AI、未知页经过真实 HTTP provider 的受控模型边界、范围外结果拒绝、取消/退避/超时/体积、Cookie/Bearer、用户隔离、过期/撤销、软删除、409 及旧 suggestions。没有调用真实付费模型，没有部署容器或进行招聘页面实测；这些结果不等于扩展已迁入或实站验收通过。

迁移来源为 `resume-autofill-next/src/server`；7 个站点文件仅改变契约导入，core 只改服务端类型/错误端口，AI resolver 保留提示词和结果校验并移除直连 provider。P1 的投影兼容基线见 `tests/fixtures/profile-context-before-extraction.json`。下一阶段见[迁入计划](../../../../../docs/integration/autofill-integration.md)。
