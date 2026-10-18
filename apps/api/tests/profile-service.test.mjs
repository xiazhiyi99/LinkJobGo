import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateResumeContext } from '@job-assistant/autofill-contracts';
import { createProfileService } from '../src/profile/service.js';
import { createPlatformResumeClient } from '../src/modules/autofill/adapters/resume-client.js';
import { createProfileStore, userA, userB, fixedDate } from './fixtures/profile-store.mjs';

const expected = JSON.parse(await readFile(new URL('./fixtures/profile-context-before-extraction.json', import.meta.url), 'utf8'));
const setup = () => {
  const store = createProfileStore();
  const service = createProfileService({ prisma: store.prisma, now: () => new Date(fixedDate) });
  return { ...store, service, client: createPlatformResumeClient({ profileService: service }) };
};
const context = (principal = userA, overrides = {}) => ({ principal, deadlineAt: Date.now() + 5000, ...overrides });

test('extracted projection preserves the pre-extraction JSON, all record partitions and source precision', async () => {
  const { service } = setup();
  const value = await service.getAutofillContext(userA);
  assert.deepEqual(value, expected);
  assert.equal(validateResumeContext(value).ok, true);
  assert.equal(new Set(value.records.map(record => record.recordType)).size, 9);
  assert.deepEqual(value.records.filter(record => record.recordType === 'education').map(record => [record.id, record.index]),
    [['education-old', 0], ['education-new', 1]]);
  assert.equal(value.records[0].fields.current, false);
  assert.equal(value.records[0].fields.startDate, '2020-09');
  assert.equal(value.records[0].extra.score, 0);
  assert.deepEqual(value.records[0].extra.nested, { kept: ['甲', { valid: false }] });
  assert.equal(value.profile.birthday, null);
  const profile = await service.getProfile(userA);
  assert.equal(profile.profile.userId, userA.id, 'Legacy profile response keeps its existing metadata');
  assert.equal(profile.profile.email, userA.email);
  assert.equal(profile.campusExperiences[0].id, 'experience-campus');
  assert.equal(profile.publications[0].id, 'publication-a');
});

test('reader scopes every query to the trusted account and excludes soft-deleted records', async () => {
  const { service, client, calls, rows } = setup();
  const [a, b] = await Promise.all([client.load(context()), client.load(context(userB, { userId: userA.id }))]);
  assert.equal(a.profile.email, userA.email);
  assert.equal(b.profile.email, userB.email);
  assert.deepEqual(b.records.map(record => record.id), ['education-user-b']);
  assert.equal(a.records.some(record => ['education-user-b', 'education-deleted'].includes(record.id)), false);
  assert.equal(calls.filter(call => call.userId === userA.id).length, 6);
  assert.equal(calls.filter(call => call.userId === userB.id).length, 6);
  rows.education.find(record => record.id === 'education-old').deletedAt = fixedDate;
  const removed = await service.getAutofillContext(userA);
  assert.equal(removed.records.some(record => record.id === 'education-old'), false);
  assert.notEqual(removed.profileVersion, a.profileVersion);
});

test('adapter detects source changes without caching and never trusts generatedAt as the version', async () => {
  const { service, client, rows } = setup();
  const initial = await client.load(context());
  const later = createProfileService({ prisma: createProfileStore().prisma, now: () => new Date('2026-10-18T12:00:00Z') });
  const withLaterTimestamp = await later.getAutofillContext(userA);
  assert.notEqual(withLaterTimestamp.generatedAt, initial.generatedAt);
  assert.equal(withLaterTimestamp.profileVersion, initial.profileVersion);
  assert.deepEqual(await client.load(context(userA, { expectedProfileVersion: initial.profileVersion })), initial);
  rows.education[1].school = '修改后的示例大学';
  await assert.rejects(client.load(context(userA, { expectedProfileVersion: initial.profileVersion })),
    error => error.code === 'resume-version-changed' && error.status === 409);
  assert.notEqual((await service.getAutofillContext(userA)).profileVersion, initial.profileVersion);
});

test('invalid identity, deadline and version fail before loading; unavailable or malformed sources do not fall back', async () => {
  let loads = 0;
  const client = createPlatformResumeClient({ profileService: { async getAutofillContext() { loads += 1; return expected; } } });
  for (const principal of [null, {}, { id: userA.id }, { id: '', email: userA.email }]) {
    await assert.rejects(client.load(context(principal)), error => error.code === 'authentication-required');
  }
  await assert.rejects(client.load(context(userA, { deadlineAt: NaN })), error => error.code === 'invalid-request');
  await assert.rejects(client.load(context(userA, { deadlineAt: Date.now() - 1 })), error => error.status === 504);
  await assert.rejects(client.load(context(userA, { expectedProfileVersion: 'invalid' })), error => error.code === 'invalid-request');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(client.load(context(userA, { signal: cancelled.signal })), error => error.status === 504);
  assert.equal(loads, 0);
  const unavailable = createPlatformResumeClient({ profileService: { async getAutofillContext() { throw new Error('PRIVATE_DATABASE_FAILURE'); } } });
  await assert.rejects(unavailable.load(context()), error => error.code === 'resume-api-unavailable' && !error.message.includes('PRIVATE'));
  const invalid = createPlatformResumeClient({ profileService: { async getAutofillContext() { return { ...expected, records: [{ id: 'bad' }] }; } } });
  await assert.rejects(invalid.load(context()), error => error.code === 'resume-api-invalid');
});

test('cancellation and deadline stop waiting and discard a late database result', async () => {
  let complete;
  const client = createPlatformResumeClient({ profileService: { getAutofillContext: () => new Promise(resolve => { complete = resolve; }) } });
  const controller = new AbortController();
  const pending = client.load(context(userA, { signal: controller.signal }));
  controller.abort();
  await assert.rejects(pending, error => error.status === 504);
  complete(expected);
  await assert.rejects(client.load(context(userA, { deadlineAt: Date.now() + 15 })), error => error.status === 504);
  complete(expected);
});
