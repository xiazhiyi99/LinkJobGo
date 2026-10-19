import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/controls/index.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createControlDriver } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('removal requires the exact confirmed record order at the control boundary', async () => {
  const handle = { documentId: 'doc', pageRevision: 1, sectionId: 'work', viewId: 'tail', actionId: 'remove-tail' };
  const intent = { kind: 'remove-record', sectionId: 'work', viewId: 'tail' };
  let resolutions = 0;
  const driver = createControlDriver({ page: {
    scanSection: async () => ({ status: 'ok', value: { records: [{ viewId: 'retained' }, { viewId: 'tail' }], actions: [{ ...intent, actionId: 'remove-tail' }] } }),
    canRemoveRecordAction: () => true,
    resolveAction: () => { resolutions++; return { status: 'needs-user', code: 'test-action-resolution-boundary' }; },
  } });
  const context = { sectionId: 'work', viewId: 'tail', overwrite: 'replace', deadlineAt: Date.now() + 2000 };
  try {
    for (const expectedRecordOrder of [undefined, ['tail', 'retained'], ['retained'], ['retained', 'tail', 'new']]) {
      const result = await driver.performAction(handle, intent, { ...context, expectedRecordOrder });
      assert.equal(result.code, expectedRecordOrder ? 'overwrite-record-order-changed' : 'unproven-record-removal');
      assert.equal(resolutions, 0, 'unsafe deletion never resolves a click target');
    }
    const allowed = await driver.performAction(handle, intent, { ...context, expectedRecordOrder: ['retained', 'tail'] });
    assert.equal(allowed.code, 'test-action-resolution-boundary');
    assert.equal(resolutions, 1);
  } finally { driver.dispose(); }
});
