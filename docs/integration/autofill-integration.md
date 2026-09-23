# 填写助手合入主仓指导

本文给已经完成填写助手 Demo 的开发者使用。目标是把 Demo 的扫描、匹配、确认填写和验证能力接入 `job-assistant-platform`，同时让填写助手成为独立功能域，不把页面适配、资料读取和 AI 调用散落到工作台或认证代码中。

## 先确认 Demo 边界

当前几个 Demo 的能力不同：

- `../archive/legacy-demos-2026-09-21/autofill-fast-demo` 是可以作为第一版迁移基础的完整链路：扫描页面、按本地规则匹配、调整教育/经历/项目重复项、批量调用 AI、执行原生控件填写并回读验证。
- `fast-fill-rebuild` 只完成通用扫描、重复组探测和增减，`FILL_PLAN` 仍是 `accepted: false`，不能当成已完成的填写实现。
- `autofill-reuse` 的证据约束和回读验证更完整，可把其中的 source block、evidence 和撤销思路迁移进后续版本，但不要把它的旧模型直连代码带入主仓。
- `../archive/legacy-demos-2026-09-21/autofill-mvp` 依赖扩展端直接配置模型接口和 API Key，不合入主仓。

主仓的 `apps/extension` 目前仍是占位 Service Worker。合入填写助手意味着新增插件功能，不是把现有几个文件简单复制过去。

## 合并方式

1. 从主仓当前 `main` 创建 `codex/integrate-autofill` 分支；不要把 Demo 的 Git 历史或独立 `package.json` 合进主仓。
2. 先复制能复用的纯浏览器模块到 `apps/extension/src/autofill/`，建议目录如下：

   ```text
   apps/extension/
   └── src/
       ├── background/
       │   ├── index.ts              # 消息路由、Token 刷新、API 调用
       │   └── api-client.ts
       ├── content/
       │   ├── index.ts              # 页面生命周期和运行状态
       │   ├── scanner.ts            # DOM / iframe / Shadow DOM 扫描
       │   ├── matcher.ts             # 本地字段匹配与资料归一化
       │   ├── executor.ts            # 用户确认后的控件填写
       │   └── repeat-groups.ts       # 动态经历卡片增减
       ├── popup/
       └── auth/
           └── token-storage.ts
   packages/shared/src/autofill/
   └── contracts.ts                  # 只放跨端 DTO、枚举和纯校验
   ```

3. 不要从 `apps/web` 导入插件实现，也不要从插件直接导入 Prisma、Next.js 或 Node API。插件只依赖 `packages/shared` 的类型和 HTTP API。
4. `apps/extension/src/content` 只负责当前页面的扫描、匹配、填写和验证；`background` 负责认证、API 和缓存；服务器端 AI 任务放在 `apps/api/src/ai/tasks/autofill.js`，不在扩展中保存模型密钥。
5. 合并时保持独立提交：扫描器、API 客户端、弹窗/认证、填写执行器、测试分别提交。集成负责人再合并到 `main`，避免与投递航迹同时改动工作台壳和认证组件。

## 数据流

```text
招聘页面 DOM
  ↓ content scanner
RawField / RepeatGroup（只描述当前页面，不含用户资料）
  ↓ matcher
本地高置信匹配 + profile recordIndex
  ↓ popup 请求用户确认
未知字段批量发送 background → API
  ↓ POST /ai/autofill/suggestions
候选值、来源、置信度、是否需要确认
  ↓ 用户确认
executor 使用原生 setter / input / change / readback
  ↓
填写完成事件（不是投递成功）
  ↓ 用户明确点击“已投递”时
投递航迹 API 创建或更新 application
```

填写助手永远不能自动点击最终提交按钮。`fill.completed` 只能表示页面字段已经按用户确认写入并通过回读验证；只有用户在插件或 Web 端明确确认后，才发送 `application.submitted` 事件给投递航迹模块。

## 页面字段契约

扫描器对外返回稳定的字段 DTO，不能把 DOM 节点、选择器对象或整段 `outerHTML` 发送给 AI：

