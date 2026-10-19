import test from 'node:test';
import assert from 'node:assert/strict';
import { ownsSectionNode } from '../src/page/section-ownership.ts';

function node(parent) {
  return { parent, contains(candidate) { for (let n = candidate; n; n = n.parent) if (n === this) return true; return false; } };
}

test('external controls do not register form add buttons a second time in the body fallback', () => {
  const body = node(), form = node(body), agreement = node(body), outsideAdd = node(body);
  const buttons = Array.from({ length: 9 }, () => node(form));
  for (const boundaries of [[form, body], [body, form]]) {
    for (const button of buttons) assert.deepEqual(boundaries.filter(section => section.contains(button) && ownsSectionNode(section, button, boundaries)), [form]);
    assert.equal(ownsSectionNode(body, agreement, boundaries), true);
    assert.equal(ownsSectionNode(body, outsideAdd, boundaries), true, 'legitimate fallback actions remain available');
    assert.equal(ownsSectionNode(body, form, boundaries), false, 'fallback must not reuse the form as a record');
  }
});

test('nested semantic sections retain their own actions and records independently of discovery order', () => {
  const outer = node(), inner = node(outer), sibling = node(outer);
  const inside = node(inner), ownAction = node(outer), siblingAction = node(sibling);
  const boundaries = [outer, sibling, inner];
  assert.equal(ownsSectionNode(outer, inside, boundaries), false);
  assert.equal(ownsSectionNode(inner, inside, boundaries), true);
  assert.equal(ownsSectionNode(outer, ownAction, boundaries), true);
  assert.equal(ownsSectionNode(outer, siblingAction, boundaries), false);
  assert.equal(ownsSectionNode(sibling, siblingAction, boundaries), true);
  assert.equal(ownsSectionNode(outer, node(), boundaries), true, 'explicit adapter actions outside the section remain subject to adapter authorization');
});
