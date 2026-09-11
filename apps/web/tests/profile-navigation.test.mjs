import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROFILE_SECTION_OFFSET,
  getActiveProfileSection,
  getProfileNavigationLayout,
} from '../features/profile/profile-navigation.ts';

const viewport = { scrollY: 600, scrollHeight: 4000, viewportHeight: 800 };
const positions = (...tops) => tops.map((top, index) => ({ id: `section-${index}`, top }));

test('uses the first section before the reader reaches the profile cards', () => {
  assert.equal(getActiveProfileSection(positions(500, 900, 1300), viewport), 'section-0');
  assert.equal(getActiveProfileSection([], viewport), null);
});

test('keeps a tall card active until the next heading reaches the reading line', () => {
  assert.equal(getActiveProfileSection(positions(-1800, 200, 550), viewport), 'section-0');
  assert.equal(getActiveProfileSection(positions(-1900, PROFILE_SECTION_OFFSET, 450), viewport), 'section-1');
});

test('keeps the preceding section active in a gap between cards', () => {
  assert.equal(getActiveProfileSection(positions(-700, -20, 70, 400), viewport), 'section-1');
});

test('fast and reverse scrolling derive the active section from all current positions', () => {
  assert.equal(getActiveProfileSection(positions(-1500, -950, -300, 25, 500), viewport), 'section-3');
  assert.equal(getActiveProfileSection(positions(-300, 25, 550, 875, 1350), viewport), 'section-1');
  assert.equal(getActiveProfileSection(positions(300, 625, 1150, 1475, 1950), viewport), 'section-0');
});

test('activates the final card at the document bottom when its top cannot align', () => {
  const bottom = { scrollY: 2400, scrollHeight: 3200, viewportHeight: 800 };
  assert.equal(getActiveProfileSection(positions(-600, 100, 450), bottom), 'section-2');
  assert.equal(getActiveProfileSection(positions(-600, 100, 450), { ...bottom, scrollY: 2398 }), 'section-2');
  assert.equal(getActiveProfileSection(positions(-600, 100, 450), { ...bottom, scrollY: 2390 }), 'section-0');
});

test('preserves a clicked section when its jump is clamped at the document bottom', () => {
  const bottom = { scrollY: 2400, scrollHeight: 3200, viewportHeight: 800 };
  const clicked = { id: 'section-1', scrollY: 2400, scrollHeight: 3200 };
  assert.equal(getActiveProfileSection(positions(-600, 100, 450), bottom, clicked), 'section-1');
  assert.equal(getActiveProfileSection(positions(-590, 110, 460), { ...bottom, scrollY: 2390 }, clicked), 'section-0');
});

test('recalculates after editing changes document height instead of retaining a stale click', () => {
  const clicked = { id: 'section-1', scrollY: 2400, scrollHeight: 3200 };
  const expanded = { scrollY: 2400, scrollHeight: 3800, viewportHeight: 800 };
  assert.equal(getActiveProfileSection(positions(-600, 100, 450), expanded, clicked), 'section-0');
});

test('recalculates from new section positions after editing or resizing', () => {
  assert.equal(getActiveProfileSection(positions(-600, 30, 450), viewport), 'section-1');
  assert.equal(getActiveProfileSection(positions(-600, 330, 750), viewport), 'section-0');
});

test('uses a single column when all rows fit, including the exact height boundary', () => {
  assert.deepEqual(getProfileNavigationLayout(10, 494), { columns: 1, rows: 10 });
  assert.deepEqual(getProfileNavigationLayout(10, 700), { columns: 1, rows: 10 });
  assert.deepEqual(getProfileNavigationLayout(1, 44), { columns: 1, rows: 1 });
});

test('wraps into two columns as soon as a single column no longer fits', () => {
  assert.deepEqual(getProfileNavigationLayout(10, 493), { columns: 2, rows: 9 });
  assert.deepEqual(getProfileNavigationLayout(10, 244), { columns: 2, rows: 5 });
});

test('keeps the first column filled from top to bottom before the second column', () => {
  const layout = getProfileNavigationLayout(10, 344);
  assert.deepEqual(layout, { columns: 2, rows: 7 });
  const columnFor = (index) => Math.floor(index / layout.rows);
  const rowFor = (index) => index % layout.rows;
  assert.deepEqual(Array.from({ length: 10 }, (_, index) => columnFor(index)), [0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
  assert.equal(rowFor(6), 6);
  assert.equal(rowFor(7), 0);
});

test('short screens retain two columns with enough rows for every item', () => {
  assert.deepEqual(getProfileNavigationLayout(10, 44), { columns: 2, rows: 5 });
  assert.deepEqual(getProfileNavigationLayout(11, 44), { columns: 2, rows: 6 });
  assert.deepEqual(getProfileNavigationLayout(10, 0), { columns: 2, rows: 5 });
});
