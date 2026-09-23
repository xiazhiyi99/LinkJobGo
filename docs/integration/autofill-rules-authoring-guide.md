# 页面自动填写规则录入指南

这份文档用于后续向 `AutofillRuleSet` 规则表增加平台、页面变体或公司页面规则。规则是“数据化 adapter”，由 Fast Fill 通用扫描器和填写器解释执行，不在数据库中保存可执行代码。

## 先判断要增加哪一层

| 场景 | `scope` | `platformKey` | `parentRuleSetId` |
| --- | --- | --- | --- |
| 新的通用行为 | `generic` | 可空 | 通用规则版本 |
| 新招聘平台，例如 Moka | `platform` | `moka` | 通用规则 |
| 同一平台的校招简历页/申请页 | `variant` | `moka` | Moka 平台规则 |
| 某个公司的定制字段 | `tenant` | `moka` | 页面变体规则 |

优先复用父规则，只在子规则里写差异。不要为了一个公司的少量差异复制整个平台规则。

## 第一步：规范化页面来源

规则解析首先依据 URL，不依据结构指纹。录入时分别保存：

```text
origin      https://talent.example.com
pathPattern /resume-detail
queryPolicy ignore
sourceKey   https://talent.example.com/resume-detail
```

规范化要求：

- origin 小写，去掉默认端口；
- pathname 去掉末尾 `/`；
- 查询参数默认忽略，只保留确实区分页面的白名单参数；
- 不保存 token、简历 ID、手机号或完整动态查询串；
- SPA 页面如果多个页面共用 pathname，应使用 `variant` 或必要的白名单参数区分。

平台基础规则可以使用平台路由模板，例如：

```text
sourceKey: platform:moka:resume-edit
platformKey: moka
pathPattern: /resume-detail
```

如果无法从 URL 判断平台，首次运营运行时由运营人员确认 `platformKey`，以后仍然按已保存的 URL 来源读取规则。结构指纹只用于运行后的漂移提示。

## 第二步：确定领客简历字段路径

规则引用的是 `resume.autofill.v1`，只保存路径，不保存实际值。

允许的 `sourcePath` 形式：

```text
profile.name
profile.phone
profile.email
preferences.targetCities
record.education.school
record.education.major
record.experience.company
record.project.description
record.experience.extra.department
```

对应关系如下：

| `sourcePath` | 数据来源 |
| --- | --- |
| `profile.*` | 用户个人信息 |
| `preferences.*` | 求职偏好 |
| `record.<recordType>.<field>` | `records[].fields` 的标准字段 |
| `record.<recordType>.extra.<key>` | `records[].extra` 中的扩展字段 |

服务端发布前必须验证路径属于允许的 schema。路径不存在时不能发布规则，应改用已有标准字段或 `extra`。

经历字段不要写死用户的记录 ID。规则只声明 `recordType` 和字段，运行时由 `record.id/index` 对应本次用户的具体经历。

## 第三步：填写规则 JSON

`rules` 是 `page-rules.v1` JSON。字段按语义键保存，便于继承和覆盖。

### 普通字段

```json
{
  "fields": {
    "profile.name": {
      "sourcePath": "profile.name",
      "controlKind": "text",
      "strategy": "text",
      "required": true,
      "locator": {
        "labelTokens": ["姓名", "name"],
        "role": "textbox",
        "scope": "profile"
      }
    }
  }
}
```

`locator` 只能保存通用语义证据：

- 标签词和 placeholder 词；
- ARIA role、input type、控件类型；
- 所属分组和相邻文本；
- 重复组内相对顺序。

禁止保存：

- CSS selector；
- 随机 class；
- 精确 DOM 路径；
- `field-12` 之类本次扫描 ID；
- JavaScript 或页面函数。

### 重复经历

```json
{
  "repeatGroups": {
    "experience": {
      "recordType": "experience",
      "mode": "inline",
      "countPolicy": "allAvailable",
      "allowZero": true,
      "fieldOrder": [
        "record.experience.company",
        "record.experience.title",
        "record.experience.startDate",
        "record.experience.endDate",
        "record.experience.description"
      ],
      "add": {
        "tokens": ["添加工作经历", "新增经历", "添加"]
      },
      "remove": {
        "tokens": ["删除", "移除"]
      },
      "probe": {
        "required": true,
        "rollback": "restore-count-and-original-values"
      }
    }
  }
}
```

`mode` 可以是 `inline`、`modal` 或 `step`。如果页面行为不确定，应先做真实添加探测，不要凭静态 HTML 猜测。

### 选项映射

```json
{
  "options": {
    "record.experience.workType.full_time": {
      "pageTexts": ["正式"],
      "pageValues": ["fulltime"],
      "matchMode": "confirmed_equivalent",
      "requiresCurrentOption": true
    },
    "record.publication.extra.authorRole.first_author": {
      "sourceAliases": ["第一作者"],
      "pageTexts": ["一作", "第一作者"],
      "matchMode": "alias",
      "requiresCurrentOption": true
    }
  }
}
```

规则只能引用真实探测到的页面选项。别名规则需要区分以下情况：