```ts
type FormField = {
  fieldId: string;
  role: 'textbox' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'date' | 'contenteditable';
  label: string;
  name?: string;
  placeholder?: string;
  section?: string;
  repeatType?: 'education' | 'work' | 'internship' | 'project' | 'campus' | 'award' | 'publication' | 'language' | 'certificate';
  recordIndex?: number;
  options?: Array<{ label: string; value?: string }>;
  multiple?: boolean;
  locked?: boolean;
  hasValue?: boolean;
};
```

`fieldId` 只在本次页面运行期间稳定；不要把它写入数据库，也不要跨页面缓存 DOM 选择器。重复经历必须使用 `repeatType + recordIndex`，不能靠字段在 DOM 中出现的全局序号取值。

## 使用主仓认证和资料 API

插件使用 Extension Token，不使用 Web Cookie：

```http
POST http://localhost:3001/auth/extension/login
Content-Type: application/json

{"email":"user@example.com","password":"..."}
```

返回 `accessToken`、`refreshToken` 和 `expiresIn`。Access Token 只放在 `chrome.storage.local` 的插件受控存储中；请求带：

```http
Authorization: Bearer <accessToken>
```

收到 401 时只允许执行一次：

```http
POST /auth/extension/refresh
{"refreshToken":"..."}
```

刷新失败则清空 Token 并要求重新登录。不要在 content script 或页面 localStorage 保存 Token。退出使用 `POST /auth/extension/logout`。

读取用户资料：

```http
GET /profiles/me
Authorization: Bearer <accessToken>
```

响应是主仓资料信封：`profile`、`preferences`、`educations`、`experiences`、`campusExperiences`、`projects`、`awards`、`publications`、`languages`、`certificates`、`skills`。插件的 `normalizeProfile()` 可以作为纯函数迁移，但要保留这些数组和 `extra.profileSection`，不能把校园经历、奖项或论文误当成工作经历。

## 结构化简历读取 API 与版本化字段表

填写助手应该有稳定的简历读取契约和页面字段契约。它们是两份不同的数据：

1. **简历上下文**来自平台 API，描述当前用户可以用于填写的结构化资料。
2. **页面字段表**来自 content script，描述当前招聘页面实际发现的控件。

不能让插件直接依赖 Prisma 字段，也不能用页面上的中文显示标签作为数据库字段名。当前主仓已经提供 `GET /profiles/me/autofill-context`，另外提供 `GET /profiles/me/export` 作为下载式别名；两者都沿用现有认证和用户隔离规则：userId 从 Cookie/Extension Token 获取，不接受请求体中的 userId。普通资料页仍可使用 `GET /profiles/me`，但填写助手应优先使用投影接口。

联调示例：

```bash
curl -H 'Authorization: Bearer <extension_access_token>' \
  http://localhost:3001/profiles/me/autofill-context

curl -OJ -H 'Authorization: Bearer <extension_access_token>' \
  http://localhost:3001/profiles/me/export
```

脱敏的静态测试数据位于 `apps/extension/fixtures/autofill-context.example.json`，可以在插件尚未接通 API 时直接作为 `normalizeProfile()` 和重复经历索引的输入。

建议响应：

```json
{
  "schemaVersion": "resume.autofill.v1",
  "profileVersion": "64 位十六进制内容摘要",
  "generatedAt": "2026-09-19T08:30:01Z",
  "profile": {
    "name": "候选人",
    "phone": "13800000000",
    "email": "user@example.com",
    "targetTitles": ["算法工程师"]
  },
  "records": [
    {
      "id": "education-id",
      "recordType": "education",
      "index": 0,
      "fields": {"school": "示例大学", "degree": "硕士", "major": "计算机"},
      "extra": {}
    },
    {
      "id": "experience-id",
      "recordType": "experience",
      "index": 0,
      "fields": {"company": "示例公司", "title": "算法实习生", "current": false},
      "extra": {}
    }
  ]
}
```

字段规则：

