# 填写扩展远端测试部署

最新账号链路修复（2026-10-18）：配置提交 `46b247a`，API/Web 标签 `auth-recovery-20261018`；六个账号路由已放行，后端加载独立认证配置，网页已重建启用阿里云验证码。模块、本地 SMTP/PG、远端负向校验及找回网页反馈通过；真实人机验证和收信注册/重置仍待人工，见[详细复测](../testing/auth-service-fix-2026-10-18.md)。回滚备份 `Caddyfile.before-auth-recovery`、`.env.autofill-test.before-auth-recovery`。

最新 AI 服务修复（2026-10-18）：配置提交 `d390f10`，测试 API 已加载专用 `.env.autofill-ai`，代理已放行五个需登录的 AI 路由。真实 TXT/DOCX/PDF、OCR、视觉、填写兜底与 Chrome 上传预览通过；[详细复测](../testing/ai-service-fix-2026-10-18.md)。代理备份 `Caddyfile.before-ai-recovery`；仅重建测试 API，主站 API/Web 未重启。

最新经历编辑回显修复（2026-10-18）：功能提交 `026e301`，Web标签 `profile-field-display-20261018`，只更新隔离测试 Web；API 保持上一版本运行。30项 Web 测试、类型检查、生产镜像和真实Chrome日期/学历保存刷新通过，18条经历/ID/其他资料保留；[详细复测](../testing/field-display-fix-2026-10-18.md)。配置备份 `.env.autofill-test.before-field-display`。下文保留历次部署记录。

最新资料保存修复（2026-10-18）：功能提交 `00f5ac6`，API/Web标签 `profile-save-fix-20261018`，已在隔离测试环境部署。103项相关测试、PG集成、Web生产镜像和真实Chrome保存回归通过，18条经历/ID/其他资料保留；[详细复测](../testing/profile-save-fix-2026-10-18.md)。配置回滚备份 `.env.autofill-test.before-profile-save-fix`。页面填写引擎未改动。

## API 前缀

扩展构建使用 `EXTENSION_API_ORIGIN=https://linkaigo.com` 和 `EXTENSION_API_PATH_PREFIX=/autofill-test/api`；主站接口使用 `/api`，本地直接访问 3001 端口时前缀为空。所有登录、退出、readiness、analyze、plan 路由统一拼接一次前缀。当前下载版本使用测试网站 Cookie，并绑定当前账号；早期 Bearer 版本的验证记录保留在下方历史结果中。

页面引擎、控件、经历对齐和填写算法不属于此次改动。发布包含此前 P1–P4 已完成的平台迁移。

## 隔离部署

- 单独 checkout：`/opt/lingke-autofill-test`，独立 Compose 项目 `lingke-autofill-test`。
- 使用 `docker-compose.autofill-test.yml`，独立 PostgreSQL 卷，无数据库端口公开。
- `.env.autofill-test`（600 权限，不入库）填写 `AUTOFILL_TEST_RELEASE`、随机 `AUTOFILL_TEST_DB_PASSWORD`、随机 `AUTOFILL_TEST_EMAIL_SECRET`、实际 `AUTOFILL_EXTENSION_ORIGINS`。
- 构建 API 镜像，启动测试 PostgreSQL，再执行 `prisma migrate deploy`，最后启动 API。
- 将 `deploy/autofill-test.Caddyfile` 的 handler 插入已有 HTTPS 站点，在 Web fallback 之前。先备份、validate，再 reload；主站 `/api` 和 Web 路由保留。
- 测试仅录入合成账号和简历。邮箱验证仍启用，测试账号由测试环境管理员种入已验证身份；不开放验证码调试接口。
- AI/OCR 单独使用服务器上的 `.env.autofill-ai`（600 权限、不入库）。按仓库 `.env.example` 中的 `AI_*`、`BAIDU_OCR_*`、`RESUME_PDF_EXTRACTOR` 提供供应商配置；不得直接加载主站完整 `.env`，以免带入主站数据库、会话或业务配置。扩展不持有模型密钥。
- 注册与邮件单独使用 `.env.autofill-auth`（600 权限、不入库）：仅配置 `MAIL_PROVIDER`、`MAIL_FROM`、`SMTP_*`、`CAPTCHA_PROVIDER`、`ALIYUN_CAPTCHA_*`。测试 `EMAIL_CODE_SECRET`、`APP_URL`、数据库及 Cookie 继续由独立测试配置覆盖。网页需要在 `.env.autofill-test` 中提供四个公开的 `NEXT_PUBLIC_CAPTCHA_PROVIDER` / `NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION` / `NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX` / `NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID`，变更后重新构建 Web；不能只重启容器。

