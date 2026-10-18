# 填写引擎合入主仓：准备与接口对接

更新：2026-10-18。状态：**P1/P2/P3 已完成；P4 全量构建、Docker 和新扩展平台链路通过，美团实站三轮均为 partial，完整度未通过。** 每轮正确新增/覆盖 41/68 项，召回率 60.3%，耗时中位数 73.262 秒，AI 调用 0；页面填写算法未改。P0 准备记录保留在第 8 节，P1/P2/P3 交付见第 9/10/11 节，P4 结果见第 12 节。

迁移来源唯一确定为 `../resume-autofill-next`，替代本文此前针对旧 Demo 的接入方案。保留当前“已登记页面使用站点规则、未知页面使用后端 AI”的策略，不恢复旧的“本地规则后逐字段 AI 补漏”。

## 1. 当前可复用内容与实际缺口

| 项目 | 源码核查结果 | 迁入处理 |
| --- | --- | --- |
| 扫描、控件与编排 | 新引擎已有 page / controls / runner 分层，包含记录探测、重新绑定和 Moka 增量扫描 | 原行为迁移，避免同时改填写算法 |
| 扩展外壳 | P3 已迁入 content、background、popup 和宠物 | 独立 platform 层负责平台认证和 HTTP，页面填写保留原行为 |
| 简历来源 | 主仓已提供 `GET /profiles/me/autofill-context`，输出 `resume.autofill.v1` | 复用同一投影逻辑，不建立第二套简历结构 |
| 填写后端 | P2 已将 readiness / analyze / plan 接入主仓 | 接入主仓 API 进程内的独立 autofill 模块 |
| AI | 主仓已有统一 Gateway；旧 suggestions 任务返回字段值，新引擎只选来源或真实候选 ID | 复用 Gateway 的供应商与配置，新增受限任务适配，不套用旧 suggestions 契约 |
| 规则 | 新引擎使用版本化 SiteParser 函数；主仓已有旧 `page-rules.v1` JSON 表和 API | 第一阶段使用迁入的代码注册表，旧表保持独立，暂不接到新运行链路 |
| 构建 | 新引擎 TypeScript / ESM / npm；主仓 pnpm，API CommonJS | 显式设置编译边界，迁入依赖并更新主仓锁文件 |

源码依据：[平台 API](../../apps/api/src/index.js)、[AI Gateway](../../apps/api/src/ai/gateway.js)、[当前引擎设计](../../../resume-autofill-next/docs/design.md)、[公共契约](../../../resume-autofill-next/src/shared/README.md)、[规则注册表](../../../resume-autofill-next/src/server/sites/registry.ts)。

## 2. 实际目录与依赖方向

```text
apps/extension/src/
  page/                    扫描、区块、记录和本地 DOM 绑定
  controls/                实际点击、输入、选择与读回
  runner/                  填写编排
  shell/                   content / popup / 宠物及本地消息
  platform/
    auth.ts                平台登录、退出与失效处理（P3 不启用刷新）
    api-client.ts          统一服务地址、HTTP、取消与错误转换
    token-store.ts         仅可信扩展上下文可读写凭据
    config.ts              构建时配置的固定服务源

apps/api/src/
  modules/autofill/
    core/                  计划生成与来源校验
    sites/                 网站函数、枚举、格式与版本
    ai/                    来源与选项任务的提示词、结果校验
    adapters/              平台资料服务、AI Gateway 适配
    routes.js              readiness / analyze /plan 请求边界
    index.js               注入依赖并组合服务，不监听端口
  profile/                 原资料投影服务，供旧 GET 与新模块共同调用
  ai/                      原统一 Gateway、供应商与模型配置

packages/autofill-contracts/src/
  types.ts / catalog.ts / validate.ts / page-route.ts / index.ts
```

只新增一个跨端契约包，不拆成每站一个 package，也不另起填写微服务。现有 `packages/shared` 未建立完整包导出，采用独立命名的 autofill 契约包可避免影响其其他消费者。

