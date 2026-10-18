# 填写扩展远端测试部署

## API 前缀

扩展构建使用 `EXTENSION_API_ORIGIN=https://linkaigo.com` 和 `EXTENSION_API_PATH_PREFIX=/autofill-test/api`；主站接口使用 `/api`，本地直接访问 3001 端口时前缀为空。所有登录、退出、readiness、analyze、plan 路由统一拼接一次前缀。Token 绑定 origin 与 prefix，切换后重新登录。

页面引擎、控件、经历对齐和填写算法不属于此次改动。发布包含此前 P1–P4 已完成的平台迁移。

## 隔离部署

- 单独 checkout：`/opt/lingke-autofill-test`，独立 Compose 项目 `lingke-autofill-test`。
- 使用 `docker-compose.autofill-test.yml`，独立 PostgreSQL 卷，无数据库端口公开。
- `.env.autofill-test`（600 权限，不入库）填写 `AUTOFILL_TEST_RELEASE`、随机 `AUTOFILL_TEST_DB_PASSWORD`、随机 `AUTOFILL_TEST_EMAIL_SECRET`、实际 `AUTOFILL_EXTENSION_ORIGINS`。
- 构建 API 镜像，启动测试 PostgreSQL，再执行 `prisma migrate deploy`，最后启动 API。
- 将 `deploy/autofill-test.Caddyfile` 的 handler 插入已有 HTTPS 站点，在 Web fallback 之前。先备份、validate，再 reload；主站 `/api` 和 Web 路由保留。
- 测试仅录入合成账号和简历。邮箱验证仍启用，测试账号由测试环境管理员种入已验证身份；不开放验证码调试接口。
- 当前测试部署只验证已注册规则，无模型密钥，未知站点 AI 不属于此次上线验收。后续配置通过平台统一 AI 网关，不由扩展传密钥。

```bash
# 在测试 checkout 中执行
DC='docker compose --env-file .env.autofill-test -p lingke-autofill-test -f docker-compose.autofill-test.yml'
$DC build api
$DC up -d postgres
$DC run --rm api pnpm exec prisma migrate deploy --schema src/prisma/schema.prisma
$DC up -d api
```

构建扩展后，重载原 `apps/extension/dist`，核对 buildId 和账号面板的完整服务地址。扩展登录测试账号，读取后端简历，再在美团填写；不投递、不保存招聘网站简历。记录真实耗时、已填写、跳过及待处理数，链路通过不代表页面字段覆盖率已达 100%。

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
