# AI 服务调用说明

当前后端把简历解析和智能填写统一交给 `apps/api/src/ai/gateway.js`。业务接口只负责校验用户和输入，任务文件负责提示词与输出结构，Provider 文件负责对接具体模型供应商。

## 调用入口

```text
POST /ai/resume/parse
POST /ai/resume/parse-file
POST /ai/resume/normalize
POST /ai/autofill/suggestions
POST /ai/vision/extract
```

以下接口均要求登录。前端和浏览器插件不直接接触模型 API Key。

简历解析请求示例：

```json
{
  "filename": "resume.txt",
  "content": "简历正文"
}
```

文件解析请求（PDF 会在服务端渲染为页面图片，再按 `RESUME_PDF_EXTRACTOR` 调用 OCR 或视觉模型；DOCX 提取正文后、TXT/Markdown 走文本模型；旧版 DOC 暂不支持）:

```json
{
  "filename": "resume.pdf",
  "contentType": "application/pdf",
  "contentBase64": "JVBERi0x..."
}
```

资料页面上传 PDF、DOCX、TXT 和 Markdown 都统一调用 `/ai/resume/parse-file`。TXT/Markdown 也必须走这个入口，因为它会在原始抽取后继续执行 `resume.normalize`，返回稳定的 canonical 分区；`/ai/resume/parse` 只保留给调试原始模型输出，不应直接用于资料导入。

默认生产配置使用百度高精度无位置 OCR：

```env
RESUME_PDF_EXTRACTOR=baidu_ocr
BAIDU_OCR_API_KEY=
BAIDU_OCR_SECRET_KEY=
```

OCR 只把每页识别文本交给简历标准化任务，不把百度凭证或原始 PDF 发给前端。若切回页面视觉模型，将值改为 `vision`。

响应中的 `databaseRows` 是复用实际导入器生成的 Profile、JobPreference、Education、Experience、Project、Skill 行预览；`databaseReady` 保留前端使用的九个语义分区。该接口只生成预览，不写入数据库；确认后再将它传给
`POST /profiles/me/resume/import`。服务端最多处理 8 页，原始 PDF 不会持久化，渲染临时文件会在请求结束时删除。

智能填写请求示例：

```json
{
  "fields": ["姓名", "期望职位"],
  "profile": {"name": "陈思远"},
  "jobContext": {"company": "示例公司", "title": "算法工程师"}
}
```

## 更改重试策略

策略由 `apps/api/src/ai/policy.js` 统一解析，文本模型和视觉模型分别配置。当前默认值是：

```text
文本任务：便宜模型 → 便宜模型 → 官方模型
视觉任务：官方模型（暂不降级）
```

在 `.env` 中切换视觉策略，cheap 模型稳定后改为：

```env
AI_VLM_RETRY_STRATEGY=cheap_then_official
```

可选值为 `official_only`、`cheap_then_official` 和 `cheap_only`。文本任务可通过 `AI_TEXT_RETRY_STRATEGY` 单独调整；简历字段标准化还可通过 `AI_RESUME_RETRY_STRATEGY` 单独调整，当前生产配置为 `cheap_then_official`：优先使用 cheap，失败后再使用第二次 cheap，最后切换 official。

环境变量可以调整次数和时间：

```env
AI_MAX_ATTEMPTS=3
AI_TIMEOUT_MS=30000
AI_RESUME_TIMEOUT_MS=90000
AI_RETRY_BASE_MS=500
AI_RETRY_MAX_MS=5000
```

只会重试超时、网络错误、429、5xx 和结构化输出错误。参数错误、鉴权错误和输入过大不会重试。

## 更换模型或供应商

修改 `.env`，不要改业务任务代码：

```env
AI_PROVIDER_MODE=http
AI_CHEAP_PROVIDER=openai-compatible
AI_CHEAP_BASE_URL=https://cheap-provider.example/v1
AI_CHEAP_API_KEY=
AI_CHEAP_MODEL=cheap-model
AI_OFFICIAL_PROVIDER=openai-compatible
AI_OFFICIAL_BASE_URL=https://official-provider.example/v1
AI_OFFICIAL_API_KEY=
AI_OFFICIAL_MODEL=official-model
```

