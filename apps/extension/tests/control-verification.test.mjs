import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/controls/index.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createControlDriver } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function fixture(kind = 'text') {
  let reads = 0;
  const element = { value: 'old', getAttribute: () => null, querySelectorAll: () => [], matches: selector => selector === 'input,textarea' };
  const page = { resolveField: () => { reads++; return { status: 'ok', value: { element, elements: [element], kind } }; } };
  const driver = createControlDriver({ page });
  const handle = { documentId: 'document', pageRevision: 1, fieldId: 'field', sectionId: 'section', viewId: 'view' };
  const context = { sectionId: 'section', viewId: 'view', deadlineAt: Date.now() + 2000 };
  const assignment = { status: 'ready', value: 'new' };
  return { driver, element, handle, context, assignment, reads: () => reads };
}

test('pre-write mismatch returns without waiting; matching values still require stability', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await f.driver.verifyControl(f.handle, f.assignment, { ...f.context, verification: 'existing' }), { status: 'ok', value: { matches: false, actual: 'old' } });
    assert.equal(f.reads(), 2);
    f.element.value = 'new';
    const result = f.driver.verifyControl(f.handle, f.assignment, { ...f.context, verification: 'existing' });
    setTimeout(() => { f.element.value = 'changed-by-page'; }, 35);
    assert.equal((await result).value.matches, false);
    assert.ok(f.reads() > 4);
  } finally { f.driver.dispose(); }
});

test('after-write mode cannot skip stability without a proven settled write', async () => {
  const f = fixture();
  try {
    f.element.value = 'new';
    const result = f.driver.verifyControl(f.handle, f.assignment, { ...f.context, verification: 'after-write' });
    setTimeout(() => { f.element.value = 'page-rejected'; }, 35);
    assert.deepEqual((await result).value, { matches: false, actual: 'page-rejected' });
  } finally { f.driver.dispose(); }
});

test('native option IDs are resolved before the fast mismatch check', async () => {
  const f = fixture('select');
  f.element.options = [{ label: 'First author', disabled: false }];
  f.element.selectedOptions = [{ value: 'first', label: 'First author' }];
  try {
    assert.equal((await f.driver.verifyControl(f.handle, { ...f.assignment, value: 'field-option-0' }, { ...f.context, verification: 'existing' })).value.matches, true);
    assert.ok(f.reads() > 2);
  } finally { f.driver.dispose(); }
});

test('a settled write is reused only for the exact unchanged DOM binding', async () => {
  let reads = 0;
  const makeElement = () => ({ textContent: 'old', isConnected: true, parentElement: null, hidden: false, matches: () => false, getAttribute: () => null, getClientRects: () => [{}], querySelectorAll: () => [], dispatchEvent: () => true, ownerDocument: { defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), InputEvent: Event, Event } } });
  let element = makeElement();
  const driver = createControlDriver({ page: { resolveField: () => { reads++; return { status: 'ok', value: { element, elements: [element], kind: 'contenteditable' } }; } } });
  const handle = { documentId: 'document', pageRevision: 1, fieldId: 'field', sectionId: 'section', viewId: 'view' };
  const context = { sectionId: 'section', viewId: 'view', overwrite: 'replace', deadlineAt: Date.now() + 3000 };
  const assignment = { status: 'ready', value: 'new' };
  try {
    assert.equal((await driver.writeControl(handle, assignment, context)).status, 'ok');
    const before = reads;
    assert.equal((await driver.verifyControl(handle, assignment, { ...context, verification: 'after-write' })).value.matches, true);
    assert.equal(reads - before, 2, 'same settled binding needs no second stability window');
    const changedRevision = driver.verifyControl({ ...handle, pageRevision: 2 }, assignment, { ...context, verification: 'after-write' });
    setTimeout(() => { element.textContent = 'rejected-after-redraw'; }, 35);
    assert.equal((await changedRevision).value.matches, false, 'a new revision must settle again');
    element = makeElement(); element.textContent = 'new';
    const replaced = driver.verifyControl(handle, assignment, { ...context, verification: 'after-write' });
    setTimeout(() => { element.textContent = 'rejected-new-node'; }, 35);
    assert.equal((await replaced).value.matches, false, 'a replacement node cannot reuse the old receipt');
  } finally { driver.dispose(); }
});
