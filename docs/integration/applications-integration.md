# 投递航迹接入交接文档

## 本次合入（2026-09-20）

主仓已完整迁入求职航迹的三种工作视图和对应的持久化服务：邮件视图、按公司聚合并可展开历史的表格视图、支持日/月/周时间排布和重叠分栏的日历视图。页面已改为调用主仓认证 API，不再依赖 demo 的内存数据。

- 新增 Prisma `Application`、`ApplicationEvent`、`Task`、`MailAccount`、`MailMessage`、`SyncRun` 模型及 PostgreSQL migration `20260920143000_add_applications_mail`。
- 新增 `modules/applications` 和 `modules/mail` 服务，覆盖用户隔离、游标分页、幂等创建、version 乐观锁、事件状态推进、任务和日历投影，以及 IMAP 凭据 AES-256-GCM 加密落库。
- 接入根路径 API（无 `/api` 前缀）和完整航迹页面；AI gateway 增加 `mail.classify` 策略入口。
- 邮件服务已提供 QQ/163/126/iCloud/通用 IMAP、Outlook/Gmail OAuth PKCE、凭据加密、邮件去重、正文详情、游标分页、人工分类和同步状态恢复；已配置 provider 凭据时可走真实读取，否则明确返回配置错误。
- 表格展开、邮件详情编辑、公司/职位/状态更新、待办、手工添加、日历月/周/日模式和时间重叠排布均已迁入主仓。

本文把 `../archive/legacy-demos-2026-09-21/unified-inbox-demo` 中已经验证的界面和邮件处理链路，与
`job-assistant-platform` 的正式 API 对齐。本文是交接用的事实基线和实施约束；
真实 AI 自动分类/解析回调、Redis/BullMQ worker 和生产 OAuth state 持久化仍是后续工作。

## 现状结论

| 范围 | 当前事实 | 接入结论 |
| --- | --- | --- |
| 主仓投递功能 | Prisma application/mail/task/sync 模型、认证 API、邮件/表格/日历视图均已接入；`apps/worker/src/index.js` 仍是占位日志 | 继续接入队列 worker 和生产运行时 |
| Demo UI | `../archive/legacy-demos-2026-09-21/unified-inbox-demo/app.js` 已有邮件/表格/日历三种视图、筛选、详情、手动添加和状态展示 | 保留交互和视觉结构，替换数据源；不要把 demo 的内存状态当正式能力 |
| Demo 本地后端 | `../archive/legacy-demos-2026-09-21/unified-inbox-demo/server.js` 使用 Node 原生 HTTP + `node:sqlite`，固定 `user_demo` | 适合作为适配器和验收参考，不能直接暴露为多用户生产 API |
| 邮件 | QQ/163/126/iCloud/通用 IMAP、Outlook Graph、Gmail API 读取适配器已在 mail service；凭据必须通过环境变量配置 | 用真实账号做 provider 回归；生产迁移 OAuth state 和同步队列 |
| 分类/解析 | 主仓页面支持分类手工调整和结构化字段编辑；`mail.classify` 策略已注册，自动调用尚未挂到同步回调 | 接入 AI worker 后写回 `aiResult`，继续保留人工修正 |
| 发信 | Demo 没有 SMTP 发信；主仓 `apps/api/src/auth/mail.js` 只负责注册/重置/验证邮件（console 或 Resend） | 认证邮件与招聘收件箱完全分开；不得把 `sendMail` 当通用邮箱客户端 |

## Demo 的 UI 和数据流

入口是 `../archive/legacy-demos-2026-09-21/unified-inbox-demo/index.html`，行为在 `../archive/legacy-demos-2026-09-21/unified-inbox-demo/app.js`，后端在
`../archive/legacy-demos-2026-09-21/unified-inbox-demo/server.js`。

1. 页面启动时，HTTP 模式调用 `GET /api/mail-accounts`；直接打开静态文件时退回
   `localStorage`，并放入演示账号。当前选中账号由前端维护。
2. 演示账号点“同步邮件”时，前端等待一个定时器并在内存 `applications` 数组中插入一条记录。
   有 HTTP 后端时调用 `POST /api/sync`，轮询 `GET /api/sync-runs/:id`。
