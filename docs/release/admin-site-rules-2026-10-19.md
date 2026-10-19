# 管理员网站规则目录

已于 2026-10-19 部署到正式站，功能提交 `179ea93`。

- 页面：`https://linkaigo.com/workspace/admin/site-rules`，管理员侧栏显示「规则管理」。
- 接口：`GET /api/admin/autofill/sites`，使用现有登录会话，每次读取重新检查管理员权限；未登录 401，普通账号 403，响应禁止缓存。
- 数据直接来自后端 `createConfiguredSiteRegistry().list()`，没有新增数据库表。展示网站名称、解析器 ID、域名、精确/正则路径、Hash 路由、版本和注册状态，支持搜索、状态筛选及刷新。
- 当前有美团、腾讯、阿里巴巴、字节和 Moka 五套代码规则。Moka 的 `off/candidate/enabled` 取当前运行配置；存在代码并不代表已注册，也不代表整个 ATS 域名下的页面都受支持。

## 后续新增规则

在解析器中补充 `name`、`origins`、`routes`，并在 `createConfiguredSiteRegistry` 中注册。`routes` 和实际 `matches` / `ownsPage` 应复用相同的路径常量，避免展示数据与运行逻辑漂移；仍须保留实际页面结构校验。前端不维护另一份网站清单。

页面只读，不提供权限授予、规则修改或启停入口。本次没有更改字段映射、经历增减、AI 路由或扩展行为。

## 验证结果

- API 与主站测试 140/140 通过；生产构建通过。
- 本地生产构建配合隔离角色夹具，在 Chrome 验证管理员目录、搜索、筛选、刷新，以及普通账号无入口和直接访问拦截。
- Linux 候选镜像验证页面及静态资源、API 模块加载通过。
- 正式站真实普通 QA 会话读取目录返回 403 / `ADMIN_REQUIRED`，匿名返回 401，均无规则数据泄露。
- 正式站与隔离站健康检查通过；浏览器当前普通账号显示权限提示。管理员允许访问的 HTTP 流程已在隔离夹具覆盖，未提升任何正式账号权限来测试。
- 扩展下载仍为 0.3.8，构建 `50fba7768c4854cc14d9`。除正式 API/Web 外的容器未变。

## 发布与回滚

发布目录：`/opt/lingke/releases/admin-site-rules-20261019`，保留 `release.env`、`rollback.env`、Compose 配置、源码文件摘要和校验结果。

| 服务 | 当前镜像 | 回滚镜像 |
| --- | --- | --- |
| API | `lingke-api:admin-site-rules-20261019` | `lingke-api:bytedance-complete-20261018` |
| Web | `lingke-web:admin-site-rules-20261019` | `lingke-web:extension-0.3.8-20261019` |

首次发布因 Web 启动探测过早自动回滚；增加就绪重试后发布通过。未修改数据库结构、代理和密钥配置。回滚时沿用同一发布目录的 Compose 文件，将第二个 env-file 切换到 `rollback.env`，仅重建 `api web`。
