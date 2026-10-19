import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApplicationService, applicationPayload } = require('../src/modules/applications/service.js');
const instant = (value) => new Date(`2026-10-${value}`);

function fixture() {
  const applications = [{ id: 'a', userId: 'u', company: '测试公司', version: 1, eventStart: instant('21T21:30:00Z'), eventEnd: instant('21T22:30:00Z') }, { id: 'b', userId: 'u', company: '第二公司', version: 1 }];
  const tasks = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const prisma = {
    application: {
      findFirst: async ({ where }) => applications.find(row => matches(row, where)),
      updateMany: async ({ where, data }) => {
        const row = applications.find(row => matches(row, where));
        if (!row) return { count: 0 };
        Object.assign(row, { ...data, version: row.version + data.version.increment });
        return { count: 1 };
      },
    },
    task: {
      findFirst: async ({ where }) => tasks.find(row => matches(row, where)),
      findMany: async ({ where }) => tasks.filter(row => matches(row, where)),
      create: async ({ data }) => { const row = { id: `t${tasks.length}`, ...data }; tasks.push(row); return row; },
      updateMany: async ({ where, data }) => {
        const row = tasks.find(row => matches(row, where));
        if (!row) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
    },
  };
  return { service: createApplicationService({ prisma }), applications, tasks };
}

test('task create, update and status filter reject unsupported values without changing data', async () => {
  const { service, tasks } = fixture();
  const task = await service.createTask('u', 'a', { title: '准备面试' });
  for (const status of ['completed', 'not-a-real-state', '', null, 1, ['open']]) {
    await assert.rejects(service.createTask('u', 'a', { title: '无效任务', status }), { code: 'INVALID_TASK_STATUS', status: 400 });
    await assert.rejects(service.updateTask('u', task.id, { status }), { code: 'INVALID_TASK_STATUS', status: 400 });
    await assert.rejects(service.listTasks('u', { status }), { code: 'INVALID_TASK_STATUS', status: 400 });
  }
  assert.equal(tasks.length, 1);
  assert.equal(task.status, 'open');
});

test('task completion and reopening preserve title, due date and links', async () => {
  const { service } = fixture();
  const task = await service.createTask('u', 'a', { title: '面试准备', dueAt: '2026-10-21T21:30:00Z', url: 'https://example.com/interview' });
  for (const status of ['done', 'open']) {
    const updated = await service.updateTask('u', task.id, { status });
    assert.equal(updated.status, status);
    assert.equal(updated.title, '面试准备');
    assert.equal(updated.dueAt.toISOString(), '2026-10-21T21:30:00.000Z');
    assert.equal(updated.url, 'https://example.com/interview');
    assert.equal((await service.listTasks('u', { status })).items.length, 1);
  }
});

test('empty task titles and invalid due dates fail before writes', async () => {
  const { service, tasks } = fixture();
  const task = await service.createTask('u', 'a', { title: '保留任务' });
  await assert.rejects(service.updateTask('u', task.id, { title: '  ' }), /任务标题不能为空/);
  await assert.rejects(service.updateTask('u', task.id, { dueAt: 'not-a-date' }), { code: 'INVALID_DATE', status: 400 });
  await assert.rejects(service.createTask('u', 'a', { title: '新任务', dueAt: 'invalid' }), { status: 400 });
  assert.equal(task.title, '保留任务');
  assert.equal(tasks.length, 1);
});

test('task idempotency cannot return a task belonging to another application', async () => {
  const { service, tasks } = fixture();
  const input = { title: '联系招聘官', idempotencyKey: 'retry-key' };
  const first = await service.createTask('u', 'a', input);
  assert.equal((await service.createTask('u', 'a', input)).id, first.id);
  await assert.rejects(service.createTask('u', 'b', input), { code: 'TASK_IDEMPOTENCY_CONFLICT', status: 409 });
  assert.equal(tasks.length, 1);
});

test('task reads and mutations remain scoped to the signed-in owner', async () => {
  const { service } = fixture();
  const task = await service.createTask('u', 'a', { title: '私有任务' });
  await assert.rejects(service.updateTask('other', task.id, { status: 'done' }), { status: 404 });
  await assert.rejects(service.createTask('other', 'a', { title: '跨用户' }), { status: 404 });
  await assert.rejects(service.listTasks('other', { applicationId: 'a' }), { status: 404 });
  assert.deepEqual((await service.listTasks('other')).items, []);
  assert.equal(task.status, 'open');
});

test('rescheduling or removing the interview clears the previous hidden end at the API boundary', async () => {
  const { service } = fixture();
  const updated = await service.update('u', 'a', { version: 1, eventStart: '2026-10-22T21:30:00Z' });
  assert.equal(updated.eventEnd, null);
  const removed = await service.update('u', 'a', { version: 2, eventStart: null });
  assert.equal(removed.eventStart, null);
  assert.equal(removed.eventEnd, null);
});

test('unrelated edits and unchanged starts preserve the existing interview end', async () => {
  const { service } = fixture();
  let row = await service.update('u', 'a', { version: 1, notes: '仅修改备注' });
  assert.equal(row.eventEnd.toISOString(), '2026-10-21T22:30:00.000Z');
  row = await service.update('u', 'a', { version: 2, eventStart: row.eventStart.toISOString() });
  assert.equal(row.eventEnd.toISOString(), '2026-10-21T22:30:00.000Z');
});

test('invalid interview intervals are rejected on create and update', async () => {
  assert.throws(() => applicationPayload({ company: '测试', eventEnd: '2026-10-21T22:00:00Z' }), { code: 'INVALID_EVENT_RANGE' });
  const { service, applications } = fixture();
  await assert.rejects(service.update('u', 'a', { version: 1, eventEnd: '2026-10-21T20:00:00Z' }), { code: 'INVALID_EVENT_RANGE', status: 400 });
  assert.equal(applications[0].version, 1);
});

test('mail rescheduling clears old ends while manually edited schedules remain protected', async () => {
  let app = { id: 'mail-app', userId: 'u', company: '邮件公司', title: '研发', status: 'interview', eventStart: instant('21T21:00:00Z'), eventEnd: instant('21T22:00:00Z') };
  const service = createApplicationService({ prisma: { $transaction: async callback => callback({
    mailMessage: { findFirst: async () => ({ id: 'mail', applicationId: app.id }), update: async () => ({}) },
    application: { findFirst: async () => app, update: async ({ data }) => { app = { ...app, ...data }; return app; } },
  }) } });
  await service.upsertFromMail('u', 'mail', { company: app.company, title: app.title, eventStart: '2026-10-23T21:00:00Z' });
  assert.equal(app.eventEnd, null);
  app.isUserEdited = true;
  const before = structuredClone(app);
  await service.upsertFromMail('u', 'mail', { company: app.company, title: app.title, eventEnd: '2026-10-20T01:00:00Z' });
  assert.deepEqual(app, before);
});

test('calendar emits interviews, follow-up reminders and completed tasks independently', async () => {
  const from = instant('21T00:00:00Z');
  const to = instant('22T00:00:00Z');
  const service = createApplicationService({ prisma: {
    application: { findMany: async ({ where }) => {
      assert.equal(where.userId, 'u');
      assert.deepEqual(where.OR[1], { eventStart: { lt: from }, eventEnd: { gt: from } });
      assert.deepEqual(where.OR[2], { nextFollowUpAt: { gte: from, lte: to } });
      return [
        { id: 'cross', company: '跨日面试', eventStart: instant('20T23:30:00Z'), eventEnd: instant('21T01:00:00Z') },
        { id: 'reminder', company: '跟进公司', eventStart: instant('25T12:00:00Z'), nextFollowUpAt: instant('21T16:00:00Z'), nextAction: '联系 HR' },
      ];
    } },
    task: { findMany: async ({ where }) => { assert.equal(where.userId, 'u'); return [{ id: 'task', title: '准备材料', dueAt: instant('21T10:00:00Z'), status: 'done', applicationId: 'cross' }]; } },
  } });
  const result = await service.calendar('u', { from, to });
  assert.deepEqual(result.items.map(item => `${item.type}:${item.id}`), ['application:cross', 'task:task', 'follow_up:reminder']);
  assert.equal(result.items[1].status, 'done');
  assert.match(result.items[2].title, /联系 HR/);
  assert.equal(result.items[2].applicationId, 'reminder');
  await assert.rejects(service.calendar('u', { from: to, to: from }), { code: 'INVALID_CALENDAR_RANGE', status: 400 });
});