```bash
# 在测试 checkout 中执行
# 先配置 .env.autofill-test、.env.autofill-ai 和 .env.autofill-auth
DC='docker compose --env-file .env.autofill-test -p lingke-autofill-test -f docker-compose.autofill-test.yml'
$DC build api
$DC up -d postgres
$DC run --rm api pnpm exec prisma migrate deploy --schema src/prisma/schema.prisma
$DC up -d api
```

当前发布验收必须从测试教程页下载 ZIP、解压并安装，核对固定 ID 和 buildId；本机 `apps/extension/dist` 仅用于开发。通过扩展跳转网站登录测试账号，读取后端简历，再在美团填写；不投递、不保存招聘网站简历。记录真实耗时、已填写、跳过及待处理数，链路通过不代表页面字段覆盖率已达 100%。

## 发布检查与回滚

`pnpm test` 和 `pnpm build` 按工作区串行执行，避免 API 与扩展同时重建契约包、删除对方正在读取的 dist。执行 `pnpm lint`。

回滚只停止测试 Compose（不要加 `-v`），恢复备份 Caddyfile 后 validate/reload。保留测试数据库卷、已部署提交和镜像标签以便恢复；不操作主站代码、服务或数据库。

部署结果和浏览器实测记录在本文后续补充。

## 本地验证（2026-10-18）

契约 5/5、API 60/60、扩展 9/9；生产构建通过。API/扩展 lint 通过。全仓 lint 的 Web 旧 `next lint` 命令因当前 Next 版本不支持而失败，未修改 Web。页面 page/controls/runner 文件 SHA-256 与修改前一致。

## 远端验收结果（2026-10-18）

- GitHub 分支：`codex/autofill-remote-test`；平台及前缀提交 `0ea7e77`，隔离数据库 DNS 修正 `ab7f44b`，代理执行顺序修正 `df4b3f6`。
- API 镜像：`lingke-autofill-test:0ea7e77df296`（linux/amd64），镜像 SHA-256 `595117cd861938b5616ba40d80bc5354cb165d241945362a178a1f63ee338600`。后续两次提交仅调整 Compose/代理配置，无需重建 API。
- 测试入口：`https://linkaigo.com/autofill-test/api`；扩展 ID `jkjdllbagnfghlnelcebbmbpmfipiadj`，buildId `b5afe24b85cf474cc0ea`，实际加载目录 `apps/extension/dist`。
- 测试库独立应用 8 个迁移。数据库使用唯一 DNS `autofill-test-postgres`，避免 API 同时连接代理网络时误解析到主站的 `postgres`。
- Caddy handler 内使用 `route` 固定先改写、再转发、最后 404 的执行顺序。主站 `/api/health`、首页与测试 `/health` 均 200；测试未开放路径 `/admin` 返回 404。主站 API/Web/数据库容器未重启。
- HTTPS 实测：未登录 readiness 401；登录、写入合成资料、导出简历、readiness、analyze、plan、退出均通过。18 条经历：教育 2、工作 3、校园 1、项目 3、荣誉 2、论文 2、语言 2、证书 2、技能 1。预热后单请求约 0.49–0.57 秒。
- 真实 Chrome 扩展弹窗登录成功，显示测试前缀。打开独立美团投递确认页，勾选本次覆盖和学校变更选项，由“一键填写”启动，没有调用内部 runner。原来的求职方舟测试标签未刷新，保留其草稿。

### 美团实测

页面：`https://zhaopin.meituan.com/web/delivery-confirm?jobUnionId=4734968293&jobShareType=1&highlightType=campus`。

从按钮命令开始至结束 **78.275 秒**，其中初始连接/资料检查约 0.506 秒，runner 77.769 秒：

| 阶段 | 秒 |
| --- | ---: |
| 扫描/探测 | 22.794 |
| 分析匹配 | 1.076 |
| 生成填写计划 | 8.166 |
| 页面执行 | 42.830 |
| 核验 | 2.829 |
| 空闲/调度 | 0.074 |

两次 analyze、十次 plan 的操作结果均为 ok。浏览器运行报告中的 profileVersion 与远端导出的完整简历完全一致。美团使用现有站点规则；测试环境没有模型密钥。