| 新引擎目录 | 迁入位置 | 改动边界 |
| --- | --- | --- |
| `src/shared` | `packages/autofill-contracts/src` | 保留 wire DTO、版本、目录与纯校验；服务端身份上下文属于内部接口，不随请求传输 |
| `src/extension/page, controls, runner` | `apps/extension/src/` 对应目录 | 更换契约 import，保留填写行为 |
| `src/extension/shell` | `apps/extension/src/shell` 与 `platform` | 保留填写 UI，账号面板替代手填 Token；拆出认证和 HTTP，manifest 由扩展构建统一产出 |
| `src/server/core, sites` | `apps/api/src/modules/autofill/` 对应目录 | 保留纯逻辑与规则范围，不导入平台入口文件 |
| `src/server/ai` | 同模块 `ai` 与 Gateway adapter | 保留候选约束，移除生产链路的模型直连实现 |
| `src/server/http, start.ts` | 模块 routes / composition | 迁移验证与取消语义；不复制独立 listen、环境加载和认证代理 |
| tests 与脱敏 fixtures | 各迁入模块对应测试目录 | 保留有效业务场景；真实简历、凭据、临时浏览器和大批运行日志不随代码迁入 |

依赖规则：

- extension → contracts；API autofill → contracts + 注入的资料/AI 端口。契约包不导入 DOM 实现、Prisma、Chrome、模型 SDK 或环境配置。
- page / controls / runner 不读取登录凭据或服务地址；sites 不调用数据库、网络或浏览器。
- `apps/api/src/index.js` 只注册模块和注入依赖，避免继续堆积站点逻辑。模块不能反向 import index.js，否则会触发建连、读环境或启动。
- Web 工作台只使用公开 DTO / HTTP，不导入扩展代码。填写结束不等于投递成功，不自动创建 submitted 状态。
- 迁入后的运行时不能 import、软链接或读取 `../resume-autofill-next`。它只作为迁移前对照和历史证据来源。

现有分层不等于完全解耦：shared 的 Derivation / recordFilter 仍包含 Alibaba、Moka 的受限名称，shell 也包含少量站点选项展示。第一阶段保留这些已验证协议行为，不把站点执行逻辑继续移进 shared；进一步通用化另做兼容改动，避免搬迁与算法重构同时发生。

## 3. API 对接清单

### 已有平台 API：保持兼容

| API | 当前行为与接入责任 |
| --- | --- |
| `POST /auth/extension/login` | email/password；返回 accessToken、refreshToken、expiresIn、user。由 extension platform/auth 调用，不让招聘页面接触密码或 Token |
| `POST /auth/extension/refresh` | refreshToken；返回新 accessToken、expiresIn、user。需要解决下文过期语义问题后接入 |
| `POST /auth/extension/logout` | 使用访问令牌撤销会话；已过期访问令牌的退出行为需补验收 |
| `GET /profiles/me/autofill-context` | 直接返回 ResumeContext，没有 data 外壳；身份由平台会话确定 |
| `GET /profiles/me/export` | 同一数据，另加下载头；保留原接口 |
| `POST /ai/autofill/suggestions` | Web 仍在调用，返回 `{data:{suggestions}, requestId, attempts}`；保留兼容，不替换为新计划接口 |
| `/autofill/rules/*` | 旧规则管理 API；本次不修改数据、发布状态或执行含义 |

### 新增平台路由：P2 已实现

已采用 `/autofill/v2` 命名空间，保留当前 `autofill.next.v2` 请求协议，不与主仓已有 suggestions 或规则管理路由混用。

| 新路由 | 从独立引擎迁来的路由 | 输入 / 输出 |
| --- | --- | --- |
| `POST /autofill/v2/readiness` | `/v1/readiness` | 仅请求元数据 → `{profileVersion}` |
| `POST /autofill/v2/analyze` | `/v1/analyze` | 元数据 + snapshot → SemanticPage |
| `POST /autofill/v2/plan` | `/v1/plan` | 元数据 + snapshot、semanticPage、optionEvidence、scope、expectedProfileVersion? → FillPlan |

元数据是 `protocolVersion, requestId, runId, deadlineAt`。以上三个接口统一使用：

```ts
// 继续沿用当前引擎信封，避免 content 同时猜测多个响应形状。
type ApiResult<T> =
  | { ok: true; requestId: string; data: T }
  | { ok: false; requestId: string;
      error: { code: string; message: string; retryable: boolean } };
```

