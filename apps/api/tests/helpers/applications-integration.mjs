import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// request(path, body?, method?) returns {status, data}. Never touches profiles.
export async function checkApplications(request, otherRequest) {
  const checks = [];
  const run = `calendar-regression-${randomUUID().slice(0, 8)}`;
  const call = async (path, body, method, status = 200) => {
    const result = await request(path, body, method);
    assert.equal(result.status, status, `${method || 'GET'} ${path}: ${JSON.stringify(result.data)}`);
    return result.data;
  };
  const before = await call('/profiles/me/autofill-context');
  let app = (await call('/applications', { company: run, appliedOn: '2026-10-21', eventStart: '2026-10-21T21:30:00Z', status: 'interview', idempotencyKey: run }, 'POST', 201)).application;
  assert.equal(app.eventEnd, null); checks.push('interview_start_only');
  const update = async (body) => { app = (await call(`/applications/${app.id}`, { version: app.version, ...body }, 'PATCH')).application; return app; };
  await update({ eventEnd: '2026-10-21T22:30:00Z' });
  await update({ notes: '其他资料保持', nextFollowUpAt: '2026-10-22T19:00:00Z', nextAction: '联系 HR' });
  assert.equal(app.eventEnd, '2026-10-21T22:30:00.000Z'); checks.push('unrelated_edit_preserves_schedule');
  await call(`/applications/${app.id}`, { version: app.version, eventEnd: '2026-10-21T20:00:00Z' }, 'PATCH', 400);
  await update({ eventStart: '2026-10-23T21:30:00Z' });
  assert.equal(app.eventEnd, null); assert.equal(app.notes, '其他资料保持'); assert.equal(app.appliedOn, '2026-10-21T00:00:00.000Z'); checks.push('reschedule_clears_only_hidden_end');
  const tasksPath = `/applications/${app.id}/tasks`;
  let task = (await call(tasksPath, { title: '准备材料', dueAt: '2026-10-23T20:00:00Z', idempotencyKey: `${run}-task` }, 'POST', 201)).task;
  assert.equal((await call(tasksPath, { title: '准备材料', idempotencyKey: `${run}-task` }, 'POST', 201)).task.id, task.id); checks.push('task_create_idempotent');
  for (const status of ['not-a-real-state', 'completed', '', null]) {
    await call(tasksPath, { title: '不应创建', status }, 'POST', 400);
    await call(`/tasks/${task.id}`, { status }, 'PATCH', 400);
  }
  await call('/tasks?status=invalid', undefined, undefined, 400);
  await call(`/tasks/${task.id}`, { title: '' }, 'PATCH', 400);
  await call(`/tasks/${task.id}`, { dueAt: 'bad-date' }, 'PATCH', 400);
  assert.equal((await call(tasksPath)).items.length, 1); checks.push('invalid_task_writes_rejected_without_data_loss');
  const month = () => call('/calendar?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z');
  for (const status of ['done', 'open']) {
    task = (await call(`/tasks/${task.id}`, { status }, 'PATCH')).task;
    const item = (await month()).items.find(item => item.type === 'task' && item.id === task.id);
    assert.equal(item.status, status); assert.equal(item.start, '2026-10-23T20:00:00.000Z');
    assert.equal(task.title, '准备材料');
  }
  checks.push('task_completion_reopen_and_calendar_agree');
  const events = (await month()).items.filter(item => item.applicationId === app.id);
  assert.deepEqual(new Set(events.map(item => item.type)), new Set(['application', 'follow_up', 'task']));
  assert.equal(events.find(item => item.type === 'application').start, '2026-10-23T21:30:00.000Z');
  assert.match(events.find(item => item.type === 'follow_up').title, /联系 HR/); checks.push('interview_and_follow_up_are_independent');
  await update({ nextFollowUpAt: null });
  assert.equal((await month()).items.some(item => item.applicationId === app.id && item.type === 'follow_up'), false);
  assert.ok((await month()).items.some(item => item.id === task.id)); checks.push('clear_reminder_preserves_task');
  await update({ eventStart: '2026-10-20T23:00:00Z', eventEnd: '2026-10-21T02:00:00Z' });
  const crossDay = await call('/calendar?from=2026-10-21T00:00:00Z&to=2026-10-21T23:59:59Z');
  assert.ok(crossDay.items.some(item => item.type === 'application' && item.id === app.id)); checks.push('overlap_from_previous_day_included');
  await call('/calendar?from=2026-10-22&to=2026-10-21', undefined, undefined, 400); checks.push('calendar_reversed_range_rejected');
  if (otherRequest) {
    for (const [path, body, method] of [[`/applications/${app.id}`], [tasksPath], [tasksPath, { title: '跨用户' }, 'POST'], [`/tasks/${task.id}`, { status: 'done' }, 'PATCH']]) assert.equal((await otherRequest(path, body, method)).status, 404);
    const otherCalendar = await otherRequest('/calendar?from=2026-10-01&to=2026-11-01');
    assert.ok(!otherCalendar.data.items.some(item => item.applicationId === app.id)); checks.push('other_owner_cannot_read_or_write');
  }
  // Leave one useful synthetic example for the browser round-trip.
  await update({ eventStart: '2026-10-21T21:30:00Z', nextFollowUpAt: '2026-10-22T19:00:00Z' });
  const after = await call('/profiles/me/autofill-context');
  assert.equal(after.profileVersion, before.profileVersion);
  assert.deepEqual(after.records, before.records); checks.push('all_resume_records_and_profile_version_unchanged');
  return { passed: checks.length, checks, applicationId: app.id, taskId: task.id, company: run };
}
