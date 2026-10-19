import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/runner/index.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createRunner } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const ok = value => ({ status: 'ok', value });

function fixture({ rejectWrite = false } = {}) {
  const field = { fieldId: 'name', label: '姓名', kind: 'text', required: true, currentState: 'empty', hints: {} };
  const template = { viewId: 'view', fields: [field] };
  const section = { sectionId: 'basic', label: '基本信息', mode: 'inline', repeatable: false, records: [template], actions: [] };
  const snapshot = { protocolVersion: 'autofill.next.v2', documentId: 'document', pageRevision: 1, page: { origin: 'https://example.test', path: '/apply', title: 'Synthetic' }, sections: [section] };
  const sourceKey = { scope: 'profile', path: ['name'] };
  const semanticPage = { documentId: 'document', pageRevision: 1, warnings: [], sections: [{ sectionId: 'basic', template, bindings: [{ templateFieldId: 'name', sourceKey, status: 'resolved', resolvedBy: 'site' }] }] };
  const handle = { documentId: 'document', pageRevision: 1, sectionId: 'basic', viewId: 'view', fieldId: 'name' };
  const bound = { sectionId: 'basic', viewId: 'view', pageRevision: 1, fieldMap: { name: handle }, actionMap: {}, structureSignature: 'synthetic' };
  const page = { getIdentity: () => ({ documentId: 'document', pageRevision: 1 }), getPerformanceMetrics: () => ({ refreshes: 0, refreshMs: 0, looseControlsVisited: 0, cacheHits: 0, sectionRefreshes: 0, sectionRefreshMs: 0, sectionsScanned: 0 }), scanPage: async () => ok(snapshot), scanSection: async () => ok(section), bindRecord: async () => ok(bound), getDiagnostics: () => [] };
  const checks = []; let value = '';
  const controls = {
    verifyControl: async (handle, assignment, ctx) => { checks.push(ctx.verification ?? 'audit'); return ok({ matches: value === assignment.value, actual: value }); },
    writeControl: async () => { if (!rejectWrite) value = '合成候选人'; return ok({ attempted: true, value }); },
  };
  const mappingClient = { analyzePage: async () => semanticPage, buildFillPlan: async input => ({ runId: input.runId, documentId: 'document', pageRevision: 1, profileVersion: 'a'.repeat(64), warnings: [], sections: [{ sectionId: 'basic', records: [{ recordId: null, recordIndex: null, recordType: null, targetIndex: null, assignments: [{ templateFieldId: 'name', sourceRef: sourceKey, value: '合成候选人', transform: 'identity', status: 'ready', resolvedBy: 'site' }] }] }] }) };
  return { runner: createRunner({ page, controls, mappingClient }), checks };
}

test('ordinary filling confirms writes without repeating a whole-form value audit', async () => {
  const f = fixture(); const result = await f.runner.start();
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.deepEqual(f.checks, ['existing', 'after-write']);
  assert.equal(result.items[0].verification, 'readback');
});

test('explicit QA audit remains available and rejected writes still fail in ordinary mode', async () => {
  const audited = fixture(); assert.equal((await audited.runner.start({ auditFinalValues: true })).status, 'completed');
  assert.deepEqual(audited.checks, ['existing', 'after-write', 'audit']);
  const rejected = fixture({ rejectWrite: true }); const result = await rejected.runner.start();
  assert.equal(result.status, 'partial', JSON.stringify(result));
  assert.equal(result.items[0].status, 'failed');
  assert.equal(result.items[0].reason, 'readback-mismatch');
});
