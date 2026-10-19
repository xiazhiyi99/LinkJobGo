import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { FIELD_CATALOG, validateSemanticPage, validateFillPlan } = require('@job-assistant/autofill-contracts');
const { createConfiguredSiteRegistry, createMappingService } = require('../src/modules/autofill/dist/engine.cjs');
const field = (label, kind = 'text') => [label, kind];
const section = (id, label, fields, repeatable = true) => ({ sectionId: id, label, mode: 'inline', repeatable, actions: [], records: [{ viewId: `${id}-view`, fields: fields.map(([label, kind], i) => ({ fieldId: `${id}-${i}`, label, kind, currentState: 'empty', required: false, hints: {} })) }] });
const work = id => section(id, id === 'intern' ? '实习经历' : '工作经历', [field('公司名称'), field('职位名称'), field('起止时间（开始）'), field('起止时间（结束）'), field('描述', 'textarea')]);
const snapshot = () => ({ protocolVersion: 'autofill.next.v2', documentId: 'byte-test', pageRevision: 1, page: { origin: 'https://jobs.bytedance.com', path: '/campus/resume/123/apply', title: 'Synthetic application' }, sections: [
  section('basic', '基本信息', [field('姓名'), field('手机号码', 'combobox'), field('手机号码'), field('邮箱'), field('个人证件'), field('期望工作地点', 'combobox')], false),
  section('education', '教育经历', [field('学校名称'), field('学历', 'combobox'), field('专业'), field('学历类型', 'combobox'), field('学院'), field('实验室'), field('领域方向'), field('导师'), field('起止时间（开始）'), field('起止时间（结束）')]),
  work('intern'), work('employment'),
  section('projects', '项目经历', [field('项目名称'), field('项目角色'), field('起止时间（开始）'), field('起止时间（结束）'), field('项目链接'), field('描述', 'textarea')]),
  section('language', '语言能力', [field('语言', 'combobox'), field('精通程度', 'combobox')]),
  section('summary', '自我评价', [field('自我评价', 'textarea')], false),
] });
const registry = createConfiguredSiteRegistry();
const resume = { schemaVersion: 'resume.autofill.v1', profileVersion: 'a'.repeat(64), generatedAt: '2026-10-18T00:00:00.000Z', profile: { name: '测试姓名', phone: '13800000000', email: 'test@example.test', selfIntroduction: '合成测试资料' }, preferences: {}, records: [
  { id: 'full-1', recordType: 'experience', index: 0, fields: { company: '全职测试', title: '工程师', description: '测试' }, extra: { employmentType: '正式' } },
  { id: 'intern-1', recordType: 'experience', index: 1, fields: { company: '实习测试', title: '实习生', description: '测试' }, extra: { employmentType: '实习' } },
  { id: 'full-2', recordType: 'experience', index: 2, fields: { company: '全职测试二', title: '工程师', description: '测试' }, extra: { employmentType: '全职' } },
  { id: 'uncertain', recordType: 'experience', index: 3, fields: { company: '未知类型', title: '实习生' }, extra: {} },
  { id: 'edu-1', recordType: 'education', index: 0, fields: { school: '测试大学', degree: '硕士研究生', major: '计算机' }, extra: { fullTime: '是' } },
] };

test('ByteDance rules use observed labels and separate phone text from dialing prefix', () => {
  const snap = snapshot(), parser = registry.classify(snap).parser;
  const page = { documentId: snap.documentId, pageRevision: 1, ...parser.parse({ snapshot: snap, catalog: FIELD_CATALOG }) };
  assert.equal(validateSemanticPage(page, snap).ok, true);
  assert.deepEqual(page.sections[0].bindings.map(b => b.sourceKey?.path ?? null), [['name'], null, ['phone'], ['email'], null, null]);
  assert.deepEqual(page.sections[1].bindings.slice(3, 8).map(b => b.sourceKey.path), [['extra', 'fullTime'], ['extra', 'college'], ['extra', 'laboratory'], ['extra', 'researchDirection'], ['extra', 'advisor']]);
  assert.deepEqual(page.sections[4].bindings.map(b => b.sourceKey.path.at(-1)), ['name', 'role', 'startDate', 'endDate', 'url', 'description']);
  assert.deepEqual(page.sections[5].bindings.map(b => b.sourceKey.path.at(-1)), ['name', 'level']);
  assert.deepEqual(page.sections[6].bindings[0].sourceKey, { scope: 'profile', path: ['selfIntroduction'] });
});

