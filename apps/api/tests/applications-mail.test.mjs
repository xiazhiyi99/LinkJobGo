import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applicationPayload, STATUS_ORDER, STATUSES } = require('../src/modules/applications/service.js');
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