不把整份简历、任意 userId、模型配置或供应商 Key 放入请求。plan 只返回当前 scope 所需的值；完整简历仍在后端读取。客户端 binding.resolvedBy 不是授权或规则路由依据。

HTTP 语义：400 契约错误；401 未登录；403 无权限或邮箱未验证；409 简历/规则版本冲突；413 体积超限；502 上游或结果不可用；504 截止时间到。鉴权可能在读请求体前拒绝，此时 background 只按状态产生固定失败，不能要求该响应已关联客户端 requestId；成功响应必须严格关联。

P2 已明确唯一读取者：在旧 body 读取前，路由分派先识别 `/autofill/v2/*`，由模块处理 JSON/体积/取消，不能先消费流再交给引擎。沿用 512 KiB 请求上限与 1 MiB 扩展响应上限；不得直接套用上传接口的 24 MB 宽限。复用主仓身份检查并转换为新信封，不重复创建 HTTP server。

## 4. 三个平台适配接口

### 资料：一个投影来源

**P1 已完成：** 原 index.js 的 `profilePayload` / `autofillContextPayload` 及必要常量已整理到 `apps/api/src/profile/service.js`，保持返回值、排序、过滤和摘要算法不变。现有 GET 路由与新 `ResumeClient.load` adapter 使用同一个服务；服务接收平台已认证的 `{id, email}`，不解析请求体身份。

```text
已验证平台用户
→ 平台资料投影服务（按该用户查询）
→ validateResumeContext
→ expectedProfileVersion 校验
→ core.buildFillPlan
```

同一 API 进程内优先函数调用，避免绕 localhost 再发 GET，也不把 Bearer Token 继续传入 core。新引擎旧 start.ts 通过 `/profiles/me` 返回的 profile.userId 验证身份，这段代理不迁入；账户归属来自平台认证结果。

profileVersion 是内容版本，generatedAt 不是内容版本；readiness 是瞬时可用性检查，不能替代每次请求的鉴权，也不能代替首次计划及后续补充计划的版本固定。资料变化返回 409，不继续混填。

### AI：接入统一 Gateway，保留新引擎候选约束

新增平台内部任务名（拟定）`autofill.map-fields` 与 `autofill.match-options`。只供 autofill 服务端调用，不向扩展开放通用模型代理。

```text
未知页 → 引擎 AiResolver
       → PlatformAiProvider adapter
       → 平台 aiGateway.run
       → 供应商
       → Gateway.data → 引擎结果校验 → 有限来源 / optionId
```

保留当前提示词和校验：字段匹配只给字段结构及来源目录；选项匹配只给所需源值和真实候选。Gateway 的 data 在 adapter 中转换为 AiProvider.complete 需要的 JSON 文本，requestId/attempts 供诊断，不混入计划。未知站也不能生成个人事实、动作或选择器。

AiCallContext 的 phase、requestId、runId 和可信用户身份要成为显式内部类型，替代现有运行时扩展字段的类型断言；账户元数据不拼入模型 messages。Gateway 所需 task 由服务端确定，不取自招聘页。

**P2 已补齐：** Gateway.run 向后兼容地接受可选 signal/deadlineAt，每次 attempt/退避受同一总预算约束；取消后不再重试。新任务在 HTTP 流读取时限制响应体积并拒绝重定向；旧调用不必增加参数。仅 Gateway 管理供应商重试，adapter 不重试。

已知页不进入 Gateway，包括字段漏配、选项歧义、重规划和异常；未配置模型不应阻塞已知页。供应商、模型和策略统一由主仓现有 AI 配置决定，不另建独立配置文件。

### 认证与传输：集中在扩展后台

迁入 `platform/auth`、`api-client` 和 `token-store`，shell 只查询登录状态并发送填写命令。凭据存储限制到可信扩展上下文；不返回 content，不进入报告。

当前 shell 只支持 localhost HTTP、手工 accessToken、固定 `/v1/*` 路由；必须改为构建/部署配置的 API origin 和显式业务路由。生产只允许配置的 HTTPS 平台地址，本地开发单独允许 localhost；manifest 权限、服务端允许来源、部署域名及构建标识一起验收。不能只改默认端口就称为对接完成。

