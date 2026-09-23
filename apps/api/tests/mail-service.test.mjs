import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { encryptCredential, decryptCredential, fetchOAuthMessages } = require('../src/modules/mail/service.js');

test('mail credentials use authenticated encryption and never store plaintext', () => {
  const previous = process.env.MAIL_CREDENTIAL_KEY;
  process.env.MAIL_CREDENTIAL_KEY = 'unit-test-key';
  const encrypted = encryptCredential('refresh-token-value');
  assert.equal(typeof encrypted.credentialCiphertext, 'string');
  assert.notEqual(encrypted.credentialCiphertext, 'refresh-token-value');
  assert.equal(decryptCredential(encrypted), 'refresh-token-value');
  if (previous === undefined) delete process.env.MAIL_CREDENTIAL_KEY; else process.env.MAIL_CREDENTIAL_KEY = previous;
});

test('OAuth Outlook adapter normalizes provider messages without contacting network', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return { value: [{ id: 'graph-id', internetMessageId: '<mail-1>', conversationId: 'thread-1', subject: '面试通知', receivedDateTime: '2026-09-20T08:00:00Z', from: { emailAddress: { address: 'hr@example.com', name: 'HR' } }, bodyPreview: '请参加面试', body: { content: '<p>请参加面试</p>' } }] };
  };
  const rows = await fetchOAuthMessages('outlook', { access_token: 'test-token' }, 7, request);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { providerMessageId: '<mail-1>', threadId: 'thread-1', fromEmail: 'hr@example.com', fromName: 'HR', subject: '面试通知', receivedAt: '2026-09-20T08:00:00Z', snippet: '请参加面试', body: '请参加面试' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].options.headers.authorization, /test-token/);
});

test('manual mail analysis is sanitized and linked to an application', async () => {
  const row = { id: 'mail-1', userId: 'user-1', applicationId: null, aiResult: null, isJobRelated: null };
  const application = { id: 'app-1', company: '腾讯', title: '产品运营' };
  const prisma = {
    mailMessage: {
      findFirst: async () => row,
      update: async ({ data }) => Object.assign(row, data),
    },
    application: { findFirst: async () => application },
  };
  const mail = require('../src/modules/mail/service.js').createMailService({
    prisma,
    applicationService: { upsertFromMail: async () => application },
  });
  const response = await mail.updateAnalysis('user-1', 'mail-1', { result: {
    company: '腾讯', role: '产品运营', status: 'interview',
    eventStart: '2026-09-20T10:00:00+08:00',
    interviewUrl: 'javascript:alert(1)', summary: '面试通知', isJobRelated: true,
  } });
  assert.equal(response.application.id, 'app-1');
  assert.equal(row.applicationId, 'app-1');
  assert.equal(row.aiResult.interviewUrl, null);
  assert.equal(row.aiResult.role, '产品运营');
  assert.equal(row.classificationSource, 'manual');
});
