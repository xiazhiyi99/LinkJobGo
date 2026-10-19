import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaticDismissal } from '../src/controls/static-dismissal.ts';

function caption({ label = true, associated = false, interactive = false, ownInteractive = false } = {}) {
  return {
    matches(selector) { return selector === 'p,div,span' || ownInteractive; },
    querySelector(selector) {
      if (selector === 'label') return label ? {} : null;
      if (selector === 'label[for]') return associated ? {} : null;
      return interactive ? {} : null;
    },
  };
}

test('component-approved static captions can dismiss without permitting associated labels or interactive targets', () => {
  assert.equal(isStaticDismissal(caption(), false), false);
  assert.equal(isStaticDismissal(caption(), true), true);
  for (const options of [{ associated: true }, { interactive: true }, { ownInteractive: true }]) assert.equal(isStaticDismissal(caption(options), true), false);
  assert.equal(isStaticDismissal(caption({ label: false }), false), true);
});
