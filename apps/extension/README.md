# 领客 · 平台填写扩展

P3（2026-10-18）：从 `resume-autofill-next` 迁入页面引擎，接入平台账号和 `/autofill/v2/*`。运行、构建和测试不依赖原 Demo 目录。页面扫描、经历增减、控件操作、runner 和 content 编排保持原逻辑，只有公共契约的导入位置变化。

## 模块边界

| 目录 | 责任 |
| --- | --- |
| `src/page`、`src/controls`、`src/runner` | 扫描与实际页面填写；不导入平台认证或 HTTP 实现 |
| `src/shell` | content、宠物、popup、本地消息；background 是组合入口 |
| `src/platform/auth.ts` | 登录、退出、失效状态、并发账号变更保护 |
| `src/platform/token-store.ts` | 可信上下文存储、串行读写、按 revision 更新 |
| `src/platform/api-client.ts` | 固定平台路由、Bearer、取消、截止时间、响应限制 |
| `src/platform/config.ts` | 校验构建时的平台地址，不接受招聘页面传入的 URL |

依赖方向为 `shell → platform / 页面引擎 → @job-assistant/autofill-contracts`。只有后台调用平台 HTTP；页面拿不到密码、Token、账号元数据或供应商密钥。公共契约包不包含 Chrome、认证和服务端实现。

## 构建与安装

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm --filter @job-assistant/extension build
```

Chrome 的“加载已解压的扩展程序”选择 **`job-assistant-platform/apps/extension/dist`**，名称为 **领客 · 平台填写**，版本 `0.2.0`。不要选择源码目录或旧 Demo。`dist/build.json`、扩展版本详情和账号面板均可核对 buildId。

默认开发地址为 `http://127.0.0.1:3001`。需要更换时重新构建，不在 popup 粘贴地址或 Token。生产构建必须显式指定 HTTPS 服务源：

```bash
EXTENSION_MODE=production EXTENSION_API_ORIGIN=https://linkaigo.com EXTENSION_API_PATH_PREFIX=/api \
  pnpm --filter @job-assistant/extension build
```

构建脚本读取进程环境，不自动加载 `.env`。`EXTENSION_API_ORIGIN` 只包含协议、域名和端口；代理路径由 `EXTENSION_API_PATH_PREFIX` 单独指定，默认空，末尾斜杠会移除。例如 `/api` 或独立测试环境 `/autofill-test/api`。拒绝路径穿越、查询参数、账号密码及非本地 HTTP。manifest 的后台 host permission 随服务源生成；客户端仅请求配置前缀下的固定路由，不跟随重定向。登录凭据同时绑定源和前缀，切换环境后必须重新登录。

在平台 `.env` 中把实际扩展 ID 加入 `AUTOFILL_EXTENSION_ORIGINS=chrome-extension://<id>`，多个源逗号分隔，随后启动或重启 API：

```bash
pnpm --filter @job-assistant/api dev
```

打开招聘页面并刷新，在扩展图标 → 领客账号中登录平台已有账号，然后点击填写。读取资料使用平台数据库，规则和 AI 配置仍由后端决定。生产账号须满足平台邮箱验证策略。无自动提交申请动作。

## 请求与认证

```text
popup 登录 → background auth → POST /auth/extension/login
content 填写 → background → POST /autofill/v2/readiness
                         → POST /autofill/v2/analyze
                         → POST /autofill/v2/plan
popup 退出 → 停止当前页面填写 → 清理本地登录 → POST /auth/extension/logout
```

- 凭据保存在 `chrome.storage.local.platformAuth`，首次访问前设置 `TRUSTED_CONTEXTS`；实际 content 上下文读取被拒绝。只向 popup 返回登录状态、邮箱、过期时间和配置地址，向 content 仅返回状态。
- 仅真实 popup sender 可调用登录/退出；填写请求限定为同扩展、顶层页面和具体 document。取消不能中止其他标签页或 document 的请求。账号切换会取消在途请求，迟到的登录响应、401 和旧账号结果不能覆盖新登录。
- 密码输入提交后立即清空，不持久化。现有平台刷新接口与访问令牌共用到期时间，P3 **不接入自动刷新**，也不保存无用 refreshToken；令牌到期或 401 提示重新登录。
- 没有定时清理 Token；401 仅标记需重新登录，403/网络错误不删除凭据。主动退出清除本地状态；离线或令牌已过期时会显示服务器撤销未确认，不假报撤销成功。
- 单次填写 HTTP 请求最大 512 KiB，响应最大 1 MiB，总预算最多 45 秒；取消同时中断 fetch。无后台自动重放，避免重复网页动作。API 错误只返回固定代码，不透传上游错误正文。

Chrome 存储隔离依据：[storage.setAccessLevel](https://developer.chrome.com/docs/extensions/reference/api/storage)。消息来源依据：[runtime.MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime)。

## 验证

```bash
pnpm --filter @job-assistant/extension test
```

包含严格 TypeScript 检查、打包以及认证/HTTP/消息边界测试。完整浏览器联调必须使用**独立测试数据库**，会创建合成账号和资料：

```bash
pnpm --filter @job-assistant/api build
DATABASE_URL='<isolated-test-database-url>' \
  pnpm --filter @job-assistant/api exec prisma migrate deploy --schema src/prisma/schema.prisma
DATABASE_URL='<isolated-test-database-url>' \
  pnpm --filter @job-assistant/extension test:browser
```

浏览器测试默认使用 macOS Chrome，可用 `CHROME_PATH` 指定；需要支持 CDP `Extensions.loadUnpacked/triggerAction` 的 Chrome。测试启动临时 Chrome profile、真实平台 API 和本机受控模型 HTTP 服务，加载实际构建包，通过原生鼠标和键盘操作 popup，不向页面注入替代扩展。数据库资料经过真实投影、网关和新路由，只有模型输出受控，不使用真实 AI 密钥。临时浏览器、API 和扩展测试产物在退出时清理，数据库由调用者销毁。

已通过：未登录拦截、popup 登录/重开/退出、content 凭据隔离、两账号各两条教育经历共 8 字段正确填写、业务状态重绘保留、401 保留凭据并提示登录、取消传到模型 HTTP、未提交申请。单次本地合成页面计时分别为 4.500 秒、4.419 秒（含扩增、填写和测试检查），不代表招聘网站或真实供应商耗时。

后续 P4 再进行生产部署验证及招聘网站端到端测试；规则范围、AI 策略和页面填写算法本阶段没有调整。整体进度见[接入文档](../../docs/integration/autofill-integration.md)。
