import test from 'node:test';
import assert from 'node:assert/strict';
import { excessRecordIds } from '../src/runner/record-alignment.ts';
const fixture = () => ({ overwrite: true, scoped: false, knownSite: true,
  section: { mode: 'inline', repeatable: true, records: [0,1,2,3].map(i => ({ viewId: `view-${i}` })) },
  semantic: { recordType: 'experience', bindings: [{ status: 'resolved', sourceKey: { scope: 'record', recordType: 'experience' } }] },
  plan: { recordType: 'experience', records: [0,1].map(i => ({ recordType: 'experience', recordId: `source-${i}`, targetIndex: i })) },
});
test('full known-site overwrite removes only surplus trailing rows, in reverse order', () => {
  assert.deepEqual(excessRecordIds(fixture()), ['view-3','view-2']);
  const empty = fixture(); empty.plan.records = [];
  assert.deepEqual(excessRecordIds(empty), ['view-3','view-2','view-1','view-0']);
  const shorter = fixture(); shorter.section.records = shorter.section.records.slice(0,1);
  assert.deepEqual(excessRecordIds(shorter), []);
});
test('preserve, scoped, unknown, unclassified and gapped plans cannot authorize deletion', () => {
  for (const overrides of [{ overwrite:false }, { scoped:true }, { knownSite:false }]) assert.deepEqual(excessRecordIds({ ...fixture(), ...overrides }), []);
  const gap = fixture(); gap.plan.records[1].targetIndex = 3; assert.deepEqual(excessRecordIds(gap), []);
  const unknown = fixture(); unknown.semantic.bindings = []; assert.deepEqual(excessRecordIds(unknown), []);
  const mixed = fixture(); mixed.plan.records[1].recordType = 'education'; assert.deepEqual(excessRecordIds(mixed), []);
});