**前置缺口：** 平台 Session 只有一个 expiresAt。login 给 15 分钟；refresh 也要求该 expiresAt 尚未过期，所以访问令牌自然过期后，靠 401 再刷新会被拒绝。现有 logout 在访问令牌失效时也可能无法撤销该会话。

第一阶段可明确要求失效后重新登录，但不能宣称已有可靠自动续期。若需要完整刷新体验，应作为独立认证改动，区分访问令牌到期与刷新会话有效期，并覆盖撤销、并发刷新和用户隔离；涉及数据库时另做迁移，本准备阶段不执行。不能仅在客户端删除时间检查来解决。

不恢复扩展本地定时清理 Token。确定的认证失效进入“需重新登录”；网络失败或暂时不可用不清除凭据。未来启用刷新时，后台并发请求共享一次刷新，最多重放一次，仍受原截止时间与取消约束；403 不循环刷新，重放 HTTP 不重放已执行的网页动作。明确退出和切换服务地址才按授权清理本地凭据。

## 5. 规则数据库与现有功能的兼容

主仓 `AutofillRuleSet` 是旧语义 JSON 方案，不是当前 SiteParser 的可直接序列化形式：

- `page-rules.v1` 校验明确拒绝 selector、DOM path、执行代码与临时字段 ID；当前网站函数及其前端 adapter 不能直接塞入 rules。
- 旧 sourceKey 由 origin + pathname 构成，丢弃 hash；Moka 当前使用精确 path + hashRoute，直接接旧 resolver 会丢失页面范围。
- JSON 的 sourcePath 字符串也不等同新引擎 SourceKey/SourceRef；旧父子合并不能替代当前确定性的 parser 选择。

因此第一阶段保留编译进服务端的 `sites/<site-id>` 与注册表，不读取旧表驱动新引擎，不把读取不到旧表规则当成未知网站。Moka 仅保留已验证的两条申请路由；草稿 Lever、Greenhouse 不因复制文件而启用。美团/腾讯/阿里保留当前身份范围及已知限制，不因迁入而宣称验收全部通过。

后续如需数据库运营管理，可先设计“精确发布范围 + parserId/version + 状态 + 证据引用”的元数据关联，再考虑可声明化的映射；需独立协议和兼容方案。结构指纹继续只做更新提示，不参与规则匹配。不在本轮新增表、运行记录服务或动态执行数据库源码。

旧 Web suggestions 入口、资料编辑和投递航迹保持接口兼容。新 RunReport 的 completed / partial / failed 不能自动转换成 application.submitted；后续如接运行摘要，只通过单独事件端口且不含简历值。

## 6. 构建与部署准备

- 主仓使用 pnpm workspace；保留主仓锁文件，不复制引擎的 package-lock、node_modules、dist、.env 或临时 artifacts。
- 契约包提供明确 exports、类型声明以及浏览器 ESM / API CommonJS 可消费的产物。不能直接把 TS 文件交给当前 API 的 require。
- API autofill 模块采用局部 TS 编译或打包成 `.cjs` 入口，由现有 index.js require；避免为迁入把整个 API 改为 ESM。平台资料和 Gateway 通过依赖注入进入该入口，不打包 Prisma 或读取平台入口。
- 扩展保留 content IIFE、background/popup ESM 和静态宠物资源的构建方式；API 构建不应触发浏览器测试或打包 React 测试 fixture。
- 构建顺序为 contracts → autofill API 模块 / extension。P2/P3 已更新 workspace 依赖、package scripts、tsconfig 与 API Dockerfile；填写模块编译结果和 Prisma 一起构建。
- 记录扩展 buildId、后端 buildId、协议版本和 parser 版本；新旧 Chrome 扩展不能同时作为验收入口，正式联调前确认实际路径。
- 发布时新增模块与扩展同批部署；回滚关闭新入口/路由或恢复对应版本，不变更用户资料、旧规则表及投递记录，也不静默切换旧 suggestions 语义。

## 7. 分阶段实施与通过条件

