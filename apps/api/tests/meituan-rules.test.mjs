import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createConfiguredSiteRegistry } = require('../src/modules/autofill/dist/engine.cjs');
const { FIELD_CATALOG, validateSemanticPage } = require('@job-assistant/autofill-contracts');
const section = (label, labels) => ({ sectionId: label, label, mode: 'inline', repeatable: true, records: [{ viewId: label + '-view', fields: labels.map((label, i) => ({ fieldId: `${label}-${i}`, label, kind: 'text', currentState: 'empty', required: false, hints: {} })) }], actions: [] });
const snapshot = sections => ({ protocolVersion: 'autofill.next.v2', documentId: 'meituan-rules', pageRevision: 1, page: { origin: 'https://zhaopin.meituan.com', path: '/web/delivery-confirm', title: '合成规则验证' }, sections });
const parserFor = snap => createConfiguredSiteRegistry().classify(snap).parser;

test('observed campus, honor and certificate labels map to the actual resume fields', () => {
  const snap = snapshot([section('校园经历', ['校园经历名称*', '角色 *', '开始时间', '结束时间', '至今', '校园经历描述']), section('荣誉', ['荣誉名称', '荣誉描述']), section('证书', ['证书名称'])]);
  const result = parserFor(snap).parse({ snapshot: snap, catalog: FIELD_CATALOG });
  assert.deepEqual(result.sections.map(s => s.recordType), ['campus', 'award', 'certificate']);
  assert.deepEqual(result.sections[0].bindings.map(binding => binding.sourceKey.path), [['fields', 'company'], ['fields', 'title'], ['fields', 'startDate'], ['fields', 'endDate'], ['fields', 'current'], ['fields', 'description']]);
  assert.ok(result.sections.flatMap(s => s.bindings).every(binding => binding.status === 'resolved'));
});

test('language exam scores use explicit extra.score, independently of proficiency and certificate', () => {
  const snap = snapshot([section('语言能力', ['语言水平', '语言考试', '考试分数'])]);
  const result = parserFor(snap).parse({ snapshot: snap, catalog: FIELD_CATALOG });
  assert.deepEqual(result.sections[0].bindings.map(binding => binding.sourceKey.path), [['fields', 'level'], ['fields', 'certificate'], ['extra', 'score']]);
  const input = { sourceKey: { scope: 'record', recordType: 'language', path: ['fields', 'certificate'] }, sourceValue: '大学英语六级', candidates: [{ optionId: 'cet6', label: 'CET-6', disabled: false }] };
  assert.equal(parserFor(snap).resolveOption(input), 'cet6');
});

test('existing education and work extra fields are not mistaken for missing or unrelated standard fields', () => {
  const snap = snapshot([section('教育经历', ['学院名称', '成绩排名', '是否全日制', '实验室', '请输入实验室', '导师', '研究方向']), section('工作经历', ['部门名称', '工作类型'])]);
  const result = parserFor(snap).parse({ snapshot: snap, catalog: FIELD_CATALOG });
  assert.deepEqual(result.sections[0].bindings.map(binding => binding.sourceKey.path), [['extra', 'college'], ['extra', 'rank'], ['extra', 'fullTime'], ['extra', 'laboratory'], ['extra', 'laboratory'], ['extra', 'advisor'], ['extra', 'researchDirection']]);
  assert.deepEqual(result.sections[1].bindings.map(binding => binding.sourceKey.path), [['extra', 'department'], ['extra', 'employmentType']]);
  assert.ok(result.sections.flatMap(s => s.bindings).every(binding => binding.status === 'resolved'));
});

test('paper sections never receive patent records or unsupported channel/impact-factor guesses', () => {
  const snap = snapshot([section('论文', ['论文名称', '作者顺序', '论文链接', '发表渠道', '影响因子'])]);
  const parser = parserFor(snap), result = parser.parse({ snapshot: snap, catalog: FIELD_CATALOG });
  assert.equal(result.sections[0].recordFilter, 'papers');
  assert.deepEqual(result.sections[0].bindings.slice(0, 3).map(binding => binding.sourceKey.path), [['fields', 'name'], ['fields', 'role'], ['fields', 'url']]);
  assert.ok(result.sections[0].bindings.slice(3).every(binding => binding.status === 'unsupported' && binding.sourceKey === null));
  for (const type of ['论文', '会议论文', 'journal article']) assert.equal(parser.includeRecord({ filter: 'papers', record: { recordType: 'publication', extra: { publicationType: type } } }), true);
  for (const type of ['专利', 'patent', '', undefined]) assert.equal(parser.includeRecord({ filter: 'papers', record: { recordType: 'publication', extra: { publicationType: type } } }), false);
  assert.equal(validateSemanticPage({ protocolVersion: 'autofill.next.v2', documentId: snap.documentId, pageRevision: 1, ...result }, snap, FIELD_CATALOG).ok, true);
});

test('author aliases distinguish first author from shared first author and reject ambiguous matches', () => {
  const parser = parserFor(snapshot([section('论文', ['作者顺序'])]));
  const sourceKey = { scope: 'record', recordType: 'publication', path: ['fields', 'role'] };
  const first = { optionId: 'first', label: '一作', disabled: false }, shared = { optionId: 'shared', label: '共一', disabled: false };
  assert.equal(parser.resolveOption({ sourceKey, sourceValue: '第一作者', candidates: [first, shared] }), 'first');
  assert.equal(parser.resolveOption({ sourceKey, sourceValue: '共同第一作者', candidates: [first, shared] }), 'shared');
  assert.equal(parser.resolveOption({ sourceKey, sourceValue: '第一作者', candidates: [shared] }), null);
  assert.equal(parser.resolveOption({ sourceKey, sourceValue: '第一作者', candidates: [first, { ...first, optionId: 'duplicate' }] }), null);
  assert.equal(parser.resolveOption({ sourceKey, sourceValue: '第一作者', candidates: [{ ...first, disabled: true }] }), null);
});