3. 后端同步从 fixture、IMAP 或 Outlook Graph 得到邮件，写入 `mail_messages`，规则分类后由
   `parseAi()` 解析；置信度达到阈值时插入 `job_applications`。
4. `GET /api/applications`、`GET /api/calendar` 是后端已有查询，但当前页面主要使用本地初始
   `applications`，真实账号通过 `GET /api/mail-messages` 后在浏览器映射到 `realApplications`。
5. 页面编辑公司/职位/状态/日期时只 `Object.assign` 内存对象；“添加待办”只操作
   `const tasks = new Set([1,2,4])`。没有保存投递修改或任务的 API 调用。
6. 页面显示的“查看原邮件”只是展开反馈，不会按需调用正文详情接口。

因此，迁移时可以复用邮箱模块、记录详情、状态 rail、筛选和日历布局；数据读取、编辑、
任务、事件和权限必须改为服务端来源。

## Demo 已有接口和能力边界

下表是代码实际路由，不是建议的生产合同。

| 路由 | 现状和事实 |
| --- | --- |
| `GET /api/health` | 返回 SQLite、`local-fallback` queue、AI provider 标签；无用户鉴权 |
| `GET /api/mail/providers` | 返回 provider、认证模式和 OAuth Client ID 是否配置 |
| `GET/POST /api/mail-accounts` | 列出/添加演示账号；唯一键为固定 `user_demo + provider + email`，添加只写 demo 元数据 |
| `POST /api/mail/accounts/password` | 实际后端的 IMAP/SMTP 探测入口；接收 `provider,email,password_or_code`，凭据只进 Node 内存 |
| `GET /api/mail/oauth/{gmail|outlook}/start`、`GET .../callback` | OAuth PKCE；state/verifier 只在进程内存，成功账号和 token 也只在内存；Outlook 后续使用 Graph，Gmail 读取尚缺 |
| `DELETE /api/mail-accounts/:id` | 标记 revoked、取消运行中的本地同步、删除内存 secret；历史邮件/记录保留 |
| `POST /api/sync` | `rangeDays` 仅允许 1/3/7/14/30/90/180；同账号存在 queued/running 时返回原 `syncRunId`；异步本地执行 |
| `GET /api/sync-runs/:id` | 返回计数和 `succeeded/partial/failed` |
| `GET /api/mail-messages` | 返回全库消息并做可选文本过滤；后端没有强制 account/user 过滤，前端再按账号筛选 |
| `GET /api/applications` | 返回 SQLite `job_applications`，没有分页、用户隔离或编辑接口 |
| `GET /api/calendar` | 从有 `event_start` 的求职记录生成事件并计算同日重叠列 |
| `POST /api/applications/:id/tasks` | 以 body `idempotencyKey`（缺省为 `application:{id}:follow-up`）去重后插入任务；没有任务查询/更新 |
| `POST /api/ai/parse` | 直接调用 demo 的标签正则解析器，不代表正式 AI provider |

`../archive/legacy-demos-2026-09-21/unified-inbox-demo/test-backend.js` 验证了 10 封 fixture、9 条招聘分类、重复同步不增记录、
日历重叠分栏和账号增删；测试报告明确写出没有真实 Gmail、没有 Redis/BullMQ、没有真实 SMTP
通知、没有 Google Calendar 双向同步。

有一个迁移前必须修复/绕开的具体问题：前端 `app.js` 将真实 IMAP 提交到
`/api/mail-accounts/password`，而 `server.js` 实际注册的是 `/api/mail/accounts/password`。
生产 API 不应复制这个路径差异。

## 真实邮件能力和 mock 边界

- IMAP 探针 `../archive/legacy-demos-2026-09-21/unified-inbox-demo/real_mail_probe.py` 用 SSL IMAP 只读收件箱，最多取 50 封，随后
  用 SMTP 登录做凭据验证；密码/授权码通过 stdin 传给子进程，不在 argv 中。
