import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEmailCodeService } = require('../src/auth/email-code.js');

function setup({ production = false, sendMail: sendOverride } = {}) {
  const rows = [];
  const messages = [];
  const captchaChecks = [];
  let clock = new Date('2026-09-25T00:00:00.000Z');
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'createdAt') return row.createdAt >= value.gte;
    return row[key] === value;
  });
  const prisma = {
    user: { findUnique: async () => null },
    emailCode: {
      findFirst: async ({ where, orderBy }) => {
        const found = rows.filter((row) => matches(row, where));
        if (orderBy?.createdAt === 'desc') found.sort((a, b) => b.createdAt - a.createdAt);
        return found[0] || null;
      },
      count: async ({ where }) => rows.filter((row) => matches(row, where)).length,
      updateMany: async ({ where, data }) => {
        const matched = rows.filter((item) => matches(item, where));
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
      },
      create: async ({ data }) => {
        const row = { ...data, attempts: 0, usedAt: null, createdAt: new Date(clock) };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error('missing email code');
        for (const [key, value] of Object.entries(data)) {
          row[key] = value?.increment === undefined ? value : row[key] + value.increment;
        }
        return row;
      },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const service = createEmailCodeService({
    prisma,
    secret: 'test-only-secret',
    production,
    now: () => new Date(clock),
    verifyCaptcha: async (captcha, context) => { captchaChecks.push({ captcha, context }); },
    sendMail: sendOverride || (async (message) => { messages.push(message); }),
  });
  return {
    service, rows, messages, captchaChecks, prisma,
    advance(ms) { clock = new Date(clock.getTime() + ms); },
  };
}

const request = (service, email = ' User@Example.com ') => service.request({ email, captcha: 'captcha-ticket', ip: '203.0.113.10' });

test('sends a six-digit registration code and validates normalized email', async () => {
  const fixture = setup();
  const result = await request(fixture.service);
  assert.match(result.debugCode, /^\d{6}$/);
  assert.equal(fixture.messages.length, 1);
  assert.equal(fixture.messages[0].to, 'user@example.com');
  assert.match(fixture.messages[0].text, new RegExp(result.debugCode));
  assert.equal(fixture.rows[0].email, 'user@example.com');
  assert.notEqual(fixture.rows[0].codeHash, result.debugCode);
  assert.equal(fixture.captchaChecks[0].captcha, 'captcha-ticket');
  assert.equal(fixture.captchaChecks[0].context.ip, '203.0.113.10');
  const record = await fixture.service.validate({ email: 'USER@example.com', code: result.debugCode });
  assert.equal(record.id, fixture.rows[0].id);
});

test('enforces resend cooldown and invalidates the previous code after a resend', async () => {
  const fixture = setup();
  const first = await request(fixture.service);
  await assert.rejects(request(fixture.service), { status: 429 });
  assert.equal(fixture.messages.length, 1);
  fixture.advance(60_000);
  const second = await request(fixture.service);
  assert.equal(fixture.messages.length, 2);
  assert.notEqual(second.debugCode, first.debugCode);
  assert.ok(fixture.rows[0].usedAt);
  await assert.rejects(fixture.service.validate({ email: 'user@example.com', code: first.debugCode }), /验证码不正确/);
  await fixture.service.validate({ email: 'user@example.com', code: second.debugCode });
});

test('wrong codes increment attempts and block even a correct code after five failures', async () => {
  const fixture = setup();
  const { debugCode } = await request(fixture.service);
  const wrong = debugCode === '000000' ? '000001' : '000000';
  for (let attempt = 1; attempt <= 5; attempt++) {
    await assert.rejects(fixture.service.validate({ email: 'user@example.com', code: wrong }), /验证码不正确/);
    assert.equal(fixture.rows[0].attempts, attempt);
  }
  await assert.rejects(fixture.service.validate({ email: 'user@example.com', code: debugCode }), /无效或已过期/);
});

test('rejects expired and consumed codes', async () => {
  const fixture = setup();
  const first = await request(fixture.service);
  fixture.advance(10 * 60_000);
  await assert.rejects(fixture.service.validate({ email: 'user@example.com', code: first.debugCode }), /无效或已过期/);
  const second = await request(fixture.service);
  await fixture.service.consume({ email: 'user@example.com', code: second.debugCode });
  await assert.rejects(fixture.service.validate({ email: 'user@example.com', code: second.debugCode }), /无效或已过期/);
});

test('production response never includes the code', async () => {
  const fixture = setup({ production: true });
  const result = await request(fixture.service);
  assert.equal('debugCode' in result, false);
  assert.match(fixture.messages[0].text, /\d{6}/);
});

test('missing production secret fails closed without exposing a code', async () => {
  const fixture = setup({ production: true });
  const unavailable = createEmailCodeService({
    prisma: fixture.prisma,
    sendMail: fixture.messages.push,
    verifyCaptcha: async () => {},
    production: true,
  });
  await assert.rejects(
    unavailable.request({ email: 'user@example.com', captcha: {}, ip: '203.0.113.10' }),
    (error) => error.status === 503 && error.code === 'EMAIL_CODE_NOT_CONFIGURED',
  );
});
