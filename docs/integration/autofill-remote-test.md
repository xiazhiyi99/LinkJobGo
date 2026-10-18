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