- Outlook OAuth token 可调用 Graph Inbox API，抓取 subject、from、receivedDateTime、thread、
  preview 和 body；HTML 在适配器中做粗粒度标签清理。
- Gmail OAuth scope 已包含 `gmail.readonly`/`gmail.send`，`processSync()` 已通过 Gmail message list/detail 读取并统一清洗正文；增量 historyId 仍待生产 worker 补齐。
- Demo 的 `AI_PROVIDER` 只是响应/health 标签；`classify()` 与 `parseAi()` 始终是本地确定性逻辑。
  正式实现应把最小必要的 subject/sender/snippet/body 交给主仓 AI gateway，写入规则版本、模型、
  置信度和证据，并保留人工确认路径。
- Demo 保存正文和完整 body，正式实现按设计文档只长期保存元数据，正文按需读取并设置 TTL；不保存
  原始 MIME 和附件。

## 主仓当前认证、AI 和运行时事实

- `apps/api/src/index.js` 的 `requireUser()` 从 `lingke_session` cookie 或 Bearer extension token
  查 Prisma `Session`；生产环境未验证邮箱返回 403 `EMAIL_NOT_VERIFIED`。没有已实现的
  `/auth/sessions` 或 admin 权限 guard；`User.role` 只是字段。
- API 的 JSON 响应统一设置 `access-control-allow-origin: WEB_ORIGIN`、credentials，并允许的请求
  头目前只有 `content-type, authorization`。因此新增接口的幂等 key 首期放 JSON body，不能要求
  浏览器发送 `Idempotency-Key` 头（除非同时改 CORS）。
- API 是 CommonJS Node HTTP，数据访问通过 Prisma；模型 ID 是 String/CUID，不要照搬 demo 或
  设计文档中的 UUID。
- `apps/api/src/ai/gateway.js` 提供 task、provider、重试、超时和结构化结果入口；策略目前为
  cheap→cheap→official（vision 默认 official）。为邮件分类新增 task policy，禁止在业务路由
  直接请求 provider。
- `apps/worker/src/index.js` 目前不是队列 worker，只打印占位日志。BullMQ/Redis 不能在交接中被
  声称为已接入。

## 目标模块边界

目标目录如下，先在 API 内保持模块化，避免把 Prisma 或 HTTP 入口塞进 shared：

```text
apps/api/src/modules/applications/   # Application、ApplicationEvent、Task、状态推进事务
apps/api/src/modules/mail/           # MailAccount、MailMessage、SyncRun、provider adapters
apps/api/src/modules/autofill/       # fill.completed 事件适配（沿用现有 autofill API）
apps/api/src/ai/                     # 现有 gateway；新增 mail.classify task/schema
packages/shared/                     # 仅 DTO、枚举、纯函数；不引用 Prisma
packages/server-core/                # 如需给 worker 复用的服务端领域逻辑/gateway；不从 worker 相对引用 apps/api 入口
```

首期 worker 可以是 thin bootstrap，调用 `server-core`；不要强迫一次性迁移全仓，也不要让
`apps/worker` 直接 `require('../../apps/api/src/...')`。

## 主仓公共 API 合同（已合入主仓）

所有下列路由都在主仓根路径下，不加 `/api` 或 `/v1`。所有资源从 `requireUser()` 得到 userId，
不信任 body 中的 userId。错误形状为 `{ "error": "可读消息", "code"?: "稳定错误码", "requestId"?: "请求号" }`。

### 投递记录和事件

