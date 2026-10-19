import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createProfileStore, userA } from './fixtures/profile-store.mjs';
import { isMokaApplicationPage } from '../../extension/src/page/adapters/moka.ts';
const require = createRequire(import.meta.url);
const { createSiteRegistry, createConfiguredSiteRegistry, createMappingService } = require('../src/modules/autofill/dist/engine.cjs');
const { createProfileService } = require('../src/profile/service');
const { FIELD_CATALOG, validateFillPlan } = require('@job-assistant/autofill-contracts');

function snapshot(tenant = 'synthetic-a', formId = '1001', jobId = 'job-1') {
  const section = (id, label, fields, repeatable = false) => ({ sectionId: id, label, mode: 'inline', repeatable, actions: [], records: [{ viewId: id + '-view', fields: fields.map(([label, kind = 'text'], index) => ({ fieldId: `${id}-${index}`, label, kind, required: false, currentState: 'empty', hints: { component: kind === 'combobox' ? 'moka-select' : 'moka-text' } })) }] });
  return { protocolVersion: 'autofill.next.v2', documentId: 'synthetic', pageRevision: 1, page: { origin: 'https://app.mokahr.com', path: `/campus_apply/${tenant}/${formId}`, hashRoute: `/job/${jobId}/apply`, title: 'Synthetic ATS' }, sections: [section('basic', '个人信息', [['姓名'], ['邮箱']]), section('education', '教育背景', [['学校名称'], ['专业名称'], ['学历', 'combobox']], true), section('internships', '实习经历', [['公司名称'], ['职位名称'], ['工作职责', 'textarea']], true)] };
}

test('one provider parser maps multiple companies, forms and jobs without AI or copied source rules', async () => {
  const registry = createConfiguredSiteRegistry({ mokaMode: 'enabled' });
  const profileService = createProfileService({ prisma: createProfileStore().prisma });
  const resume = await profileService.getAutofillContext(userA);
  let aiCalls = 0;
  const service = createMappingService({ catalog: FIELD_CATALOG, siteRegistry: registry, resumeClient: { load: async () => resume }, aiResolver: { resolveUnknownFields: async () => { aiCalls++; return { bindings: [], warnings: [] }; } } });
  const context = { principal: userA, requestId: 'provider-test', deadlineAt: Date.now() + 5000 };
  for (const [tenant, form, job] of [['synthetic-a', '1001', 'job-1'], ['synthetic-b', '2002', 'job-2'], ['zuoyebang', '999999', 'another-job'], ['baai', '42174', 'new-job']]) {
    const snap = snapshot(tenant, form, job), selected = registry.classify(snap);
    assert.equal(selected.kind, 'known'); assert.equal(selected.parser.id, 'moka'); assert.equal(selected.supported, true);
    const semanticPage = await service.analyzePage({ snapshot: snap, runId: 'provider-test' }, context);
    assert.deepEqual(semanticPage.sections.map(section => section.recordType), [undefined, 'education', 'experience']);
    assert.ok(semanticPage.sections.flatMap(section => section.bindings).every(binding => binding.resolvedBy === 'site'));
    const plan = await service.buildFillPlan({ runId: 'provider-test', snapshot: snap, semanticPage, scope: { sectionIds: ['basic', 'education', 'internships'] }, optionEvidence: [] }, context);
    assert.equal(plan.sections[0].records[0].assignments[0].value, resume.profile.name);
    assert.deepEqual(plan.sections[1].records.map(record => record.recordId), resume.records.filter(record => record.recordType === 'education').map(record => record.id));
    assert.ok(validateFillPlan(plan, { snapshot: snap, semanticPage, catalog: FIELD_CATALOG, resumeContext: resume }).ok);
  }
  assert.equal(aiCalls, 0);
});

test('a matching provider URL without compatible controls preserves unknown-site AI routing', async () => {
  const registry = createConfiguredSiteRegistry({ mokaMode: 'enabled' });
  const snap = snapshot();
  for (const section of snap.sections) for (const field of section.records[0].fields) field.hints = {};
  assert.equal(registry.classify(snap).kind, 'unknown');
  let calls = 0;
  const service = createMappingService({ catalog: FIELD_CATALOG, siteRegistry: registry, resumeClient: {}, aiResolver: { async resolveUnknownFields() { calls++; return { bindings: [], warnings: [] }; } } });
  await service.analyzePage({ snapshot: snap, runId: 'unknown-controls' }, { principal: userA, requestId: 'unknown-controls', deadlineAt: Date.now() + 5000 });
  assert.equal(calls, 1);
  for (const page of [
    { origin: 'https://app.mokahr.com.evil.test' }, { path: '/campus_apply/synthetic-a/not-numeric' }, { path: '/campus_apply/synthetic-a/1001/extra' }, { hashRoute: '/job/job-1' }, { hashRoute: '/jobs' },
  ]) assert.equal(registry.classify({ ...snapshot(), page: { ...snapshot().page, ...page } }).kind, 'unknown');
  assert.equal(createConfiguredSiteRegistry().classify(snapshot()).kind, 'unknown', 'disabled provider remains disabled');
});

