# 正式站发布与回滚清单

日期：2026-10-18。状态：正式主站已切换。实际镜像、代理别名修复、磁盘与验收边界见[正式发布记录](production-deployed-2026-10-18.md)。下方保留发布前检查依据；后续运维使用服务器固定发布目录。

## 发布对象

- API：远端 `lingke-autofill-test:launch-fix-20261018-r2`，镜像摘要前缀 `b2d65eb28838`。
- Web：`lingke-web:launch-ready-20261018`。本机构建配置摘要 `f98636993d89`，远端复用相同依赖的镜像为 `abf84850ff8c`；应用文件及运行配置逐项一致。正式路径构建，扩展构建编号 `68cf21b0abf170ca6954`，API `/api`，Cookie `lingke_session`。
- 源码：`0b3f900` 包含运行时修复；后续只补 Web 测试脚本和发布记录。不得混用旧镜像 `latest` 或测试路径的 Web/扩展包。
- 正式数据源仍为 `/opt/lingke/.env`；保留 `/opt/lingke/deploy/Caddyfile` 的现有改动。隔离环境配置和数据库不迁入正式库。
- 代理必须指向唯一别名 `lingke-production-api`、`lingke-production-web`，不用共享网络上可能重名的 `api`、`web`。正式 Compose 已声明对应别名。

## 切换前

1. 处理磁盘空间。当前约 400MB 可用，不能继续大体积导出/导入；未使用历史镜像 `e52cbbbd69c8` 约占 1.4GB 独有层，归档因临时空间不足失败、原镜像未删除。清理前核对当前容器引用与回滚镜像，不执行全局 prune 或删除 volumes。
2. 向远端传输正式 Web 候选镜像，校验标签、配置摘要、平台及内置扩展路径。传输后再次检查剩余空间。
3. 给主站现有运行镜像增加独立回滚标签；先核对镜像 ID：API `32a6e593e2c2`、Web `aab20a9e7e48`。若已有同名回滚标签且指向不同镜像，停止，不覆盖。
4. 在服务器私有目录备份主库（`pg_dump -Fc`）、主站 `.env`、Caddy 文件与当前容器/镜像元数据，权限 600。用 `pg_restore --list` 校验备份可读；备份不进入 Git 或测试账号目录。保留现有邮箱加密密钥。
5. 再次渲染完整 Compose，确认数据库/Redis URL、生产 Cookie 与 Caddy 挂载不变。8 个数据库迁移与正式库一致，本次不需要运行迁移。
6. 如正式启用已验收的两个 Moka URL，在备份后将主站 `.env` 中 `MOKA_RULES_MODE` 设为 `enabled`；它不是模型配置开关，也不会启用其他租户。保留该行原值供回滚。

当前回滚标签建议：

```bash
docker tag 32a6e593e2c2 lingke-api:before-launch-20261018
docker tag aab20a9e7e48 lingke-web:before-launch-20261018
```

## 切换命令

下列命令使用主站的项目目录、环境和网络，只替换 API/Web。先完成上面的备份、镜像上传和配置核对，再执行：

```bash
export LINGKE_API_IMAGE=lingke-autofill-test:launch-fix-20261018-r2
export LINGKE_WEB_IMAGE=lingke-web:launch-ready-20261018
docker compose --project-directory /opt/lingke --env-file /opt/lingke/.env \
  -p lingke \
  -f /opt/lingke/releases/launch-20261018/docker-compose.prod.yml \
  -f /opt/lingke/releases/launch-20261018/docker-compose.release.yml \
  up -d --no-deps --no-build api web
```

不要对 `/opt/lingke` 执行 `git reset --hard`：该目录有需要保留的 Caddy 修改。正式部署目录可以继续保留旧 checkout，但必须记录实际镜像与这份新 Compose 的源码提交，不能用旧 checkout 默认重建来覆盖本次镜像发布。

## 切换后验收

- 正式 API 健康、登录/注册/找回页面与 ZIP 下载；未登录资料接口 401、非法账号请求被拒绝，不能只凭健康接口判上线成功。
- ZIP 仍为固定扩展 ID，版本 `0.3.2`、构建 `68cf21b0abf170ca6954`、`development:false`、API 为 `https://linkaigo.com/api`，不含 `/autofill-test`。
- 使用正式站受控测试账号完成网页登录 → 扩展 Cookie 识别 → 读取简历 → 实际招聘页填写，不保存或投递。若需要人工密码/CAPTCHA，只由用户输入，不要求传递密码。
- 只对该受控账号做保存回归，核对其他资料、经历 ID 和版本变化符合预期，不修改其他用户数据。
- 测试环境仍可访问；PG/Redis/Caddy 容器及 volume 未重建。观察 API/Web 异常与磁盘，记录发布后实际镜像 ID。
- 没有邮箱账号授权时，将真实收信/同步保留为未验收，不宣称已通过。

## 回滚

恢复此次修改过的主站配置值（例如 Moka 开关）；不更换邮箱加密密钥，不覆盖数据库。将镜像改为上面保留的回滚标签，使用相同 Compose 命令重新创建 API/Web：

```bash
export LINGKE_API_IMAGE=lingke-api:before-launch-20261018
export LINGKE_WEB_IMAGE=lingke-web:before-launch-20261018
docker compose --project-directory /opt/lingke --env-file /opt/lingke/.env \
  -p lingke \
  -f /opt/lingke/releases/launch-20261018/docker-compose.prod.yml \
  -f /opt/lingke/releases/launch-20261018/docker-compose.release.yml \
  up -d --no-deps --no-build api web
```

无数据库迁移时，代码回滚不等于数据库还原。只有确认发生数据损坏、明确恢复范围并获得授权后，才考虑恢复数据库备份，以免覆盖上线后用户新增内容。

应用回滚保留本次唯一代理别名修复。发布前的旧镜像清理已完成，当前约余 1.3GB；不要再次执行历史清理步骤。