**结果是 partial，不是完整填写成功**：82 个已报告字段中，40 个新填入、13 个原本正确、27 个跳过、2 个需处理。UI 的“已验证 53”包含原本正确的 13 个，不能把它当作 53 个新填入或独立视觉准确率。29 个待处理中，19 个没有等价资料来源、8 个站点解析器未覆盖、2 个选项探测超时；另有 5 条未展开经历区块提醒。报告有 4 次新增动作成功，不据此宣称所有经历数量都已对齐。

视觉核对的第三段项目已显示合成项目名称、核心开发、2021/03–2021/12、项目链接及完整项目描述。未对全部字段做独立视觉评分；此次验证目标是远端部署和登录→读库→规则计划→真实回填链路。没有投递、没有保存网站简历；没有改扫描、增减经历或控件填写逻辑。

本机证据（忽略、不推送）：`apps/extension/.test-dist/remote-test-20261018/` 中的 `http-results.json`、`browser-run.json`、`login.png`、`result-popup.png`、`filled-project.png`。合成测试账号凭据在同目录 `credentials.json`（600 权限），不写入仓库或报告。

远端剩余磁盘约 0.9 GB；继续积累测试镜像前需要扩容或安排明确的旧镜像清理。此次没有删除主站镜像、缓存或数据卷。

## Cookie 登录与下载页面联合发布（2026-10-18）

本次将测试网页增加到 `/autofill-test`，API 仍为 `/autofill-test/api`。Next `basePath`、下载链接、静态素材、登录回跳与扩展登录地址统一使用测试前缀。主站路由及生产数据库保持原配置。

测试 Cookie 为 `lingke_autofill_test`，Path 为 `/autofill-test`，HttpOnly、Secure、SameSite=Lax；主站继续使用 `lingke_session`。网站构建参数 `NEXT_PUBLIC_SESSION_COOKIE_NAME` 必须与 API 的 `SESSION_COOKIE_NAME` 一致。旧 Bearer 接口兼容保留，新下载扩展只使用 Cookie。

新增网页镜像使用 Next standalone 运行目录。测试下载包固定扩展 ID：`jmfbkpdfefifliffkdkmljihmkeapjkb`，需加入测试 API 的来源白名单。下载 ZIP 的 manifest、background、build.json 必须核对测试前缀和网页登录地址，不能用本机开发包代替网站下载包验收。

验收顺序：HTTPS 健康和主站回归 → 从测试网站下载 ZIP → 解压并加载固定 ID 扩展 → 扩展跳转测试网页登录 → Cookie 识别账号 → 从测试库读取完整资料 → 独立美团标签页通过真实按钮填写 → 核对结果及记录耗时。保持招聘页填写算法不变，不投递申请。

### 部署与登录验收

- 发布提交：`1580b3f`，已推送 `codex/autofill-remote-test`，测试服务器 checkout 同步该提交。
- 教程与下载入口：<https://linkaigo.com/autofill-test/workspace/autofill>；未登录时跳转测试登录页，成功后回到教程页。
- API 镜像 `lingke-autofill-test:cookie-guide-20261018`，SHA-256 `9926443972ba8b843d516705c74c52803a15f9ff489552830cd63eca4fd30743`。Web 镜像 `lingke-autofill-web:cookie-guide-20261018`，使用 Next standalone，约 94 MB。
- 为节省测试机磁盘，API 在已部署镜像 `lingke-autofill-test:0ea7e77df296` 上覆盖同提交的 `apps/api/src/index.js`、`src/auth/roles.js`、`src/auth/session-cookie.js`、`src/modules/autofill/routes.js` 与 `scripts/set-account-role.mjs`，目标路径为 `/app/apps/api/` 下对应位置。无依赖、数据库迁移或页面填写引擎变更；完整重建仍用仓库 API Dockerfile。
- 测试 API、Web 已启动；主站首页、主站 `/api/health`、测试 `/health`、登录页、下载地址均返回 200。主站容器未重启。测试配置和主站代理分别备份为 `.env.autofill-test.before-cookie-guide`、`/opt/lingke/deploy/Caddyfile.before-cookie-guide`。
- 全部相关测试通过：契约 5、API 63、扩展 10，共 78 项；自定义 Cookie 名称/路径的 PostgreSQL 集成测试通过；linux/amd64 Web 生产镜像构建通过。
- 真实点击教程页下载按钮，获得 `lingke-extension (1).zip`（1,052 KB）。ZIP 校验通过，SHA-256 为 `244c79f03138c915445d63ca7fd84786ac413bb78a586b471daab61eda50d10a`，buildId `7b6685252f4dbe1867c1`。加载实际下载并解压的目录，Chrome 确认 ID `jmfbkpdfefifliffkdkmljihmkeapjkb`、版本 0.3.0；旧开发扩展已停用。
- 用普通权限合成账号完成真实网页登录。随后仅撤销该测试账号的 Web 会话，扩展出现“前往网页登录”；实际点击后跳转 `/autofill-test/login?next=/workspace/autofill`，再次登录并回到教程页，返回美团后扩展自动识别 Cookie。未保存浏览器密码，未在扩展输入密码或 Token。
- 普通权限弹窗没有账号表单、规则采集、运行诊断或开发信息入口。HTTP 验证覆盖未登录拦截、扩展来源 CORS、主站 Cookie 不可冒用、账号绑定不符被拒绝、退出失效。
- 后端导出的完整简历仍含 18 条经历，版本摘要 `06d288af2773020df3ce660e350e7559805cdc7c7b250c7efc77ae3154800564`；独立 readiness 请求约 508 ms。此处接口耗时不是页面填写总耗时。

