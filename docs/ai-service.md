# AI 服务调用说明

当前后端把简历解析和智能填写统一交给 `apps/api/src/ai/gateway.js`。业务接口只负责校验用户和输入，任务文件负责提示词与输出结构，Provider 文件负责对接具体模型供应商。

## 调用入口

```text
POST /ai/resume/parse
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

智能填写请求示例：

```json
{
  "fields": ["姓名", "期望职位"],
  "profile": {"name": "陈思远"},
  "jobContext": {"company": "示例公司", "title": "算法工程师"}
}
```

## 更改重试策略

修改 `apps/api/src/ai/policy.js`。默认尝试顺序是：

```text
便宜模型 → 便宜模型 → 官方模型
```

环境变量可以调整次数和时间：

```env
AI_MAX_ATTEMPTS=3
AI_TIMEOUT_MS=30000
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

视觉请求会自动从 `AI_VLM_CHEAP_*` 读取 cheap 档位，从 `AI_VLM_OFFICIAL_*` 读取 official 档位，重试顺序与文本模型相同。

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

当前接口是同步调用，适合先完成联调。简历较大或模型耗时稳定后，再将任务放入现有 `apps/worker` 和 Redis 队列；届时 Gateway 的重试策略可以原样复用，队列重试应单独处理 Worker 崩溃，避免重复放大模型费用。
