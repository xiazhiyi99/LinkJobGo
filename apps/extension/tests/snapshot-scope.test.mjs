import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePageSnapshot, PROTOCOL_VERSION } from '@job-assistant/autofill-contracts';
import { scopeSectionToRecords } from '../src/runner/snapshot-scope.ts';

test('single-record option requests retain section actions but remove dangling record actions', () => {
  const first = { viewId: 'view-1', fields: [] }, second = { viewId: 'view-2', fields: [] };
  const action = (actionId, viewId) => ({ actionId, sectionId: 'section-1', kind: viewId ? 'open-record' : 'add-record', ...(viewId ? { viewId } : {}), label: '操作', hints: {} });
  const section = { sectionId: 'section-1', label: '合成经历', mode: 'inline', repeatable: true, records: [first, second], actions: [action('add'), action('edit-1', 'view-1'), action('edit-2', 'view-2')] };
  const snapshot = section => ({ protocolVersion: PROTOCOL_VERSION, documentId: 'document-1', pageRevision: 1, page: { origin: 'https://example.test', path: '/', title: '合成页面' }, sections: [section] });
  assert.equal(validatePageSnapshot(snapshot({ ...section, records: [first] })).ok, false, 'old projection produces invalid-plan-input');
  const scoped = scopeSectionToRecords(section, [first]);
  assert.equal(validatePageSnapshot(snapshot(scoped)).ok, true);
  assert.deepEqual(scoped.actions.map(action => action.actionId), ['add', 'edit-1']);
  assert.equal(section.actions.length, 3, 'the original full snapshot is not changed');
});
