import test from 'node:test';
import assert from 'node:assert/strict';
import { leadingCaption, titledFormSections, nearbyFieldCaption } from '../src/page/generic-structure.ts';

const controls = 'test-controls';
function element(text = '', children = [], fields = [], labels = []) {
  const node = { textContent: text, children, fields, labels, parentElement: null, interactive: false, tagName: 'INPUT', attributes: {}, buttons: [],
    get firstElementChild() { return this.children[0] ?? null; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    contains(other) { for (let current = other; current; current = current.parentElement) if (current === this) return true; return false; },
    matches(selector) { return selector === 'form,body,section,fieldset,[role="region"],[role="dialog"]' ? false : this.interactive; },
    querySelector(selector) { return this.interactive || this.fields.length ? {} : null; },
    querySelectorAll(selector) { return selector === controls ? this.fields : selector === 'label' ? this.labels : this.buttons; },
  };
  for (const child of children) child.parentElement = node;
  return node;
}
const readText = node => node.textContent;
const module = (title, count, help = '') => element('', [element('', [element(title), element(help)]), element('', [], Array.from({ length: count }, () => element()))], Array.from({ length: count }, () => element()));
const discover = parent => titledFormSections(parent, { readText, hasStructure: node => node.fields.length > 0, visible: () => true, controls });

test('plain div modules with independent captions remain separate record types', () => {
  const education = module('教育经历', 20, '请填写教育经历'), projects = module('项目经历', 12), summary = module('自我评价', 1);
  assert.deepEqual(discover(element('', [education, projects, summary])), [education, projects, summary]);
  assert.equal(leadingCaption(education, readText), '教育经历', 'help text is not part of the section name');
});

test('ordinary single-field rows and editable leading content are not promoted to sections', () => {
  assert.deepEqual(discover(element('', [module('姓名', 1), module('邮箱', 1)])), []);
  const content = element('current private field value'); content.interactive = true;
  assert.equal(leadingCaption(element('', [content, element()]), readText), '');
});

test('numbered sibling cards retain their collection and shared add action', () => {
  const first = module('经历 1', 2), second = module('经历 2', 2);
  assert.deepEqual(discover(element('', [first, second])), [], 'identical cards are records even without an add button');
  second.fields[0].attributes.placeholder = '条件字段';
  const parent = element('', [first, second]), add = element('添加经历');
  parent.buttons.push(add);
  assert.deepEqual(discover(parent), [], 'a collection-level add still owns differently shaped cards');
  parent.buttons = [];
  assert.deepEqual(discover(parent), [first, second], 'distinct fields can name independent modules');
});

test('a shared non-date caption cannot replace distinct input names', () => {
  const surname = element(), given = element(), caption = element('姓名');
  element('', [surname, given], [surname, given], [caption]);
  assert.equal(nearbyFieldCaption(surname, readText, controls), '');
  assert.equal(nearbyFieldCaption(given, readText, controls), '');
});

test('a component wrapper and its native input count as one field', () => {
  const input = element(), wrapper = element('', [input]), caption = element('学历');
  element('', [wrapper], [wrapper, input], [caption]);
  assert.equal(nearbyFieldCaption(wrapper, readText, controls), '学历');
});

test('unassociated static labels survive deep component wrappers; date endpoints stay distinct', () => {
  const start = element(), end = element(), caption = element('起止时间');
  start.matches = end.matches = () => true;
  const item = element('', [element('', [element('', [start, end])])], [start, end], [caption]);
  // Intermediate component wrappers do not contain a separate caption.
  assert.equal(nearbyFieldCaption(start, readText, controls), '起止时间（开始）');
  assert.equal(nearbyFieldCaption(end, readText, controls), '起止时间（结束）');
  item.labels.push(element('另一个字段'));
  assert.equal(nearbyFieldCaption(start, readText, controls), '', 'ambiguous captions must not be guessed');
});
