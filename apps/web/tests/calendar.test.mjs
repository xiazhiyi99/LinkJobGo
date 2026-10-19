import assert from 'node:assert/strict';
import test from 'node:test';
import { dateInput, inputDateValue, dateOnlyText } from '../features/workspace/applications/date-time.ts';
import { civilDate, getCalendarRange, parseItems, segmentsForDay, layoutCalendarSegments, eventTone, itemKey } from '../features/workspace/applications/calendar-model.ts';

function inZone(zone, run) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { run(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}
const segment = (date, item) => segmentsForDay(parseItems([{ id: 'a', title: '测试', type: 'application', ...item }]), civilDate(date));

for (const zone of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC', 'Asia/Kolkata']) {
  test(`${zone}: editor, stored instant and calendar preserve the same 14:30 local time`, () => inZone(zone, () => {
    const value = inputDateValue('2026-10-21T14:30', true);
    assert.equal(dateInput(value, true), '2026-10-21T14:30');
    const [item] = segment('2026-10-21', { start: value });
    assert.equal(item.startMinute, 14 * 60 + 30);
    assert.equal(item.timeLabel, '14:30');
    const range = getCalendarRange('2026-10-21', 'day');
    assert.equal(dateInput(range.from, true), '2026-10-21T00:00');
    assert.equal(dateInput(range.to, true), '2026-10-21T23:59');
  }));
  test(`${zone}: date-only application days never shift on display or save`, () => inZone(zone, () => {
    assert.equal(dateInput('2026-10-21T00:00:00.000Z'), '2026-10-21');
    assert.equal(dateOnlyText('2026-10-21T00:00:00.000Z'), '10/21');
    assert.equal(inputDateValue('2026-10-21'), '2026-10-21T00:00:00.000Z');
  }));
}

test('local calendar ranges honor 23/25 hour daylight-saving days', () => inZone('America/Los_Angeles', () => {
  for (const [day, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
    const range = getCalendarRange(day, 'day');
    assert.equal(Date.parse(range.to) - Date.parse(range.from) + 1, hours * 3600000);
    assert.equal(segment(day, { start: inputDateValue(`${day}T23:30`, true) })[0].timeLabel, '23:30');
  }
  assert.throws(() => inputDateValue('2026-03-08T02:30', true), /日期时间无效/);
}));

test('cross-midnight interviews appear on both days and unknown ends never invent a next-day event', () => inZone('America/Los_Angeles', () => {
  const start = inputDateValue('2026-10-21T23:30', true);
  const end = inputDateValue('2026-10-22T01:00', true);
  assert.equal(segment('2026-10-21', { start, end })[0].timeLabel, '23:30–24:00 继续');
  assert.equal(segment('2026-10-22', { start, end })[0].timeLabel, '前日 00:00–01:00');
  assert.equal(segment('2026-10-22', { start }).length, 0);
  assert.equal(segment('2026-10-21', { start: 'invalid' }).length, 0);
}));

test('completed and reopened tasks show the actual state while reminders have their own identity', () => inZone('Asia/Shanghai', () => {
  const item = { type: 'task', start: '2026-10-21T14:30:00+08:00', status: 'done' };
  assert.equal(segment('2026-10-21', item)[0].timeLabel, '14:30 · 已完成');
  assert.equal(eventTone({ ...item }), 'success');
  assert.equal(segment('2026-10-21', { ...item, status: 'open' })[0].timeLabel, '14:30 · 待办');
  assert.equal(segment('2026-10-21', { ...item, type: 'follow_up' })[0].timeLabel, '14:30 · 跟进');
  assert.notEqual(itemKey({ id: 'a', type: 'application' }), itemKey({ id: 'a', type: 'follow_up' }));
}));

test('overlapping events use separate lanes without losing events', () => inZone('UTC', () => {
  const items = parseItems([
    { id: 'a', type: 'application', start: '2026-10-21T10:00Z', end: '2026-10-21T11:00Z' },
    { id: 'b', type: 'task', start: '2026-10-21T10:30Z' },
    { id: 'c', type: 'application', start: '2026-10-21T12:00Z' },
  ]);
  const layout = layoutCalendarSegments(segmentsForDay(items, civilDate('2026-10-21')));
  assert.equal(layout.length, 3);
  assert.deepEqual(layout.map(item => [item.item.id, item.lane, item.lanes]), [['a', 0, 2], ['b', 1, 2], ['c', 0, 1]]);
}));
