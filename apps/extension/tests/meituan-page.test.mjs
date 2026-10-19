import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeituanPageAdapter } from '../src/page/adapters/meituan.ts';

const adapter = createMeituanPageAdapter();
const section = name => ({ classList: { contains: value => value === name }, querySelector: selector => selector === '.list_add' ? {} : null });
const record = (owner, deletion, forms = 1) => {
  const target = { textContent: deletion };
  return { target, matches: selector => selector === '.model_list', closest: selector => selector.split(',').includes(`.${owner}`) ? {} : null, querySelectorAll: () => Array(forms).fill({}), querySelector: selector => selector === ':scope > .delete-list > div' ? target : null };
};

test('only observed, reversible record collections can be probed', () => {
  for (const name of ['campus_experience_edit', 'honor_edit', 'certificate_edit', 'paper_edit']) assert.equal(adapter.canProbeAddition(section(name)), true);
  for (const name of ['base_info_edit', 'competition_edit', 'unverified_experience_edit']) assert.equal(adapter.canProbeAddition(section(name)), false);
});

test('rollback accepts the actual information/experience labels only within verified rows', () => {
  for (const [owner, label] of [['campus_experience_edit', '删除这段经历'], ['honor_edit', '删除这段信息'], ['certificate_edit', '删除这段信息'], ['paper_edit', '删除这段信息']]) {
    const row = record(owner, label);
    assert.equal(adapter.rollbackAddedRecord(row), row.target);
    assert.equal(adapter.rollbackAddedRecord(record(owner, '删除账户')), undefined);
    assert.equal(adapter.rollbackAddedRecord(record(owner, label, 2)), undefined);
  }
  assert.equal(adapter.rollbackAddedRecord(record('competition_edit', '删除这段信息')), undefined);
});

test('only isolated option/calendar portal mutations bypass form rescanning', () => {
  const body = { nodeType: 1, shadowRoot: null, matches: selector => selector.split(',').includes('body'), closest: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const popup = { nodeType: 1, shadowRoot: null, matches: selector => selector.includes('.mtd-select-popup'), querySelector: () => null, querySelectorAll: () => [], closest() { return this; } };
  const mutation = (target, addedNodes = [], removedNodes = [], type = 'childList') => ({ target, addedNodes, removedNodes, type });
  assert.equal(adapter.isTransientMutation(mutation(body, [popup])), true);
  assert.equal(adapter.isTransientMutation(mutation(popup, [], [], 'attributes')), true);
  assert.equal(adapter.isTransientMutation(mutation(body, [], [popup])), true);
  assert.equal(adapter.isTransientMutation(mutation(body, [{ ...popup, matches: () => false }])), false);
  const field = { nodeType: 1, shadowRoot: null, matches: selector => selector.includes('input'), closest: selector => selector.includes('.edu_experience_edit') ? {} : null, querySelector: () => null, querySelectorAll: () => [] };
  assert.equal(adapter.isTransientMutation(mutation(field, [], [], 'attributes')), false, 'ordinary field/section changes must still invalidate bindings');
  assert.equal(adapter.isTransientMutation(mutation(body, [{ ...popup, querySelector: () => ({ tagName: 'STYLE' }) }])), false, 'styles in a portal may affect the whole form');
  assert.equal(adapter.isTransientMutation(mutation(body, [{ ...popup, shadowRoot: {} }])), false, 'new accessible roots need full discovery');
  const unrelated = { nodeType: 1, shadowRoot: null, matches: () => false, closest: () => null, querySelector: () => null, querySelectorAll: () => [] };
  assert.equal(adapter.isTransientMutation(mutation(unrelated, [], [], 'attributes')), true, 'unrelated decorative animations do not change resume controls');
  assert.equal(adapter.isTransientMutation(mutation({ ...unrelated, querySelector: () => ({ className: 'list_add' }) }, [], [], 'attributes')), false, 'removing an empty section class still invalidates structure');
  assert.equal(adapter.isTransientMutation(mutation({ ...field, closest: () => null }, [], [], 'attributes')), true, 'controls outside the declared resume sections do not change this adapter field set');

});