| 阶段 | 实施范围 | 验证与完成条件 |
| --- | --- | --- |
| P0 准备（已完成） | 源码盘点、契约预检、目录/API/依赖方案、差异清单 | 本文及预检结果 |
| P1 契约与资料接缝（已完成） | 契约包，提取平台资料投影，新 ResumeClient adapter | 旧投影兼容、两用户隔离、软删除、extra/false、版本冲突；平台实际导出通过新 validator |
| P2 服务端接入（已完成） | sites/core/AI resolver，统一 Gateway adapter，三条模块路由 | 已知页全流程 AI 0；未知页受限结果；错误信封、体积上限、取消/截止时间、鉴权前置及旧 suggestions 回归 |
| P3 扩展接入（已完成） | 迁移 page/controls/runner/shell，接平台后台认证与 HTTP | 实际构建扩展 + 平台 API + 可交互 fixture；账号隔离、登录失效可见、取消传到底、记录正确、无真实投递 |
| P4 发布前验收（完整度未通过） | 同批构建、Docker 运行、完整平台数据链路 | 全量构建、72 项测试、Docker 和新扩展平台链路通过；美团三轮各 41/68，耗时中位数 73.262 秒，AI 0 |

下一阶段处理 **P4 美团实站暴露的页面规则缺口**：空白经历区探测、补充字段来源和考试选项，再按同一目标清单复测；本轮迁入验收没有修改这些逻辑。P3 采用失效后重新登录；自动续期独立修复平台会话到期语义后再接入，不与页面算法改动混做。

重点验收样例：

- 真实平台用户 A 的资料生成计划，用户 B 的请求不能读到 A 的值；客户端伪造 userId 无效。
- readiness 后更新简历，补充计划返回版本冲突；不能混用数据。
- 已知页增项后的重规划、未匹配下拉和规则异常仍 AI 0；未知页模型结果只能引用当前候选。
- 取消/超时后无新 provider attempt；重试和 Token 刷新不突破原预算。
- 正式扩展点击填写经过后台和新路由；旧账号、资料 API、Web suggestions 与投递记录功能继续工作。

P1/P2 按数据访问、认证、公共网关的实际影响执行相关完整测试；纯模块搬迁先跑对应模块检查。P4 才进行合入后的全链路和实站验收。

## 8. P0 已执行的准备检查（2026-10-17）

使用当前新引擎 shared 源码在内存编译后校验主仓脱敏样例，无网络请求、无数据库写入，也未启动或重载浏览器：

| 检查 | 结果 |
| --- | --- |
| `apps/extension/fixtures/autofill-context.example.json` 通过 validateResumeContext | 通过，5 条记录、5 种记录类型 |
| 样例 profileVersion 按平台内容摘要算法重算 | 一致 |
| 平台 profile 标准字段与引擎目录 | 一致，双向无缺项 |
| 平台 preferences 标准字段与引擎目录 | 一致，双向无缺项 |
| 平台 9 种记录类型的标准字段白名单与引擎目录 | 全部一致 |
| API/认证/Gateway/规则与部署接缝 | 已按源码盘点，缺口列于上文；尚未修复或联调 |

这只证明现有静态契约可对接，不代表生产用户资料、所有 extra 字段、认证刷新、Gateway 取消、平台部署或真实网页已经通过。完整字段资料和真实数据库输出仍在 P1/P4 验证。

