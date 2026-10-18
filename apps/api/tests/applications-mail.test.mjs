import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applicationPayload, createApplicationService, STATUS_ORDER, STATUSES } = require('../src/modules/applications/service.js');
const { createMailService, PROVIDERS } = require('../src/modules/mail/service.js');

test('application payload normalizes the public contract and rejects unknown status', () => {
  const payload = applicationPayload({ company: '腾讯', title: '产品运营', source: 'email', eventStart: '2026-09-20T10:00:00Z' });
  assert.equal(payload.company, '腾讯');
  assert.equal(payload.source, 'email');
  assert.equal(payload.eventStart.toISOString(), '2026-09-20T10:00:00.000Z');
  assert.throws(() => applicationPayload({ company: '腾讯', title: '岗位', status: 'unknown' }), /status 不合法/);
  assert.deepEqual([...STATUSES], ['saved', 'applied', 'screening', 'interview', 'offer', 'closed']);
  assert.ok(STATUS_ORDER.interview > STATUS_ORDER.screening);
});

test('mail provider metadata never exposes credentials', async () => {
  const service = createMailService({ prisma: {} });
  const result = await service.providers();
  assert.deepEqual(result.items.map((item) => item.id), PROVIDERS.map((item) => item.id));
  assert.equal(Object.hasOwn(result.items[0], 'credentialCiphertext'), false);
});

test('a company alone is sufficient and an interview does not require an end time', () => {
  const payload = applicationPayload({ company: ' 测试公司 ', eventStart: '2026-10-20T10:00:00Z' });
  assert.equal(payload.company, '测试公司');
  assert.equal(payload.title, '');
  assert.equal(payload.eventEnd, null);
  assert.equal(payload.status, 'saved');
  assert.equal(applicationPayload({ company: '测试公司', title: '  ' }).title, '');
  assert.equal(applicationPayload({ company: '测试公司', role: '研发' }).title, '研发');
  assert.throws(() => applicationPayload({ company: '  ' }), /公司不能为空/);
});

test('an existing role can be cleared and filled in later without clearing the company', async () => {
  let row = { id: 'application-1', userId: 'user-1', company: '测试公司', title: '研发', version: 1 };
  const service = createApplicationService({ prisma: { application: {
    findFirst: async ({ where }) => where.id === row.id && where.userId === row.userId ? row : null,
    updateMany: async ({ where, data }) => {
      assert.equal(where.userId, row.userId);
      assert.equal(where.version, row.version);
      assert.equal(typeof data.title, 'string');
      row = { ...row, ...data, version: row.version + data.version.increment };
      return { count: 1 };
    },
  } } });
  assert.equal((await service.update('user-1', row.id, { version: 1, title: '' })).title, '');
  assert.equal((await service.update('user-1', row.id, { version: 2, title: '产品经理' })).title, '产品经理');
  await assert.rejects(service.update('user-1', row.id, { version: 3, company: ' ' }), /公司不能为空/);
  assert.equal(row.company, '测试公司');
});