const provider = (id = 'shared', options = {}) => ({ id, name: id, version: '1', scope: 'provider', provider: 'synthetic-ats', origins: ['https://ats.example.test', 'https://careers.company.example.test'], routes: [{ path: /^\/apply\/\d+$/ }], matches: () => true, parse: () => ({ sections: [], warnings: [] }), ...options });
test('one rule accepts multiple exact domains and a company override wins only in its declared route', () => {
  const shared = provider(), company = provider('company', { scope: 'site', routes: [{ path: '/apply/100' }] });
  const registry = createSiteRegistry([shared, company]);
  for (const origin of shared.origins) {
    assert.equal(registry.classify({ ...snapshot(), page: { origin, path: '/apply/100' } }).parser.id, 'company');
    assert.equal(registry.classify({ ...snapshot(), page: { origin, path: '/apply/200' } }).parser.id, 'shared');
  }
  assert.equal(registry.classify({ ...snapshot(), page: { origin: 'https://ats.example.test.attacker.test', path: '/apply/100' } }).kind, 'unknown');
});
test('priority is deterministic, equal-priority ambiguity fails closed and parser errors do not fall through', () => {
  const snap = { ...snapshot(), page: { origin: 'https://ats.example.test', path: '/apply/100' } };
  assert.equal(createSiteRegistry([provider('low'), provider('high', { priority: 10 })]).classify(snap).parser.id, 'high');
  assert.throws(() => createSiteRegistry([provider('one'), provider('two')]).classify(snap), /Conflicting/);
  assert.equal(createSiteRegistry([provider('incompatible', { priority: 10, matches: () => false }), provider('compatible')]).classify(snap).parser.id, 'compatible');
  const broken = provider('broken', { scope: 'site', matches() { throw new Error('broken-company-rule'); } });
  assert.throws(() => createSiteRegistry([provider(), broken]).classify(snap), /broken-company-rule/);
  const rejected = provider('unsupported', { scope: 'site', matches: () => false });
  const result = createSiteRegistry([provider(), rejected]).classify(snap);
  assert.equal(result.parser.id, 'unsupported'); assert.equal(result.supported, false);
  assert.throws(() => createSiteRegistry([provider('bad-regex', { routes: [{ path: /apply/g }] })]), /stateful/);
  assert.throws(() => createSiteRegistry([provider('bad-priority', { priority: NaN })]), /priority/);
});

test('tenant-specific derived fields are not inherited by unrelated employers', () => {
  const snap = snapshot(); snap.sections[0].records[0].fields.push({ fieldId: 'school', label: '最高学历高校', kind: 'text', required: false, currentState: 'empty', hints: { component: 'moka-text' } });
  const parser = createConfiguredSiteRegistry({ mokaMode: 'enabled' }).classify(snap).parser;
  const binding = parser.parse({ snapshot: snap, catalog: FIELD_CATALOG }).sections[0].bindings.find(binding => binding.templateFieldId === 'school');
  assert.equal(binding.derivation, undefined); assert.equal(binding.status, 'unresolved');
});

test('frontend URL gates and backend provider routes agree on dynamic and rejected application URLs', () => {
  const registry = createConfiguredSiteRegistry({ mokaMode: 'enabled' });
  for (const changes of [{}, { path: '/campus_apply/company_b/99999/' }, { hashRoute: '/job/other-job/apply/' }, { origin: 'https://app.mokahr.com.evil.test' }, { path: '/campus_apply/name/not-numeric' }, { hashRoute: '/job/other-job' }]) {
    const snap = snapshot(); Object.assign(snap.page, changes);
    const accepted = isMokaApplicationPage({ origin: snap.page.origin, pathname: snap.page.path, hash: '#' + snap.page.hashRoute });
    assert.equal(registry.classify(snap).kind === 'known', accepted);
  }
});
