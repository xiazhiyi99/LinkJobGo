# 招聘服务商规则复用

## 已实现的选择顺序

1. 完整 `origin` 精确匹配（同一解析器的 `origins` 可登记多个域名）。
2. 按声明的 pathname / Hash 路由筛选，字符串精确匹配、正则匹配动态公司、表单和职位 ID。
3. `scope: 'site'` 公司专属规则优先于 `scope: 'provider'` 服务商通用规则；同层 `priority` 较大者优先。
4. 服务商规则的 `matches(page, snapshot)` 必须确认实际控件兼容；不兼容时继续尝试较低优先级规则，最终未命中仍走现有未知页面 AI 流程。
5. 同层同优先级存在两个有效解析器时明确报错，不随机选择。专属规则声明不支持或执行异常时保持原有阻断行为，不借 AI 隐藏规则错误。

旧解析器未显式声明 `scope` 时保留历史识别行为。原有扫描、增减经历和实际填写执行器没有增加网络往返；这次只扩展规则选择、Moka 的可复用字段范围和前端适配器的 URL 门槛。结构指纹不参与选择。

## Moka 当前范围

- 后端解析器 `moka@1.2.0`，当前正式登记域名仍为 `https://app.mokahr.com`。
- 校园申请表 pathname：`/campus_apply/<tenant>/<numeric-form-id>`。
- Hash 路由：`/job/<job-id>/apply`，不受特定职位 UUID 限制。
- 新公司页面须扫描到 Moka 控件证据，以及兼容的个人信息、教育背景或实习经历结构。前端也检查实际区块和控件，只有 URL 相似不会强制选择 Moka 适配器。
- 通用字段包括现有姓名、联系方式、性别、最高学历、教育、实习、已支持的日期控件和意向城市；其他字段继续标记未映射，不猜来源。
- `baai` 的“最高学历高校”派生等公司差异仍限于该公司，不传播给其他公司。
- `MOKA_RULES_MODE=off/candidate/enabled` 继续控制是否注册。

这表示同版 Moka 校园申请表可跨公司/表单/职位复用，并不表示所有 Moka 产品、北森、飞书或所有自定义招聘域名已经适配。新域名须登记并检查前端适配器域名门槛；不同页面版本须验证控件结构。

## 增加服务商或公司差异

服务商解析器应声明：`scope: 'provider'`、`provider` 标识、`origins`、`routes`、`priority`、结构兼容性 `matches` 和通用 `parse`。所有路径和 Hash 正则应有边界，不允许使用会改变 `lastIndex` 的 `g/y` 标志。

公司使用相同页面时，无需增加一份解析器。存在公司差异时，可以通过对象组合继承服务商的转换、选项和派生函数，只覆盖相应部分：

```ts
const companyParser: SiteParser = {
  ...mokaDraftParser,
  id: 'moka-company-example',
  name: '公司示例',
  scope: 'site',
  priority: 10,
  routes: [{
    path: /^\/campus_apply\/company-example\/\d+\/?$/,
    hashRoute: /^\/job\/[A-Za-z0-9_-]+\/apply\/?$/,
  }],
};
```

需要覆盖字段时，在 `parse` 中调用基础解析器的 `parse(input)`，按 `sectionId/templateFieldId` 修改已确认的差异，并继续经过共享契约校验。不要复制整套字段和日期代码。将规则加入 `createConfiguredSiteRegistry` 的定义列表，同时明确其启停配置。

管理页直接显示运行注册表的 `scope/provider/priority` 和所有域名、路径及 Hash 模式，不另维护一份网站清单。目前管理页仍只读。

## 验证界限

2026-10-19：API、主站、扩展和公共契约测试共 205 项通过；正式构建通过。新增测试覆盖四组不同公司/表单/职位、多个精确域名、公司优先级、规则冲突、结构不兼容的 AI 路由和前后端 URL 一致性。管理员管理页已在本地生产构建中用 Chrome 验收。

这轮跨公司用例为合成快照和前端 URL 测试，未据此声称新公司真实页面的填写准确率或完整度已经通过端到端验收。新增真实页面时仍按现有浏览器测试计划记录速度、准确率和完整度。