test('ByteDance section selection filters before assigning stable destination positions and never calls AI', async () => {
  let aiCalls = 0;
  const service = createMappingService({ resumeClient: { load: async () => resume }, siteRegistry: registry, catalog: FIELD_CATALOG, aiResolver: { resolveUnknownFields: async () => { aiCalls++; throw new Error('must not call AI'); }, resolveOptionMatches: async () => { aiCalls++; throw new Error('must not call AI'); } } });
  const snap = snapshot();
  const input = { protocolVersion: 'autofill.next.v2', requestId: 'r', runId: 'run', deadlineAt: Date.now() + 5000, snapshot: snap };
  const context = { principal: { id: 'test', email: 'test@example.test' }, requestId: 'r', deadlineAt: input.deadlineAt, signal: new AbortController().signal };
  const semanticPage = await service.analyzePage(input, context);
  assert.ok(semanticPage.warnings.includes('site-parser:bytedance@1.0.0'));
  const planInput = { ...input, semanticPage, optionEvidence: [], scope: { sectionIds: semanticPage.sections.map(s => s.sectionId) } };
  const plan = await service.buildFillPlan(planInput, context);
  assert.deepEqual(plan.sections.find(s => s.sectionId === 'intern').records.map(r => [r.recordId, r.targetIndex]), [['intern-1', 0]]);
  assert.deepEqual(plan.sections.find(s => s.sectionId === 'employment').records.map(r => [r.recordId, r.targetIndex]), [['full-1', 0], ['full-2', 1]]);
  assert.equal(validateFillPlan(plan, { snapshot: snap, semanticPage, catalog: FIELD_CATALOG, resumeContext: resume }).ok, true);
  const scoped = await service.buildFillPlan({ ...planInput, scope: { sectionIds: ['employment'], recordIds: ['full-2'] } }, context);
  assert.equal(scoped.sections[0].records[0].targetIndex, 1);
  const options = { documentId: snap.documentId, pageRevision: 1, probeId: 'probe', sectionId: 'education', viewId: 'education-view', templateFieldId: 'education-1', recordId: 'edu-1', status: 'ready', options: [{ optionId: 'wrong', label: '博士', disabled: false }] };
  const unmatched = await service.buildFillPlan({ ...planInput, optionEvidence: [options] }, context);
  assert.equal(unmatched.sections.find(s => s.sectionId === 'education').records[0].assignments[1].status, 'unresolved');
  assert.equal(aiCalls, 0);
});

test('ByteDance aliases select only an unambiguous observed option without inventing proficiency', () => {
  const parser = registry.classify(snapshot()).parser;
  const key = (recordType, path) => ({ scope: 'record', recordType, path });
  const option = (label, optionId = label) => ({ optionId, label, disabled: false });
  assert.equal(parser.resolveOption({ sourceKey: key('education', ['fields', 'degree']), sourceValue: '硕士研究生', candidates: [option('硕士')] }), '硕士');
  assert.equal(parser.resolveOption({ sourceKey: key('education', ['extra', 'fullTime']), sourceValue: '是', candidates: [option('统招全日制')] }), '统招全日制');
  assert.equal(parser.resolveOption({ sourceKey: key('language', ['fields', 'level']), sourceValue: 'CET-6', candidates: [option('商务会话')] }), null);
  assert.equal(parser.resolveOption({ sourceKey: key('education', ['fields', 'degree']), sourceValue: '本科', candidates: [option('本科', 'a'), option('大学本科', 'b')] }), null);
});

test('ByteDance rules fail closed for changed section shape and unsupported routes', async () => {
  const snap = snapshot(), parser = registry.classify(snap).parser;
  snap.sections[1].records[0].fields = snap.sections[1].records[0].fields.filter(f => f.label !== '专业');
  assert.equal(parser.parse({ snapshot: snap, catalog: FIELD_CATALOG }).sections[1].recordType, undefined);
  for (const path of ['/campus/login', '/campus/resume/123/apply/other']) assert.deepEqual(registry.classify({ ...snap, page: { ...snap.page, path } }).supported, false);
  assert.equal(registry.classify({ ...snap, page: { ...snap.page, origin: 'https://jobs.bytedance.com.example.test' } }).kind, 'unknown');
  const record = { recordType: 'experience', extra: { employmentType: '未知', profileSection: '实习经历' } };
  assert.equal(parser.includeRecord({ filter: 'internships', record }), false);
});