当前 HTTP Provider 使用兼容 OpenAI Chat Completions 的接口。如果供应商协议不同，在 `apps/api/src/ai/providers/` 新增适配器，并在 `index.js` 的 Provider 工厂中选择它。

视觉模型使用另一组配置，避免把文本模型和 VLM 的模型名、额度混在一起：

```env
AI_VLM_CHEAP_PROVIDER=openai-compatible
AI_VLM_CHEAP_BASE_URL=https://cheap-vlm.example/v1
AI_VLM_CHEAP_API_KEY=
AI_VLM_CHEAP_MODEL=cheap-vision-model
AI_VLM_OFFICIAL_PROVIDER=openai-compatible
AI_VLM_OFFICIAL_BASE_URL=https://official-vlm.example/v1
AI_VLM_OFFICIAL_API_KEY=
AI_VLM_OFFICIAL_MODEL=official-vision-model
```

视觉接口接收 1 到 8 张图片，每张图片可以是 HTTPS `url` 或 base64 `data`，单张不超过 5MB、总大小不超过 8MB：

```json
{
  "images": [{"data": "...", "mimeType": "image/jpeg"}],
  "instruction": "提取表单中的字段名和值"
}
```

视觉请求会自动从 `AI_VLM_CHEAP_*` 读取 cheap 档位，从 `AI_VLM_OFFICIAL_*` 读取 official 档位；具体调用顺序由 `AI_VLM_RETRY_STRATEGY` 决定，与文本策略互不影响。

本地测试可以使用：

```env
AI_PROVIDER_MODE=fake
AI_FAKE_FAILURES=2
```

这会让 fake provider 前两次失败，验证最后一次是否切换到官方档位，不会产生真实模型费用。

## 业务任务位置

- 简历解析提示词和结果校验：`apps/api/src/ai/tasks/resume-parse.js`
- 智能填写提示词和结果校验：`apps/api/src/ai/tasks/autofill.js`
- 重试、超时、降级：`apps/api/src/ai/gateway.js`、`apps/api/src/ai/policy.js`
- 供应商请求格式：`apps/api/src/ai/providers/http-provider.js`
- 视觉任务与多模态消息：`apps/api/src/ai/tasks/vision-extract.js`
- 百度高精度无位置 OCR：`apps/api/src/ai/providers/baidu-ocr.js`
- OCR 文本到数据库字段的 canonical schema：`apps/api/src/ai/tasks/resume-normalize.js`
- 归一化结果到 Prisma 行的单一投影：`apps/api/src/profile/resume-import.js` 的 `toDatabaseRows`

## 简历结果写入资料

简历识别完成后，使用 `POST /profiles/me/resume/import` 写入当前用户资料。空的单值字段会直接写入；已有不同值时返回 `409 PROFILE_IMPORT_CONFLICT`，前端可按字段传 `resolutions`：

```json
{
  "result": { "profile": {}, "preferences": {}, "records": {} },
  "resolutions": {
    "profile.name": "replace",
    "preferences.targetCities": "keep"
  }
}
```

通常不要自行拼接幂等键。省略 `idempotencyKey` 时，服务端会对规范化后的完整 payload 计算稳定哈希：同一份规范化内容不会重复写入；模型或字段映射修复后产生的新内容会得到新哈希，不会被旧的“文件名 + 文本长度”结果挡住。只有外部队列已经有稳定任务 ID 时，才传入该任务 ID。

规范化 API 的语言记录统一使用 `{ "name": "英语", "level": "商务会话" }`；网页编辑器再将 `name` 映射为表单字段 `language`。教育、项目、语言、证书、技能等分区都先经过 `normalizePayload` 和 `toDatabaseRows`，不会由前端直接决定 Prisma 表或字段。

教育、工作、项目、技能、语言、证书、奖项、论文和校园经历始终按新条目追加，不与已有记录合并。接口使用 `ResumeImport` 和幂等键，冲突解决重试不会重复添加经历。

当前接口是同步调用，适合先完成联调。简历较大或模型耗时稳定后，再将任务放入现有 `apps/worker` 和 Redis 队列；届时 Gateway 的重试策略可以原样复用，队列重试应单独处理 Worker 崩溃，避免重复放大模型费用。
