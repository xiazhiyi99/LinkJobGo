# 服务商多网站匹配发布

2026-10-19，功能提交 `3fcac85` 已推送并部署正式站。

- 同一解析器可登记多个精确域名及多个 pathname/Hash 模式。
- 增加公司专属 / 服务商通用规则层级，同层按优先级选择；冲突明确报错。
- Moka `1.2.0` 支持动态公司、表单和职位的校园申请表，实际控件不兼容时保留未知网站流程；公司特有派生字段不外溢。
- 管理页展示规则层级和 Hash 正则，支持搜索“服务商通用”。
- 扩展升级 0.3.9，构建 `5a160a98b0f773b404cb`。公开 ZIP SHA-256：`427bd33c46c7423a2d7900b495f27f1b567f87165c2f0022d3d50bc262c161b5`。

验证：205 项相关测试、正式生产构建及 Linux 候选镜像检查通过。Chrome 中验证了本地生产管理页；正式站健康检查、匿名 401、普通账号 403、公开下载元数据和 ZIP 哈希检查通过。其他容器未变，无数据库、代理或密钥变更。

跨公司复用目前通过合成快照、源字段/经历 ID 回归和前后端 URL 一致性测试；本轮未对新增公司的真实页面声明填写速度、准确率或完整度。适用范围和后续规则登记方式见 [服务商匹配说明](../integration/autofill-provider-matching.md)。

| 服务 | 当前镜像 | 回滚镜像 |
| --- | --- | --- |
| API | `lingke-api:provider-rules-20261019` | `lingke-api:admin-site-rules-20261019` |
| Web | `lingke-web:provider-rules-20261019` | `lingke-web:admin-site-rules-20261019` |

发布目录 `/opt/lingke/releases/provider-rules-20261019` 保留 Compose、`release.env`、`rollback.env` 和验证结果。运行同目录配置并把第二个 env-file 改为 `rollback.env`，仅重建 `api web`，即可恢复前一版本。

公开扩展包已经下载校验并更新到原安装目录，0.3.8 备份存于忽略的本地 QA 目录。本次发布时 Mac 锁屏，未能点击 Chrome 扩展重载；使用新前端适配器前仍需重载 0.3.9。