后续共通经验与真实测试口径见[规则沉淀文档](../../../resume-autofill-next/docs/site-rule-acquisition-plan.md#10-共通经验与执行清单2026-10-17)及[端到端测试计划](../../../resume-autofill-next/docs/live-e2e-test-plan.md)。这些跨目录链接只用于准备期查阅；完成迁入时同步迁移必要模块文档和测试口径，不保留跨仓运行时依赖。

## 9. P1 交付与验证（2026-10-18）

- [公共契约包](../../packages/autofill-contracts/README.md)：迁入字段目录、DTO、校验与 hash 路由；保持两个协议版本，提供 ESM / CommonJS 及各自类型声明；服务端身份和 Token 类型不进入包。
- [资料投影服务](../../apps/api/src/profile/service.js)：注入 Prisma，不加载环境、不建立连接、不依赖填写模块；旧三条资料 GET 路由已经改用它。
- [ResumeClient adapter](../../apps/api/src/modules/autofill/adapters/resume-client.js)：仅依赖资料服务端口和契约校验，处理可信身份、版本、deadline、取消与脱敏错误；等待取消不等于中止 Prisma 查询。
- 工作区依赖、构建入口、锁文件与 API Dockerfile 已衔接。锁文件仅增加本次包及 esbuild 依赖，原有依赖版本保持不变。

实际检查：契约包 5 项通过（含 ESM/CJS 类型解析与浏览器打包）；API 单元 48 项通过；`pnpm --filter @job-assistant/api build` 通过。真实 API + 临时 PostgreSQL 16 集成通过，覆盖 Cookie/Bearer 读取、旧 export 响应、实际投影校验、HTTP 与内部 adapter 内容一致、伪造额外 userId 无效、用户隔离、软删除和 409 版本冲突。测试使用合成资料，独立容器内应用仓库已有迁移，没有修改现有用户数据库或增加迁移。

未执行：生产 Docker 镜像构建、刷新令牌修复、Gateway 改造、新填写路由和招聘页面测试。独立 `resume-autofill-next` 的扫描、控件、runner 与扩展产物均未修改；本次结果不代表填写链路已迁入。


## 10. P2 交付与验证（2026-10-18）

填写后端已归入 [apps/api/src/modules/autofill](../../apps/api/src/modules/autofill/README.md)。core/sites/ai 保持纯业务边界；资料及 AI 只通过注入端口连接平台。7 个站点文件经源码比对，仅修改公共契约导入；扫描、controls、runner、独立扩展和主仓 Web 未修改。旧 JSON 规则管理 API 与旧 suggestions 保持兼容，没有新增数据表或迁移。

新增 `/autofill/v2/readiness|analyze|plan`，鉴权先于有界 body；512 KiB 请求、1 MiB 响应、45 秒最大总预算和 no-store。平台账户策略被提取为独立认证模块，新旧接口各保留自己的错误信封。生产邮箱验证要求、Cookie/Bearer 解析与 Token 生命周期语义不变。

统一 Gateway 新增受限字段/选项任务适配及外部取消/绝对 deadline；控制重试、退避和响应体积。测试以真实 HTTP provider 连接本机受控模型上游：已知站点的漏配、歧义、重规划和异常路径调用数均为 0；未知页仅接受目录/candidate IDs。没有使用真实模型密钥或调用付费 API。

构建通过局部 TS → CJS 产物接入现有 API；开发、构建、测试及 Dockerfile 同步，原有依赖版本不升级。新配置仅 `AUTOFILL_EXTENSION_ORIGINS` 与 `MOKA_RULES_MODE`，见 `.env.example`。Moka 默认不注册，只有显式 candidate/enabled 才注册已验证的两个精确申请路由；草稿站点不启用。

实际验证：

- 契约测试 **5/5**、完整 API 测试 **60/60**、API 生产构建通过。
- 真实 API + 独立 PostgreSQL 16 联调通过：三路由、Cookie/Bearer、真实资料生成计划、两用户隔离、无效身份参数、版本冲突、软删除、过期/撤销 Token 以及旧 suggestions/资料/规则接口。
- 本机 HTTP 断连能取消模型 fetch；总截止时间覆盖认证、上游和重试退避；被取消后不新建 provider attempt。Prisma 查询仍只能停止等待、丢弃结果。

P2 当时未执行生产 Docker 镜像部署、真实供应商 smoke 或招聘网页 E2E；未修改认证续期逻辑。后续 P3 结果见下节，独立 Demo 既有实站成绩不能作为本次合并后的成绩。

## 11. P3 交付与验证（2026-10-18）

[平台扩展](../../apps/extension/README.md)已替代占位实现，产物位于 `apps/extension/dist`，Chrome 名称为“领客 · 平台填写”v0.2.0。无需旧 Demo 服务。为减少目录改动，沿用 `src/page, controls, runner, shell`，平台接缝单列 `src/platform`。

- **填写行为**：16 个 page/controls/runner 和 content/coordinator/transport 文件逐个比对，仅替换公共契约 import。宠物、经历操作、扫描与填写规则未改；UI 仅改平台连接提示及 popup 账号面板。
- **平台认证**：popup 邮箱/密码登录，后台保存访问令牌与账号元数据，密码提交后清空；存储设为 `TRUSTED_CONTEXTS`。content 无法直接读取凭据或调用 popup 认证命令。主动退出清除本地并尝试撤销服务器会话；网络失败不自动清理。
- **HTTP**：固定服务源、固定三条 `/autofill/v2/*` 路由，后台附 Bearer；同扩展和 document 校验、请求关联、上限、deadline、取消及并发账号变更保护。不接入通用 AI 代理，不把简历读取搬到 content。
- **续期边界**：现有平台刷新语义不满足访问令牌到期后续期，P3 不调用 refresh、不保存 refreshToken、不改数据库。401 标记需重新登录并保留本地 Token，403/网络故障不删除；已过期或离线退出明确提示服务器撤销未确认。
- **构建**：contracts workspace 依赖，content IIFE / background 与 popup ESM，独立 buildId、静态宠物资源与 manifest。生产必须显式 HTTPS 服务源，manifest 随地址生成后台权限；没有运行时跨目录依赖或旧 Demo 密钥。

实际 Chrome 联调使用真实安装包、原生 popup 点击和输入、临时浏览器 profile、真实平台 API 及独立 PostgreSQL 16。两组合成账号先通过平台资料 API 入库，填写时经过投影服务和新路由；仅模型 HTTP 输出受控，不调用付费供应商。验证通过：

1. 未登录时不扫描增项或填写；content 读取登录存储被拒绝；关闭重开 popup 后登录保留。
2. A/B 两账号分别填写两段教育经历，8 字段/账号均与各自数据库资料一致；从一条空经历增到两条，重新渲染后值仍在业务状态中，无账号串用。
3. 实际请求经过 `/auth/extension/login` 和三条 `/autofill/v2/*`，没有旧 `/v1/*` 调用。退出后真实数据库会话撤销。
4. 服务端令牌到期后提示登录、保留本地凭据且未写字段；重新登录后取消在途填写，模型 HTTP 连接关闭；全程提交次数为 0。

本地合成页面两轮分别 **4.500 秒 / 4.419 秒**（包含扩增、填写和自动检查）。这是接缝联调结果，不代表美团/Moka 速度、真实 AI 延迟或实站准确率。该测试构建 ID 为 `78d392d22ac76cf9da94`，测试地址随机，默认开发构建 ID 因配置不同而不同。

最终检查：扩展认证/传输测试 **7/7**、平台 API 回归 **60/60**，扩展严格类型检查与打包通过；默认开发 buildId 为 `c0617c66b6b10336172e`。测试临时 API、Chrome profile 和隔离数据库已清理。

未进行生产部署、招聘页面填写复测或自动续期改造。后续 P4 使用平台新扩展重新获得实站验收结果，不能套用独立 Demo 数据。

## 12. P4 构建、Docker 与美团实站验证（2026-10-18）

根目录全量构建和 72 项相关测试通过；API / Web 的 Linux ARM64 生产镜像构建、独立 PostgreSQL 迁移、生产认证与来源限制、三条填写路由、资料隔离、版本冲突、退出撤销、Web 页面与静态资源均通过。生产扩展 HTTPS 构建另行通过。仅修正 Docker 上下文排除和 esbuild 安装脚本许可，增加可重复的 `test:docker`；未改页面填写逻辑。

用户加载新扩展后，已在美团校招个人中心通过原生 popup 点击完成三轮独立端到端测试。完整合成资料经隔离数据库、平台资料服务与新路由进入当前扩展；三轮均正确新增/覆盖 41/68 项，新写入准确率 100%，召回率 60.3%，耗时 73.365 / 73.262 / 72.069 秒。工作、项目各从 2 条扩增为 3 条；校园、荣誉、证书、论文空白区未建立，部分有来源字段未覆盖，整体完整度未通过。实际 AI 调用为 0，没有改页面填写逻辑，也未保存或投递简历。临时账号已退出，隔离容器、卷和网络已清理，页面未保存结果保留供查看。具体指标分母、视觉证据、接口耗时、镜像 ID 及后续缺口见 [P4 验收记录](autofill-p4-validation.md)。