- `schemaVersion` 是接口结构版本；新增可选字段保持 `v1`，重命名、删除或改变含义才升主版本。
- `profileVersion` 是当前结构化资料投影的 SHA-256 摘要（64 位十六进制字符串），用于缓存失效和调试；插件缓存必须包含它。
- `profile` 和每条记录的 `fields` 使用稳定的字段名。个人资料直接使用 `name`、`phone` 等字段，经历记录在自己的 `recordType` 下使用 `school`、`company`、`title` 等字段；显示文案和页面定位信息另放在页面字段表中。
- 每条可重复经历必须有服务端 `id` 和本次 `index`，不能依赖数组位置作为持久化标识。
- 新的资料类型通过 `recordType` 扩展；旧插件遇到未知类型应忽略，不得把它当成工作经历。
- 无法归入当前 `recordType` 字段表的内容放入 `extra`，但 AI 和执行器不能默认读取 `extra` 覆盖正式字段。`extra.profileSection` 等分区元数据也保留在这里。
- 所有值都使用 `string | boolean | null` 或明确的字符串数组；日期保留规范化后的值和原始精度，不在插件内猜测。

页面字段表则由扫描器产生，至少包含：

```ts
type PageField = {
  fieldId: string;                 // 本次页面运行内唯一，不能入库
  fieldSchemaVersion: 'page-field.v1';
  semanticKey?: string;            // 本地已识别时填写，如 experience.title
  label: string;                   // 展示和调试用，不是持久化键
  role: string;
  section?: string;
  repeatType?: string;
  recordIndex?: number;
  options?: Array<{ label: string; value?: string }>;
  required?: boolean;
  locked?: boolean;
  hasValue?: boolean;
};
```

`fieldId` 随页面 DOM 变化，只能用于本次扫描、AI 返回和执行回读；数据库不保存它。`semanticKey` 未识别时为空，交给 AI 依据字段对象和简历上下文给候选值，不允许通过模糊字符串把一个页面字段映射到另一个字段。

### 版本演进规则

- 服务端至少兼容当前版本和前一个版本；扩展请求带 `schemaVersion` 与 `fieldSchemaVersion`。
- 读取 API 只做向后兼容的加法；页面字段的 breaking change 由 scanner 增加版本并在 API 校验层明确拒绝未知版本。
- 任何字段映射变化都先更新 `packages/shared` 的 DTO、API 校验、扩展 adapter 和 fixture，再改 UI。
- API 返回 `capabilities` 或 `supportedRecordTypes` 时，插件按能力降级；不要通过猜测字段名继续填写。
- 资料更新后，插件下一次运行重新读取 `autofill-context`；不能只依赖旧的 `resumeText` 缓存。

## 使用 AI 智能填写 API

插件 background 调用主仓 API，不直接调用模型供应商：

```http
POST /ai/autofill/suggestions
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "fields": [
    {"fieldId":"ff:work:0:title","label":"职位名称","role":"textbox","repeatType":"work","recordIndex":0}
  ],
  "profile": {"name":"候选人","experiences":[{"title":"算法实习生"}]},
  "jobContext": {"url":"https://example.com/job/1","title":"算法工程师","company":"示例公司"},
  "requestId":"uuid"
}
```

现有主仓任务的最低请求格式是 `fields: string[]`，而 Demo 的请求/响应已经按 `fieldId` 工作；两者不能直接混用。接入前必须先统一为结构化字段 DTO，并扩展 `apps/api/src/ai/tasks/autofill.js` 的校验和提示词，同时更新 `packages/shared/src/autofill/contracts.ts`。建议由服务端原样回传客户端提供的 `fieldId`，模型只负责选择候选值，禁止让模型重新生成或模糊猜测 ID：

```json
{
  "data": {
    "suggestions": [
      {"fieldId":"ff:work:0:title","value":"算法实习生","confidence":0.92,"needsConfirmation":true,"source":"profile"}
    ]
  },
  "requestId":"uuid",
  "attempts":[{"attempt":1,"tier":"cheap","status":"succeeded"}]
}
```

主仓当前 Gateway 返回的是 `{ data: { suggestions }, requestId, attempts }`，而 Demo 的 `normalizePlan()` 读取的是顶层 `suggestions`/`mappings`。合入时必须在一个地方统一解包（推荐扩展 API client 统一转成上面的 DTO），并为 `field` 与 `fieldId` 设置兼容期；不能让 content script 同时猜两套响应结构。

AI 只为未知字段兜底。本地精确匹配优先，AI 返回空值或低置信度时保留字段未填写并显示原因；不得用模型结果覆盖用户已经填写的页面值。`needsConfirmation` 为 `true` 的候选值必须在插件 UI 中逐项或批量确认。