本机证据位于忽略目录 `apps/extension/.test-dist/cookie-remote-20261018/`。安装目录为其中 `downloaded/lingke-extension`，后续勿删除或移动正在加载的目录。部署后磁盘剩余约 814 MB；此次未清理主站镜像或数据。

### Cookie 版本真实美团填写

两轮均使用普通权限账号、网站下载的扩展、相同完整简历和新开的相同美团 URL；勾选覆盖与更换学校时清空旧学院，由真实“一键填写”按钮启动。没有调用内部 runner，也没有修改页面填写代码。

| 操作条件 | 观察到结束 | 扩展已验证 | 待处理字段 | 页面提醒 |
| --- | ---: | ---: | ---: | ---: |
| 保持扩展弹窗打开 | 约 91 秒 | 39/82 | 43 | 5 |
| 启动后立即收起弹窗，页面保持焦点 | 约 78 秒 | 54/82 | 28 | 5 |

计时为原生 UI 点击至观察到终态，轮询约两秒一次：第一轮终态落在 88.868–90.939 秒之间，第二轮落在 75.644–77.997 秒之间。不是内部 runner 的毫秒精确计时。54/82 是扩展报告的验证计数，可能包括原本正确的字段，不作为独立视觉准确率或全简历召回率。

第一轮性别、城市、学校、专业、学历、公司等下拉菜单集中超时；第二轮这些超时消失，仅语言考试仍显示超时。弹窗焦点是值得单独复现的交互问题，目前只是两轮对照证据，未改控件代码。第二轮其余待处理包括学院、排名、实验室/导师、部门、工作类型等；校园、荣誉、证书、论文、竞赛仍有未展开编辑区提醒。因此不能宣称完整简历全部填写成功。

视觉截图确认第三段合成项目的名称、核心开发角色、2021/03–2021/12、项目链接和完整描述正确显示；页面读取也确认三段工作和三段项目对应内容已出现。仍保留了一些原有部门/工作类型内容，属于待处理字段。未做全字段独立视觉评分，没有投递或点击保存。

结论：**下载 → 安装 → 网页登录 → Cookie 身份识别 → 读取远端资料 → 规则填写链路通过；填写完整度仍为 partial。** 普通用户测试期间未提升权限，调试入口保持隐藏。证据包括 `website.png`、`login-prompt.png`、`http-results.json`、两轮 `*-observations.json`、`second-result-popup.png`、`second-details.txt` 和 `filled-project.png`。

## 工作台改进联合发布（2026-10-18）

发布提交 `d85f199`，分支 `codex/autofill-remote-test`，已同步 GitHub 和 `/opt/lingke-autofill-test`。本轮包含全部待发布的投递航迹、记录弹窗和个人主页修改：

- 手动添加投递仅公司必填，职位可空、后续补填或清空；笔试/面试只输入开始时间，其他信息按需展开。
- 记录详情显示公司、职位与状态，分区编辑资料；独立滚动内容区，顶部与底部操作栏保持可见，任务和历史分开显示。
- “编辑签名”直接编辑主页信息卡，支持显示姓名、个性签名、城市、个人描述；显示覆盖项保存在 `profile.extra.homepage`，使用现有资料接口，无数据库迁移，不覆盖简历标准字段和求职意向。
- 测试代理增加投递、任务、日历及邮件工作台路由；对应接口仍要求登录，未登录实测为 401。

### 构建与部署

