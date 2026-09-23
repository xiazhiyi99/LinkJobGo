# 未使用代码归档

归档日期：2026-09-21

本目录按原仓库路径保存本轮清理审计中确认未被当前运行代码使用的文件。

## 已归档内容

- `.DS_Store`、Python 字节码和 TypeScript 构建缓存等生成文件。
- `apps/web/features/profile/types.ts`：早期简单资料类型。
- `apps/web/features/workspace/profile/content.ts`：早期个人资料占位文案。
- `apps/web/features/workspace/applications/content.ts`：早期投递航迹占位文案。
- `apps/web/lib/auth.ts`：未被当前前端使用的旧鉴权辅助函数。

`apps/web/features/autofill/autofill-api.ts` 和 `vision-api.ts` 仍保留在原路径，作为智能填写后续接入契约；Worker、共享类型和规则种子也未移动。
