# 自动填写公共契约

`@job-assistant/autofill-contracts` 是浏览器与平台 API 共用的纯契约包。包含固定字段目录、DTO、纯校验以及公开 hash 路由提取；不读取环境变量、不联网、不导入 Prisma、Chrome 或页面实现。

迁自 `resume-autofill-next/src/shared`，保持 `resume.autofill.v1` 和 `autofill.next.v2` 的数据形状与校验行为。服务端专用的 RequestContext/访问凭据没有迁入。现有具名派生规则仍受严格校验，不在本次搬迁中泛化。

```ts
import { validateResumeContext, type ResumeContext } from '@job-assistant/autofill-contracts';
```

```js
const { validateResumeContext } = require('@job-assistant/autofill-contracts');
```

包 exports 分别提供 ESM、CommonJS 运行时和对应的 `.d.ts` / `.d.cts`。API 的 dev/build/test 入口自动先构建本包；直接运行 API 的 Node 入口前也需先构建。

```bash
pnpm --filter @job-assistant/autofill-contracts build
pnpm --filter @job-assistant/autofill-contracts test
```

五个契约测试覆盖：平台简历样例、记录身份、计划版本和来源归属、hash 路由脱敏、两种模块系统和浏览器打包。测试只引用主仓内的合成 fixture，不依赖旧项目或真实页面。

字段改动应同时更新本包、平台投影与相关测试。`profileVersion` 仍由平台服务按原内容摘要算法生成；包不维护用户缓存。扩展和完整填写后端尚待后续迁入，不能将本包可用视为全链路已接入。