- 完整相关测试 95 项通过：契约 5、API 65、扩展 10、Web 15；Web 类型检查、diff 检查通过。首次测试因沙箱禁止监听本机端口中止，在允许本机临时 HTTP 服务后完整通过。
- linux/amd64 Web 生产构建通过。镜像 `lingke-autofill-web:workspace-cards-20261018`，SHA-256 `06017a2db9138cae1593976a3bc75b371a42437d3084374c9dd508b622cca573`。
- API 增量镜像由 `deploy/autofill-test-api-overlay.Dockerfile` 构建，仅覆盖应用记录服务，依赖和填写引擎沿用上一版。镜像 `lingke-autofill-test:workspace-cards-20261018`，SHA-256 `0e7db3a72f9e15cad510b6c7a4a203c15d45881f47361498cce0beb50b986b93`。
- 测试 API、Web 均已切换新版。Caddy validate/reload 成功。主站 API/Web/数据库未重启；首页和主站 `/api/health` 仍为 200。
- 配置备份：测试目录 `.env.autofill-test.before-workspace-cards`、主站部署目录 `/opt/lingke/deploy/Caddyfile.before-workspace-cards`。回滚时恢复这两个文件并重启测试 API/Web，再验证并 reload Caddy；不移除数据库卷。部署后剩余约 769 MB 磁盘。

### 远端验收

- <https://linkaigo.com/autofill-test/workspace/applications>：合成账号只填公司创建成功；职位补填和清空成功；有笔试/面试开始时间、无结束时间可保存。真实 Chrome 打开新版详情弹窗并点击“保存更改”，显示“更改已保存”。
- <https://linkaigo.com/autofill-test/workspace/profile/home>：真实点击“编辑签名”，在主页内修改签名并保存；刷新后仍显示新值。再次请求资料接口，确认原有简历标准字段、求职意向、全部经历及其他 extra 内容未变化，仍有 18 条经历。
- 下载 ZIP、测试健康接口、投递/日历/邮箱元信息接口均通过；没有连接邮箱或发起同步，也没有向真实招聘页投递。
- 本轮不重测填写性能；前一节的美团 partial 结果仍有效。证据保存在忽略目录 `apps/extension/.test-dist/workspace-release-20261018/`：`http-results.json`、`homepage-results.json`、`application-dialog.png`、`homepage.png`，不包含于发布提交。

## 主页头像发布（2026-10-18）

- 功能提交 `da6fea2`，按钮恢复“编辑主页”。支持从编辑表单或点击头像进入，选择 JPG/PNG/WebP（最大 5 MB），浏览器居中裁剪到最大 512×512、压缩并预览；保存后生效，也可更换或移除。取消保持原头像。
- 图片随主页卡片保存在 `profile.extra.homepage.avatarUrl`，复用登录后的资料保存接口，无对象存储服务或数据库迁移。原始文件不上传，仅保存压缩后的图片数据。
- 资料服务从自动填写导出中排除 `homepage` 展示字段（包括原始 extra 和展开形式），因此头像与主页展示修改不进入 AI 请求，也不影响简历版本。标准简历 `avatarUrl` 和其他字段保留。
- 99 项相关测试通过（契约 5、API 66、扩展 10、Web 18），类型检查及 linux/amd64 Web 生产镜像构建通过。本地真实浏览器验证上传、预览、保存刷新、取消移除及保存移除。
- 远端测试 Web/API 镜像标签均为 `profile-avatar-20261018`。Web SHA-256 `0a0da473fceeaed92686d65a3e685bbfaad6d2951c1cf2576b7c2f580b6bcb0e`；API SHA-256 `ea1c0b4768f63346b4e4a5d0e2ef1046791117b68ed406d91ca6ac30f8a7f2b4`。API overlay 增加复制资料服务模块，填写引擎保持原版本。
- 远端合成账号通过真实系统文件选择器上传测试图片，保存并刷新后显示正常；保存的 WebP 约 1,500 字节。HTTP 回读确认图片已持久化，简历版本和 18 条经历未变化，自动填写数据不含主页头像。
- 配置回滚备份为 `.env.autofill-test.before-profile-avatar`；恢复后重建测试 API/Web 容器即可。没有修改代理或重启生产主站，磁盘剩余约 725 MB。
- 本机证据位于忽略目录 `apps/extension/.test-dist/avatar-release-20261018/`：`before.json`、`results.json`、`homepage-avatar.png`。测试图片使用仓库已有公开图标，不上传私人照片或其他用户文件。
