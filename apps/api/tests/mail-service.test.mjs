import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { encryptCredential, decryptCredential, fetchOAuthMessages } = require('../src/modules/mail/service.js');
const { imapConnectionError } = require('../src/modules/mail/imap-errors.js');

test('mailbox authentication failures name the required credential and never expose provider responses', async()=>{
  const previous = process.env.MAIL_CREDENTIAL_KEY;
  process.env.MAIL_CREDENTIAL_KEY = 'unit-test-key';
  let writes = 0;
  const service = require('../src/modules/mail/service.js').createMailService({
    prisma: {mailAccount:{upsert:async()=>{writes++;}}},
    adapters: {pythonProbe:async()=>{throw Object.assign(new Error('synthetic-secret provider response'),{code:'IMAP_AUTH_FAILED'});}},
  });
  try {
    for (const [provider, credential] of [['qq','授权码'],['126','授权码'],['163','授权码'],['icloud','应用专用密码'],['imap','密码']]) {
      await assert.rejects(service.createImap('synthetic-user',{provider,email:'synthetic@example.test',passwordOrCode:'synthetic-secret'}),caught=>{
        assert.equal(caught.code,'IMAP_AUTH_FAILED');
        assert.equal(caught.status,400);
        assert.match(caught.message,new RegExp(`${credential}错误`));
        assert.doesNotMatch(caught.message,/synthetic-secret|provider response/);
        if(credential==='授权码')assert.doesNotMatch(caught.message,/密码/);
        return true;
      });
    }
    assert.equal(writes,0,'Failed verification must not create or overwrite an existing mailbox');
  } finally {if(previous===undefined)delete process.env.MAIL_CREDENTIAL_KEY;else process.env.MAIL_CREDENTIAL_KEY=previous;}
});

test('network, TLS, rate limits and disabled services remain distinct from incorrect mailbox credentials',()=>{
  const provider={authMode:'authorization_code'};
  for(const [code,status,fragment] of [['IMAP_TIMEOUT',504,'超时'],['IMAP_TLS_FAILED',502,'安全连接'],['IMAP_NOT_ENABLED',400,'未开启'],['IMAP_ACCESS_DENIED',403,'安全验证'],['IMAP_RATE_LIMITED',429,'频繁'],['IMAP_REQUEST_FAILED',502,'收件箱'],['IMAP_INVALID_RESPONSE',502,'返回异常'],['ECONNREFUSED',502,'无法连接']]) {
    const caught=imapConnectionError(provider,{code,message:'synthetic-secret'});
    assert.equal(caught.status,status);
    assert.ok(caught.message.includes(fragment));
    assert.doesNotMatch(caught.message,/授权码错误|synthetic-secret/);
  }
  assert.equal(imapConnectionError(provider,{code:'__proto__'}).code,'IMAP_CONNECTION_FAILED');
});

test('the subprocess bridge preserves error codes, rejects invalid replies and keeps credentials private', {skip:process.platform==='win32',timeout:15000}, async()=>{
  const previousKey=process.env.MAIL_CREDENTIAL_KEY,previousPython=process.env.PYTHON_BIN;
  const directory=await mkdtemp(path.join(tmpdir(),'mail-probe-test-'));
  const executable=path.join(directory,'synthetic-probe');
  await writeFile(executable,`#!${process.execPath}\nlet input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const {secret}=JSON.parse(input);if(secret==='null-result')process.stdout.write('null');else if(secret==='invalid-result')process.stdout.write('{}');else if(secret==='invalid-json')process.stdout.write('not json');else if(secret==='success')process.stdout.write(JSON.stringify({messages:[]}));else {process.stdout.write(JSON.stringify({error:'private '+secret,code:secret==='timeout'?'IMAP_TIMEOUT':'IMAP_AUTH_FAILED'}));process.exitCode=2;}});\n`,{mode:0o700});
  process.env.MAIL_CREDENTIAL_KEY='unit-test-key';process.env.PYTHON_BIN=executable;
  let writes=0;
  const service=require('../src/modules/mail/service.js').createMailService({prisma:{mailAccount:{upsert:async({create})=>{writes++;return {id:'synthetic-account',...create};}}}});
  try {
    for(const [secret,code] of [['wrong-code','IMAP_AUTH_FAILED'],['timeout','IMAP_TIMEOUT'],['null-result','IMAP_INVALID_RESPONSE'],['invalid-result','IMAP_INVALID_RESPONSE'],['invalid-json','IMAP_INVALID_RESPONSE']]) {
      await assert.rejects(service.createImap('synthetic-user',{provider:'qq',email:'synthetic@qq.com',passwordOrCode:secret}),caught=>{
        assert.equal(caught.code,code);assert.ok(!caught.message.includes(secret));return true;
      });
    }
    assert.equal(writes,0);
    const account=await service.createImap('synthetic-user',{provider:'qq',email:'synthetic@qq.com',passwordOrCode:'success'});
    assert.equal(account.id,'synthetic-account');assert.equal(writes,1);
    process.env.PYTHON_BIN=path.join(directory,'missing-probe');
    await assert.rejects(service.createImap('synthetic-user',{provider:'qq',email:'synthetic@qq.com',passwordOrCode:'wrong-code'}),caught=>caught.code==='IMAP_CONNECTION_FAILED');
  } finally {
    if(previousKey===undefined)delete process.env.MAIL_CREDENTIAL_KEY;else process.env.MAIL_CREDENTIAL_KEY=previousKey;
    if(previousPython===undefined)delete process.env.PYTHON_BIN;else process.env.PYTHON_BIN=previousPython;
    await rm(directory,{recursive:true,force:true});
  }
});

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

test('missing credential encryption configuration rejects IMAP before contacting the provider', async () => {
  const previous = process.env.MAIL_CREDENTIAL_KEY; delete process.env.MAIL_CREDENTIAL_KEY;
  let contacted = 0;
  const mail = require('../src/modules/mail/service.js').createMailService({ prisma: {}, adapters: { imap: { connect: async () => { contacted++; return { messages: [] }; } } } });
  try {
    await assert.rejects(mail.createImap('synthetic-user', { provider: 'qq', email: 'synthetic@qq.com', authorizationCode: 'synthetic-code' }), e => e.code === 'MAIL_CREDENTIAL_KEY_REQUIRED');
    assert.equal(contacted, 0);
  } finally { if (previous === undefined) delete process.env.MAIL_CREDENTIAL_KEY; else process.env.MAIL_CREDENTIAL_KEY = previous; }
});

test('OAuth cannot redirect the user to authorization without a credential encryption key', async () => {
  const previous = process.env.MAIL_CREDENTIAL_KEY, client = process.env.MAIL_OUTLOOK_CLIENT_ID;
  delete process.env.MAIL_CREDENTIAL_KEY; process.env.MAIL_OUTLOOK_CLIENT_ID = 'synthetic-client';
  const mail = require('../src/modules/mail/service.js').createMailService({ prisma: {} });
  try { await assert.rejects(mail.createOAuthStart('synthetic-user', { provider: 'outlook' }), e => e.code === 'MAIL_CREDENTIAL_KEY_REQUIRED'); }
  finally {
    if (previous === undefined) delete process.env.MAIL_CREDENTIAL_KEY; else process.env.MAIL_CREDENTIAL_KEY = previous;
    if (client === undefined) delete process.env.MAIL_OUTLOOK_CLIENT_ID; else process.env.MAIL_OUTLOOK_CLIENT_ID = client;
  }
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