| `matchMode` | 含义 | 示例 |
| --- | --- | --- |
| `exact` | 页面值和标准值相同 | `第一作者 → 第一作者` |
| `normalized` | 只做大小写、空格、全半角等规范化 | `本科  → 本科` |
| `alias` | 经过确认的稳定简称或别名 | `第一作者 → 一作` |
| `confirmed_equivalent` | 运营确认的跨词等价 | `全职 → 正式` |
| `ambiguous` | 可能改变语义，必须人工选择 | `第一作者 → 共一` |

“第一作者 → 一作”可以作为高置信别名；“第一作者 → 共一”可能表示共同第一作者，不能默认自动选择，必须运营确认或交给用户处理。页面当前没有对应选项时，标记为待处理或不支持。运行时仍要在当前探测到的真实选项中找到目标，不能凭规则库文字直接生成页面选项。

### 日期规则

```json
{
  "dates": {
    "record.experience.startDate": {
      "inputMode": "custom_picker",
      "granularity": "month",
      "format": "YYYY-MM",
      "rangeRole": "start",
      "strategy": "calendar-select"
    }
  }
}
```

只保存日期控件行为，不保存任何具体日期值。

## 第四步：生成草稿

首次新增规则的实际流程：

```text
打开真实页面
→ 读取 URL
→ 扫描 raw 控件
→ 真实探测添加/删除/弹窗/选项
→ 生成 AI 候选规则
→ 人工检查 sourcePath 和动作语义
→ 保存 draft
```

规划中的请求示例：

```http
POST /autofill/rules/drafts
Content-Type: application/json
```

```json
{
  "scope": "platform",
  "platformKey": "moka",
  "sourceKey": "platform:moka:resume-edit",
  "parentRuleSetId": "generic-rule-version-id",
  "rules": {
    "schemaVersion": "page-rules.v1",
    "fields": {},
    "repeatGroups": {},
    "options": {},
    "dates": {}
  },
  "evidence": {
    "probeModes": ["inline", "modal"],
    "fieldCount": 54,
    "groupCount": 9
  }
}
```

服务端需要检查：

1. `sourceKey` 和 `scope/platformKey` 组合合法；
2. 父规则已发布且没有继承环；
3. `schemaVersion` 正确；
4. 所有 `sourcePath` 合法；
5. `semanticKey` 不重复；
6. 选项映射引用当前探测到的页面选项；
7. 规则中没有 CSS selector、JavaScript、完整 HTML 或用户简历值。

通过检查后保存为 `draft`，不能直接发布。

## 第五步：真实页面验证

发布前至少完成以下验证：

- 页面已有记录时，能够识别当前记录数；
- 目标记录更多时，能通过真实“添加”行为增加记录；
- 目标记录更少时，能通过真实“删除”行为减少记录；
- 添加探测不会留下测试行；
- 弹窗页面能识别保存/取消行为；
- 自定义下拉能读取真实选项；
- 日期规则能区分开始和结束字段；
- 所有未知字段都有明确的 `unmatched`、`unsupported` 或待 AI 状态；
- 不点击保存、提交或上传。

回读和视觉核对可以作为额外诊断，但不是当前主流程的发布门槛。

## 第六步：审核和发布

规则状态按以下顺序变化：

```text
draft → review → published
```

发布新版本时：

- 不覆盖旧版本；
- 增加 `versionNo`；
- 设置 `supersedesId`；
- 事务中切换当前 published 版本；
- 保留父规则关系，方便追踪继承来源。

如果运行失败，先把规则标记为 `needsReview`。只有确认规则已经不能使用时，才标记 `health=broken` 或回滚到上一版本。

## 平台规则和公司覆盖

如果 Moka 的多家公司页面只有少量差异：

```text
Moka 平台规则
→ Moka 校招页面规则
→ 某公司覆盖规则
```

覆盖规则只填写差异字段。一个差异在多个公司重复出现时，再提升为平台变体，不要复制规则。

## 失败处理

| 现象 | 处理 |
| --- | --- |
| URL 没有规则 | 进入 AI 首次探索，生成 draft |
| 字段找不到 | 保留规则，记录待处理字段；不要猜 selector |
| 页面没有对应选项 | 标记 `unsupported` 或进入 AI 确认 |
| 页面增加新字段 | 生成候选覆盖规则 |
| 指纹变化 | 设置 `needsReview`，不阻断当前规则 |
| 添加/删除行为失败 | 标记规则 review，保留旧版本 |
| 多家公司出现同一差异 | 创建平台 variant |

## 新增规则的发布清单

```text
[ ] sourceKey 已规范化，没有 token 或用户 ID
[ ] scope/platformKey/parentRuleSetId 正确
[ ] sourcePath 全部属于 resume.autofill.v1
[ ] fields、repeatGroups、options、dates 结构合法
[ ] 没有 CSS selector、JavaScript 或用户简历实际值
[ ] 添加/删除/弹窗行为已真实探测
[ ] 页面选项来自真实当前页面
[ ] 目标数量增减已测试
[ ] 未点击保存、提交或上传
[ ] draft 已由运营确认
[ ] published 版本可回滚
```
