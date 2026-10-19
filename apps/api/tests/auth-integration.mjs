import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

// Run only against an explicitly named, local disposable test database.
const databaseUrl = process.env.DATABASE_URL;
const database = new URL(databaseUrl || 'postgresql://invalid');
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname) && database.pathname.endsWith('_auth_test'), 'A local *_auth_test database is required');
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const messages = [], sockets = new Set(), checks = [];
const smtp = createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  let buffer = '', content = null;
  socket.setEncoding('utf8'); socket.write('220 localhost synthetic SMTP\r\n');
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (content) {
        if (line !== '.') { content.push(line); continue; }
        const raw = content.join('\r\n'); content = null;
        let body = raw.slice(raw.indexOf('\r\n\r\n') + 4);
        body = /Content-Transfer-Encoding: base64/i.test(raw) ? Buffer.from(body, 'base64').toString('utf8')
          : Buffer.from(body.replace(/=\r\n/g, '').replace(/=([A-F\d]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'binary').toString('utf8');
        messages.push(body); socket.write('250 accepted\r\n'); continue;
      }
      if (/^(EHLO|HELO)/i.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
      else if (/^AUTH /i.test(line)) socket.write('235 authenticated\r\n');
      else if (/^DATA$/i.test(line)) { content = []; socket.write('354 send content\r\n'); }
      else if (/^QUIT$/i.test(line)) socket.end('221 goodbye\r\n');
      else socket.write('250 ok\r\n');
    }
  });
});
await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`, appUrl = 'https://example.test/autofill-test';
const api = spawn(process.execPath, ['src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NODE_ENV: 'development', API_PORT: String(port), DATABASE_URL: databaseUrl, AI_PROVIDER_MODE: 'fake',
    CAPTCHA_PROVIDER: 'disabled', EMAIL_CODE_SECRET: 'local-auth-integration-only',
    MAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'false',
    SMTP_USER: 'auth-test@example.test', SMTP_PASSWORD: 'synthetic-only', MAIL_FROM: 'auth-test@example.test',
    APP_URL: appUrl, SESSION_COOKIE_NAME: 'lingke_auth_test', SESSION_COOKIE_PATH: '/autofill-test', SESSION_COOKIE_SECURE: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let startup = ''; api.stderr.on('data', data => { startup += data; }); api.stdout.on('data', () => {});
const request = async (path, body, cookie = '') => {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || '', headers: response.headers };
};
const until = async (predicate, label) => { const end = Date.now() + 5000; while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out: ' + label); };
const check = label => checks.push(label);
const email = `auth-integration-${randomUUID()}@example.test`, password = 'synthetic-password-1', newPassword = 'synthetic-password-2';
const register = extra => request('/auth/register', { email, password, passwordConfirmation: password, ...extra });
const tokenFrom = text => new URL(text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('token');
try {
  await until(async () => { try { return (await request('/health')).status === 200; } catch { if (api.exitCode !== null) throw new Error(startup); return false; } }, 'API startup');
  assert.equal((await register({ password: 'short', passwordConfirmation: 'short' })).status, 400);
  assert.equal((await register({ passwordConfirmation: 'different-password' })).status, 400);
  assert.equal((await request('/auth/email-code', { email: 'invalid' })).status, 400); check('registration input validation');
  const codeResponse = await request('/auth/email-code', { email, captcha: { provider: 'disabled' } });
  assert.equal(codeResponse.status, 200); await until(() => messages.length === 1, 'registration SMTP');
  const code = messages[0].match(/\b\d{6}\b/)[0];
  assert.equal(codeResponse.data.debugCode, code);
  assert.equal((await request('/auth/email-code', { email, captcha: {} })).status, 429);
  assert.equal((await register({ emailCode: code === '000000' ? '000001' : '000000' })).status, 400); check('SMTP code delivery, cooldown and wrong-code rejection');
  const registered = await register({ emailCode: code, role: 'admin' }); assert.equal(registered.status, 201);
  assert.equal(registered.data.user.emailVerified, true); assert.equal(registered.data.user.role, 'user');
  assert.ok(registered.headers.get('set-cookie').includes('Path=/autofill-test;'));
  assert.equal((await register({ emailCode: code })).status, 409); check('verified ordinary registration, isolated Cookie and duplicate rejection');
  const login = await request('/auth/login', { email, password }); assert.equal(login.status, 200);
  assert.equal((await request('/auth/login', { email, password: 'wrong-password' })).status, 401);
  const profile = await fetch(base + '/profiles/me', { method: 'PATCH', headers: { cookie: login.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ profile: { name: '合成认证测试' }, records: { 教育经历: [{ school: '合成大学', startDate: '2020-09' }] } }) }); assert.equal(profile.status, 200);
  const before = (await request('/profiles/me/autofill-context', undefined, login.cookie)).data; check('login and preserved-profile baseline');
  const unknown = await request('/auth/forgot-password', { email: `absent-${randomUUID()}@example.test` }); assert.equal(unknown.status, 200);
  assert.equal(messages.length, 1);
  const forgot = await request('/auth/forgot-password', { email }); assert.equal(forgot.status, 200); assert.equal(forgot.data.message, unknown.data.message);
  await until(() => messages.length === 2, 'password-reset SMTP'); assert.ok(messages[1].includes(appUrl + '/reset-password?token='));
  const expiredToken = tokenFrom(messages[1]); await prisma.passwordResetToken.updateMany({ where: { userId: registered.data.user.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await request('/auth/reset-password', { token: expiredToken, password: newPassword })).status, 400);
  await request('/auth/forgot-password', { email }); await until(() => messages.length === 3, 'second reset SMTP');
  const token = tokenFrom(messages[2]);
  assert.equal((await request('/auth/reset-password', { token, password: 'short' })).status, 400);
  assert.equal((await request('/auth/reset-password', { token: 'invalid', password: newPassword })).status, 400);
  assert.equal((await request('/auth/reset-password', { token, password: newPassword })).status, 200);
  assert.equal((await request('/auth/reset-password', { token, password })).status, 400); check('password reset SMTP, prefixed link, expiry, short/invalid/reused token rejection');
  assert.equal((await request('/auth/me', undefined, login.cookie)).status, 401);
  assert.equal((await request('/auth/login', { email, password })).status, 401);
  const relogin = await request('/auth/login', { email, password: newPassword }); assert.equal(relogin.status, 200);
  const after = (await request('/profiles/me/autofill-context', undefined, relogin.cookie)).data;
  assert.equal(after.profileVersion, before.profileVersion); assert.deepEqual(after.records, before.records); check('new password works, old password/session rejected, profile and IDs unchanged');
  await prisma.user.update({ where: { id: registered.data.user.id }, data: { emailVerifiedAt: null } });
  await request('/auth/resend-verification', { email }); await until(() => messages.length === 4, 'verification SMTP');
  assert.ok(messages[3].includes(appUrl + '/verify-email?token='));
  const expiredVerification = tokenFrom(messages[3]);
  await prisma.emailVerificationToken.updateMany({ where: { userId: registered.data.user.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await request('/auth/verify-email', { token: expiredVerification })).status, 400);
  await request('/auth/resend-verification', { email }); await until(() => messages.length === 5, 'second verification SMTP');
  const verification = tokenFrom(messages[4]);
  assert.equal((await request('/auth/verify-email', { token: 'invalid' })).status, 400);
  assert.equal((await request('/auth/verify-email', { token: verification })).status, 200);
  assert.equal((await request('/auth/verify-email', { token: verification })).status, 400); check('verification SMTP, prefixed link, expiry and single-use token');
  await request('/auth/logout', {}, relogin.cookie); assert.equal((await request('/auth/me', undefined, relogin.cookie)).status, 401); check('logout revokes session');
  console.log(JSON.stringify({ passed: checks.length, smtpMessages: messages.length, checks, captcha: 'development-only; production CAPTCHA must be tested separately' }, null, 2));
} finally {
  api.kill('SIGTERM'); for (const socket of sockets) socket.destroy(); await new Promise(resolve => smtp.close(resolve)); await prisma.$disconnect();
}