Gateway、模型和重试策略只改服务端：

- 任务提示词与 schema：`apps/api/src/ai/tasks/autofill.js`
- 重试和超时：`apps/api/src/ai/gateway.js`、`apps/api/src/ai/policy.js`
- 模型/供应商：`.env` 的 `AI_*`，不要把 Key 放入扩展

## 填写执行与投递航迹的边界

执行器必须支持写入后验证：文本、select、combobox、日期、radio、checkbox、contenteditable 都通过页面原生事件触发，并重新扫描或读取控件确认结果。动态经历卡片先按资料条数增减，再重新扫描，不能复用增减前的节点引用。

一次填写运行生成内存中的 `fillRunId` 和结果：

```json
{
  "fillRunId":"uuid",
  "pageUrl":"https://example.com/job/1",
  "fieldsFound":32,
  "matched":25,
  "filled":24,
  "verified":24,
  "unknown":7,
  "complete":false
}
```

这份结果可以发送 `fill.completed` 事件，但不能自动创建“已投递”状态。投递航迹的 application 由单独模块负责，填写助手只调用其公开的事件客户端，不导入 application repository。

## 必须修正的 Demo 问题

合入前不要照搬以下行为：

1. `../archive/legacy-demos-2026-09-21/autofill-fast-demo/server.mjs` 是独立代理，只提供 `/ai/autofill/suggestions`，没有主仓认证和资料接口；生产插件必须改用 `API_URL` 主仓。
2. Demo 的 AI 计划缓存只使用 hostname、简历文本和字段结构。数据库资料变化且 `resumeText` 为空时会读到旧计划；缓存键必须包含规范化 profile 的 hash、页面 URL/职位上下文和字段 schema 版本。
3. Demo 的完成判断使用请求前的 `unknown.length`，可能在 AI 成功填写后仍报未完成。应以最终未验证字段、被拒绝候选和执行错误计算 `complete`。
4. 不要把 `../archive/legacy-demos-2026-09-21/autofill-mvp` 或旧 `autofill-reuse` 的 API Key 直连模型代码带入主仓。
5. 只有页面字段发生变化或用户重新运行时才重新扫描；任何失败都要允许用户重试或撤销本次填写。

## 前端与插件的职责边界

- `apps/web/app/workspace/autofill`：展示填写助手说明、连接状态、最近运行结果；不扫描招聘页面，不直接调用 DOM。
- `apps/extension`：扫描、匹配、确认、执行和展示本页结果。
- `apps/api/src/ai/tasks/autofill.js`：AI 候选值生成与输出校验。
- `apps/api/src/profile`：只读资料信封和用户隔离；不依赖插件页面模型。
- `apps/api/src/modules/applications`：填写完成/用户确认投递后的投递记录与事件，填写助手通过 DTO 或 API 客户端访问。

## 测试与验收

先在 Demo 原目录运行现有测试，再在主仓加入不依赖真实招聘网站的 fixture：

```bash
cd ../archive/legacy-demos-2026-09-21/autofill-fast-demo && npm test
cd fast-fill-rebuild && npm test
cd job-assistant-platform
pnpm --filter @job-assistant/api test
pnpm --filter @job-assistant/extension test
pnpm --filter @job-assistant/web build
```

验收至少包括：

- 未登录时插件不能读取资料，401 后刷新 Token 只执行一次。
- 资料只能来自当前用户，不能接受请求体中的 `userId`。
- 本地规则填写后 readback 与目标值一致。
- AI 不确定字段显示确认，不自动写入或提交。
- 教育、工作、项目重复项数量和 `recordIndex` 一一对应。
- 页面提交按钮从不由插件自动点击。
- 填写失败可重试，缓存不会跨资料版本复用。
- `fill.completed` 不会创建 `application.submitted`。

## 回滚

填写助手通过 feature flag 或 manifest 版本控制启用。回滚时只禁用插件的 `fill` 入口和 `/ai/autofill/suggestions` 调用，不回滚用户资料、认证或投递记录。扫描器和资料读取保持只读，以便继续收集兼容性问题。
