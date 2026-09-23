import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMailSender, smtpOptions } = require('../src/auth/mail.js');

test('Alibaba SMTP defaults to SSL on port 465 and keeps credentials out of mail payload', async () => {
  const env = {
    MAIL_PROVIDER: 'smtp',
    MAIL_FROM: '领客 <no-reply@notify.linkaigo.com>',
    SMTP_HOST: 'smtpdm-ap-southeast-1.aliyuncs.com',
    SMTP_PORT: '465',
    SMTP_USER: 'no-reply@notify.linkaigo.com',
    SMTP_PASSWORD: 'smtp-secret',
  };
  const options = smtpOptions(env);
  assert.equal(options.host, env.SMTP_HOST);
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.equal(options.auth.user, env.SMTP_USER);
  assert.equal(options.auth.pass, env.SMTP_PASSWORD);

  let sent;
  let closed = false;
  await createMailSender({
    env,
    createTransport: (transportOptions) => ({
      sendMail: async (message) => { sent = { transportOptions, message }; },
      close: () => { closed = true; },
    }),
  })({ to: 'user@example.com', subject: '验证领客邮箱', text: '请点击链接' });
  assert.equal(sent.message.from, env.MAIL_FROM);
  assert.equal(sent.message.to, 'user@example.com');
  assert.equal(sent.transportOptions.auth.pass, env.SMTP_PASSWORD);
  assert.equal(closed, true);
});

test('SMTP rejects a From address that does not match the authenticated sender', () => {
  assert.throws(() => smtpOptions({
    MAIL_FROM: '领客 <other@notify.linkaigo.com>',
    SMTP_HOST: 'smtpdm-ap-southeast-1.aliyuncs.com',
    SMTP_PORT: '465',
    SMTP_USER: 'no-reply@notify.linkaigo.com',
    SMTP_PASSWORD: 'smtp-secret',
  }), /MAIL_FROM.*SMTP_USER/);
});

test('SMTP can use port 80 with explicit STARTTLS', () => {
  const options = smtpOptions({
    MAIL_FROM: 'no-reply@example.com',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '80',
    SMTP_USER: 'no-reply@example.com',
    SMTP_PASSWORD: 'smtp-secret',
  });
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
});