| 方法 | 路由 | body/查询 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/applications` | `company`, `title`, `jobUrl`, `source` (`manual\|extension\|email`), `idempotencyKey` | 创建记录；插件创建默认 `status=saved`。同一用户 key 重试返回原记录 |
| `GET` | `/applications` | `status`, `q`, `from`, `to`, `cursor`, `limit` | 仅当前用户；建议 cursor 分页，最多 100 |
| `GET` | `/applications/:id` | — | 返回记录、来源摘要和事件列表（正文不在列表中） |
| `PATCH` | `/applications/:id` | 可更新字段 + 必填 `version` | 乐观锁；version 不匹配返回 409，不覆盖较新的用户编辑 |
| `POST` | `/applications/:id/events` | `type`, `clientEventId`, `fillRunId`, `occurredAt` | `type` 只允许 `fill.completed`（记录填写完成）或 `application.submitted`（用户确认投递）；actorUserId 由服务端写入 |

事件和状态规则：事件在一个事务中校验当前用户、写入唯一事件、推进状态和 version；唯一键为
`(userId, clientEventId)`，重复事件返回原事件/当前记录并标明 reused。`fill.completed` 不表示已投递，
`application.submitted` 才允许从 `saved` 推进 `applied`。邮件分类只能按状态顺序推进，不能把 `offer`
或用户编辑状态自动降回 `applied`。首期状态集合为 `saved/applied/screening/interview/offer/closed`。

建议 Prisma 模型至少包含：`Application(id String @id @default(cuid()), userId, company, title,
jobUrl, source, status, version Int, isUserEdited, nextFollowUpAt, createdAt, updatedAt)`；
`ApplicationEvent(id, applicationId, userId, type, clientEventId, fillRunId, occurredAt, actorUserId,
payload Json?, createdAt)`，并加 `@@unique([userId, clientEventId])` 和用户/状态索引。事件 payload
只放必要元数据，不放完整简历或邮件正文。

### 邮箱、同步、消息、任务和日历

这些是从 demo 能力抽出的正式接口，具体实现放 `modules/mail`/`modules/applications`：

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| `GET` | `/mail/providers` | 返回 provider、auth mode、是否可用；不返回 secret |
| `POST` | `/mail-accounts/oauth/start` | body `provider`；生成短期 state+PKCE 并返回/重定向到 provider |
| `GET` | `/mail-accounts/oauth/callback` | 校验 state、交换 token、保存密文元数据；不把 token 返回浏览器 |
| `POST` | `/mail-accounts/imap` | body `provider,email,passwordOrCode`；仅服务端探测并加密保存凭据 |
| `GET` | `/mail-accounts` | 当前用户账号列表（状态、provider、lastSyncedAt） |
| `DELETE` | `/mail-accounts/:id` | 撤销 provider 授权、取消未执行同步、清理密文/正文缓存；按保留策略保留历史记录 |
| `POST` | `/mail-accounts/:id/sync` | body `rangeDays` + body `idempotencyKey`；返回 202 `{data:{syncRunId,status,rangeDays}}` |
| `GET` | `/sync-runs/:id` | 返回 queued/running/succeeded/partial/failed 和计数 |
| `GET` | `/mail-messages` | `classification,q,from,to,cursor,limit`；默认元数据/snippet，按需读取正文 |
| `GET` | `/mail-messages/:id` | 校验账号归属后按需从 provider 读取/缓存清洗正文 |
| `PATCH` | `/mail-messages/:id` | 手工调整 `isJobRelated` 或关联投递记录 |
| `PATCH` | `/mail-messages/:id/analysis` | 保存结构化解析字段；服务端清洗 URL/日期并按用户作用域创建或更新投递记录 |
| `GET` | `/applications/:id/tasks` | 当前记录的待办 |
| `POST` | `/applications/:id/tasks` | body `title,dueAt,idempotencyKey`；唯一按 user + key，重复返回 reused |
| `PATCH` | `/tasks/:id` | 更新 open/completed/cancelled，校验当前用户 |
| `GET` | `/tasks` | `status=open` 等过滤 |
| `GET` | `/calendar` | `from,to`；由带 `eventStart/eventEnd` 的 application/event 投影，不承诺外部日历双向同步 |

邮件到投递记录的创建必须调用 `applications` 内部 service（同进程函数/模块契约），不通过本机
HTTP 自调用。service 接收统一 `RemoteMessageHeader` 和分类结果，按
`mailAccountId + providerMessageId` 去重；高置信度自动创建，低置信度保留邮件并进入人工修正。

## 数据、安全和幂等要求

1. 主仓新增 `MailAccount`、`MailMessage`、`SyncRun`、`Task`、`Application`、`ApplicationEvent` 时，
   所有查询带当前 userId；跨用户资源统一 404，避免资源枚举。
2. OAuth 使用 state+PKCE 和白名单 redirect URI。Refresh token、IMAP/SMTP 授权码用 KMS 或
   AES-256-GCM 信封加密落库；Access token 只在 worker 内存/短 TTL 缓存。任何 token、密码、正文、
   完整 provider 响应都不得写日志、前端或错误响应。
3. 正文 HTML 入库前清洗，默认按需读取并设置 TTL；不保存原始 MIME/附件。Demo 的 detail 使用
   `innerHTML` 拼接邮件字段，正式页面必须模板转义或安全渲染，不能照搬。
4. 同步以 `mailAccountId + providerMessageId` 去重；cursor 在每页事务成功后提交。Gmail 使用
   historyId/page token，IMAP 使用 UIDVALIDITY+UID；失效时按用户范围重扫。
5. 同步请求 body 的 idempotencyKey 与 worker jobId、syncRun 唯一约束配合；重复请求复用 active
   run。事件、应用创建和任务创建各自使用用户作用域唯一 key，事务中插入后再改变状态。
6. 账号断开先撤销 provider 授权，再取消同步和清理密文；历史邮件/投递是否保留由产品保留策略决定。
7. 认证邮件 `apps/api/src/auth/mail.js` 继续只服务注册/重置/验证；招聘邮箱读取和通知发信使用
   独立 adapter/policy，避免 SMTP 密码混入认证模块。

## 实施与验收顺序

1. 先加 Prisma migration 和 service 单元测试：状态推进、version 冲突、事件唯一键、账号隔离。
2. 实现 `modules/applications` 和无 provider 的 manual/extension API；接入插件时只调用
   `POST /applications` 和 `/applications/:id/events`。
3. 实现 `modules/mail` 的 fake adapter，迁移 demo fixture 测试：分类、解析、去重、partial、
   syncRun 轮询、日历投影。
4. 接入 Outlook Graph、IMAP；单独完成 Gmail message list/history 增量读取后再标记 Gmail real。
5. 将邮件分类接入 `apps/api/src/ai/gateway.js` 的 `mail.classify`，对脱敏样本测分类/字段准确率，
   低置信度不自动创建记录。
6. worker 先保持 thin bootstrap；Redis/BullMQ 就绪后再迁移重试、限流、断点续传，并验证 worker
   重启不重复写入。
7. 最后替换 web placeholder：保留 demo 的三视图和详情布局，所有编辑/任务/事件改用正式 API，
   增加 loading、409 version conflict、401/403 和 partial sync 状态。

验收必须覆盖：每用户隔离、重复 POST 幂等、事件重复/乱序、状态不可回退、provider token 不泄漏、
正文 XSS 清洗、Gmail/IMAP 断点恢复、Outlook/IMAP provider 错误、无 Redis 时的明确失败模式，
以及 demo 中已验证的重复同步和日历重叠。

## 当前阻断清单

- `apps/worker` 仍没有 BullMQ/Redis 消费循环；当前本地同步可由进程内恢复逻辑执行，生产需迁移独立 worker。
- OAuth state/verifier 当前保存在 API 进程内存，多副本部署前需迁移到 Redis 或加密数据库表。
- `mail.classify` 策略和人工编辑接口已存在，自动 AI 分类/解析尚未接入同步回调；接入后不得覆盖人工修正。
- 主仓 CORS 未允许 `Idempotency-Key`，首期同步幂等 key 继续放 JSON body。
- 主仓没有完整角色 guard；只能依赖 `requireUser` 做登录/邮箱验证，不能宣称 admin 授权已完成。
- 外部日历双向同步、Gmail historyId 增量和生产凭据 Secret Manager 尚未实现。

## 分支和共享文件交接

本次变更已直接落在主仓当前工作树，与既有简历/AI/autofill 未提交改动并存；集成时不要使用
`git add .`，应按文件审阅并拆分提交。应用模型、API、前端列表页和文档属于本次接入；
真实 provider、worker 和邮件详情视图应后续单独提交并完成对应验收后再发布。
