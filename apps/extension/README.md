# 领客 · 平台填写扩展

扩展使用领客网页的 Cookie 会话。点击“前往网页登录”，在网站登录后回到招聘页面即可填写；扩展不再提供账号、密码或 Token 输入框。页面扫描、经历增减、控件操作和填写算法保持原有实现。

## 模块边界

| 目录 | 责任 |
| --- | --- |
| `src/page`、`src/controls`、`src/runner` | 扫描与页面填写，不依赖平台认证实现 |
| `src/shell` | 宠物、popup、消息校验、管理员调试入口 |
| `src/platform/auth.ts` | Cookie 会话状态、账号变化和在途请求隔离 |
| `src/platform/api-client.ts` | 固定路由、携带 Cookie、取消和响应限制 |
| `src/platform/config.ts` | 构建时的平台地址与网页登录地址 |

仅 background 调用平台 HTTP。Cookie 由浏览器管理，扩展不读取 Cookie 值、不保存密码或登录 Token；招聘页面不能指定后端或登录 URL。

## 构建与安装

仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm --filter @job-assistant/extension build
```

Chrome 加载 **`job-assistant-platform/apps/extension/dist`**，名称为 **领客 · 平台填写**。修改后重新构建并在扩展管理页重载，招聘页面也需刷新。`dist/build.json`、扩展详情及管理员“开发信息”可核对 buildId。

默认开发 API 为 `http://127.0.0.1:3001`，登录页为 `http://127.0.0.1:3000/login`。本地网站必须使用同一主机名，不能混用 `localhost` 和 `127.0.0.1`。

```bash
# 生产示例；需先部署支持 Cookie 和角色能力的新 API。
EXTENSION_MODE=production EXTENSION_API_ORIGIN=https://linkaigo.com \
  EXTENSION_API_PATH_PREFIX=/api EXTENSION_LOGIN_URL=https://linkaigo.com/login \
  pnpm --filter @job-assistant/extension build
```

构建脚本读取进程环境，不自动加载 `.env`。生产登录 URL 必须与 API 同源且使用 HTTPS；API 前缀独立配置，禁止查询参数或路径穿越。

API 配置 `AUTOFILL_EXTENSION_ORIGINS=chrome-extension://<实际扩展ID>`，多个来源逗号分隔。`WEB_ORIGIN` 配置网页来源。本地网页的 `NEXT_PUBLIC_API_URL` 必须指向同一 API。

**网页登录和扩展必须使用同一个会话数据库。** 独立测试 API 不能搭配生产网页登录；部署测试环境时，应同时提供连接测试 API 的网页，并转发 `/auth/me`、网页登录接口及 `/autofill/v2/*`。Cookie 路径/域也应隔离，避免覆盖生产登录。

## 请求与权限

```text
扩展按钮 → 领客网页登录 → 网站设置 HttpOnly Cookie
background → GET /auth/me → 登录状态、角色、能力
content → background → POST /autofill/v2/readiness → analyze → plan
```

所有扩展请求使用 `credentials: include`。每次填写请求附带已识别账号 ID，后端将其与真实会话用户比较；不同则拒绝，不能通过该 ID 选择他人的资料。会话失效后重新去网页登录，退出在网站完成。旧 Bearer 接口保留供既有客户端使用，新扩展不使用。

| 角色 | 扩展能力 |
| --- | --- |
| `user`（普通用户） | 填写、填写选项、进度和可读结果 |
| `admin`（管理员） | 以上功能，加规则采集、原始 JSON、运行诊断、构建及服务信息 |

注册始终创建普通用户，客户端不能传入管理员角色。权限以服务端为准；调试读取在操作前后重新检查，普通状态消息不包含原始诊断。popup 打开、聚焦及打开期间每 5 秒刷新角色；无网络或权限失效时隐藏调试入口。

指定管理员需由部署维护者操作现有账号：

```bash
cd apps/api
DATABASE_URL='<目标数据库连接>' node scripts/set-account-role.mjs '<账号邮箱>' admin
# 撤销管理员：末尾改为 user
```

只有 `admin` 有管理权限，历史 `operator` 或未知值按普通用户处理，不自动提升。当前复用已有 `User.role` 字段，不需要数据库迁移。

## 验证

```bash
pnpm --filter @job-assistant/extension test
pnpm --filter @job-assistant/api test
# 使用独立数据库：
DATABASE_URL='<独立测试库>' pnpm --filter @job-assistant/api test:integration
```

2026-10-18：相关单元测试、PostgreSQL 集成测试及全仓生产构建通过。实际 Chrome + 本地 Next 网站 + API 已验证网页登录、普通用户隐藏调试、管理员显示调试。未修改页面填写算法；本轮没有重新测试招聘网站填写速度，也没有将 Cookie 登录版本部署到远端。

`tests/browser.mjs` 已适配网页登录和角色分支，但本轮未执行该自动浏览器脚本；本轮浏览器证据来自实际 Chrome 手动模拟操作，截图位于忽略目录 `.test-dist/cookie-role-user.png`、`.test-dist/cookie-role-admin.png`。

## 网站下载包与教程

“智能填写”页位于 `/workspace/autofill`，提供下载及可暂停、逐步选择的安装/使用演示。教程是 UI 示意，不会触发真实填写。安装步骤依据 [Chrome 官方加载说明](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。

`pnpm --filter @job-assistant/extension build:download` 生成 `apps/web/public/downloads/lingke-extension.zip`、`release.json` 和教程松鼠素材。网站 `dev`、`build` 会先执行该命令；Docker 网页构建也包含扩展源码。生成文件忽略提交，不打包环境文件、测试数据或源码。解压后选择 `lingke-extension` 文件夹加载。

下载包独立构建到 `.download-dist`，不会覆盖开发用 `dist`。默认连接 `https://linkaigo.com/api`，可通过 `EXTENSION_API_ORIGIN`、`EXTENSION_API_PATH_PREFIX`、`EXTENSION_LOGIN_URL` 指定同一环境的服务与网页登录。下载包固定 ID 为 `jmfbkpdfefifliffkdkmljihmkeapjkb`；上线前将 `chrome-extension://jmfbkpdfefifliffkdkmljihmkeapjkb` 加入对应 API 的 `AUTOFILL_EXTENSION_ORIGINS` 并部署 Cookie 登录 API。固定 ID 来自公开的 `scripts/download-public-key.txt`，无私钥，不授予账号权限；不能随意更换，否则 ID 会改变。

2026-10-18 页面验收：网页生产构建通过、ZIP 解压/CRC 校验通过、真实 Chrome 点击下载完成，安装步骤、复制地址、使用步骤和播放/暂停已检查。本轮页面和下载包尚未发布远端。
