import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildExtension, root } from '../scripts/build.mjs';
import { withBrowserFixture, connectCDP } from './helpers/browser.mjs';

if (!process.env.DATABASE_URL) throw new Error('Set an isolated DATABASE_URL; this test creates synthetic accounts and records.');
const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await predicate(); if (result) return result; await wait(50); }
  throw new Error('Timed out: ' + label);
}
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
const reserved = createServer(); const apiOrigin = await listen(reserved); await close(reserved);
const requests = [], modelCalls = [];
let hangModel = false, modelWaiting = false, modelClosed = false;
const model = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString());
  const input = JSON.parse(payload.messages[1].content); modelCalls.push(input);
  if (hangModel) { modelWaiting = true; res.once('close', () => { modelClosed = true; }); return; }
  const bindings = [];
  for (const section of input.sections || []) for (const field of section.fields) {
    const type = section.label.includes('教育') ? 'education' : section.label.includes('工作') ? 'experience' : undefined;
    const name = { 学校: 'school', 学历: 'degree', 开始日期: 'startDate', 结束日期: 'endDate', 公司: 'company', 职位: 'title' }[field.label];
    const candidate = input.candidates.find(c => name && type && c.sourceKey.scope === 'record' && c.sourceKey.recordType === type && c.sourceKey.path.at(-1) === name);
    if (candidate) bindings.push({ sectionId: section.sectionId, templateFieldId: field.templateFieldId, candidateId: candidate.candidateId });
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bindings }) } }] }));
});
const modelOrigin = await listen(model);
const extensionPath = resolve(root, '.test-dist/browser-extension');
const built = await buildExtension({ config: { apiOrigin, development: true }, outdir: extensionPath });
let api;
const password = 'Synthetic-Only-Password-2026';
const fixtureA = [{ school: '合成甲大学', degree: '本科', startDate: '2018-09', endDate: '2022-06' }, { school: '合成乙大学', degree: '硕士', startDate: '2022-09', endDate: '2025-06' }];
const fixtureB = [{ school: '隔离甲学院', degree: '本科', startDate: '2017-09', endDate: '2021-06' }, { school: '隔离乙学院', degree: '硕士', startDate: '2021-09', endDate: '2024-06' }];
async function platformRequest(path, input, cookie, method = 'POST') {
  const response = await fetch(apiOrigin + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const body = await response.json(); assert.ok(response.ok, `${path}: ${response.status}`);
  return { body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function createAccount(records) {
  const email = `extension-${crypto.randomUUID()}@example.test`;
  await platformRequest('/auth/register', { email, password, passwordConfirmation: password });
  const login = await platformRequest('/auth/login', { email, password });
  await platformRequest('/profiles/me', { profile: { name: '浏览器合成候选人' }, records: { 教育经历: records } }, login.cookie, 'PATCH');
  return { email, id: login.body.user.id };
}
async function targetClient(httpOrigin, targetId) {
  const info = await until(async () => (await (await fetch(httpOrigin + '/json/list')).json()).find(t => t.id === targetId), 'target connection');
  const cdp = await connectCDP(info.webSocketDebuggerUrl);
  const client = {
    cdp,
    async evaluate(expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    async click(selector) {
      const point = await this.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)throw new Error('Missing click target'); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    },
    async fill(selector, value) {
      await this.click(selector);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
      await cdp.send('Input.insertText', { text: value });
    },
    close() { cdp.close(); },
  };
  return client;
}
try {
  await withBrowserFixture(async ({ page, origin, browserSocket, httpOrigin }) => {
    const loaded = await browserSocket.send('Extensions.loadUnpacked', { path: extensionPath });
    assert.ok(loaded.id, 'Actual unpacked extension required');
    api = spawn(process.execPath, ['src/index.js'], {
      cwd: resolve(root, '../api'), stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'development', API_PORT: new URL(apiOrigin).port, WEB_ORIGIN: origin, MAIL_PROVIDER: 'console', AI_PROVIDER_MODE: 'http', AI_TEXT_RETRY_STRATEGY: 'official_only', AI_OFFICIAL_BASE_URL: modelOrigin, AI_OFFICIAL_API_KEY: 'synthetic-model-key', AI_OFFICIAL_MODEL: 'controlled-test', AI_MAX_ATTEMPTS: '1', AUTOFILL_EXTENSION_ORIGINS: `chrome-extension://${loaded.id}` },
    });
    // Drain output without retaining emails, login responses or environment data.
    api.stdout.resume(); api.stderr.resume();
    await until(async () => { if (api.exitCode !== null) throw new Error('API process exited ' + api.exitCode); try { return (await fetch(apiOrigin + '/health')).ok; } catch { return false; } }, 'platform API startup');
    const a = await createAccount(fixtureA), b = await createAccount(fixtureB);
    await prisma.user.update({where:{id:a.id},data:{role:'admin'}});
    const workerInfo = await until(async () => (await browserSocket.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url === `chrome-extension://${loaded.id}/background.js`), 'extension worker');
    const worker = await targetClient(httpOrigin, workerInfo.targetId);
    worker.cdp.ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Network.requestWillBeSent') requests.push(new URL(message.params.request.url).pathname); });
    await worker.cdp.send('Network.enable');
    let popup, popupId, contentContext;
    page.cdp.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.executionContextCreated' && message.params.context.origin === `chrome-extension://${loaded.id}`) contentContext = message.params.context.id;
    });
    const formUrl = origin + '/assets/fixtures/records.html';
    const openPopup = async () => {
      const tab = (await browserSocket.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(t => t.url === formUrl);
      assert.ok(tab); await browserSocket.send('Extensions.triggerAction', { id: loaded.id, targetId: tab.targetId });
      const target = await until(async () => (await browserSocket.send('Target.getTargets')).targetInfos.find(t => t.url === `chrome-extension://${loaded.id}/popup.html`), 'popup open');
      popupId = target.targetId; popup = await targetClient(httpOrigin, popupId);
      await until(() => popup.evaluate("!!document.querySelector('#login-status') && !document.querySelector('[data-command=start]').disabled"), 'popup ready');
    };
    const closePopup = async () => { popup?.close(); popup = undefined; if (popupId) await browserSocket.send('Target.closeTarget', { targetId: popupId }).catch(() => {}); popupId = undefined; };
    const navigate = async () => { await closePopup(); contentContext = undefined; await page.goto(formUrl); await page.waitForFunction(() => !!document.querySelector('#resume-next-launcher')?.shadowRoot); await openPopup(); };
    const loginPopup = async account => {
      await closePopup();
      await mkdir(resolve(root, '.test-dist'), {recursive:true});
      await writeFile(resolve(root, '.test-dist/cookie-login.html'), `<!doctype html><form><input id="email"><input id="password" type="password"><button>网页登录</button></form><p id="result"></p><script>document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch(${JSON.stringify(apiOrigin)}+'/auth/login',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});document.querySelector('#result').textContent=r.ok?'logged-in':'failed';});</script>`);
      await page.goto(origin+'/.test-dist/cookie-login.html');
      const helper = await targetClient(httpOrigin,(await browserSocket.send('Target.getTargets')).targetInfos.find(t=>t.url===origin+'/.test-dist/cookie-login.html').targetId);
      await helper.fill('#email',account.email);await helper.fill('#password',password);await helper.click('button');helper.close();
      await page.waitForFunction(()=>document.querySelector('#result')?.textContent==='logged-in');
      await navigate();
      await until(async()=>await popup.evaluate("document.querySelector('#web-login').hidden"),'website Cookie recognized');
    };
    const completeFill = async expected => {
      const start = performance.now();
      await popup.click('[data-command=start]');
      await page.waitForFunction(() => ['completed', 'partial', 'failed'].includes(document.querySelector('#resume-next-launcher').dataset.phase), undefined, 20000);
      await until(async () => await popup.evaluate("['completed','partial','failed'].includes(document.querySelector('#status').dataset.phase)"), 'runner report');
      const result = await page.evaluate(() => ({ phase: document.querySelector('#resume-next-launcher').dataset.phase, records: fixture.education.map(({ id, ...row }) => row), submitted: fixture.submitted }));
      assert.deepEqual(result.records, expected, JSON.stringify({ result, report: await popup.evaluate("document.querySelector('#run-json').value") }));
      assert.notEqual(result.phase, 'failed'); assert.equal(result.submitted, 0);
      await page.evaluate(() => renderEducation());
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('input[name=school]')].map(i => i.value)), expected.map(r => r.school));
      const diagnostic = await popup.evaluate("document.querySelector('#run-json').value");
      assert.ok(!diagnostic.includes('accessToken') && !diagnostic.includes(password));
      assert.ok(!diagnostic.includes(expected[0].school));
      return Math.round(performance.now() - start);
    };
    try {
      await navigate();
      assert.equal(await page.evaluate(() => document.querySelector('#resume-next-launcher').dataset.buildId), built.buildId);
      await popup.click('[data-command=start]');
      await until(async () => /登录领客/.test(await popup.evaluate("document.querySelector('#progress-note').textContent")), 'unauthenticated readiness failure');
      assert.equal(modelCalls.length, 0);
      assert.equal(await page.evaluate(() => fixture.education.length), 1);
      assert.equal(await page.evaluate(() => fixture.education[0].school), '');
      await loginPopup(a);
      // Read from the real isolated content world, not the ordinary web world.
      assert.ok(contentContext, 'Actual content-script execution context required');
      const protectedStorage = await page.cdp.send('Runtime.evaluate', { contextId: contentContext, expression: "chrome.storage.local.get('platformAuth').then(v=>({exposed:!!v.platformAuth}),()=>({denied:true}))", awaitPromise: true, returnByValue: true });
      assert.deepEqual(protectedStorage.result.value, { denied: true });
      const rejectedAuth = await page.cdp.send('Runtime.evaluate', { contextId: contentContext, expression: "chrome.runtime.sendMessage({type:'autofill-auth-status'})", awaitPromise: true, returnByValue: true });
      assert.equal(rejectedAuth.result.value.ok, false);
      await closePopup(); await openPopup();
      await until(async () => await popup.evaluate("document.querySelector('#web-login').hidden"), 'website Cookie on popup reopen');
      const elapsedA = await completeFill(fixtureA);
      assert.ok(modelCalls.length >= 1);
      for (const route of ['/auth/me', '/autofill/v2/readiness', '/autofill/v2/analyze', '/autofill/v2/plan']) assert.ok(requests.includes(route), route);
      assert.ok(!requests.some(path => path.startsWith('/v1/')));
      assert.equal(await popup.evaluate("document.querySelector('#rule-collection').hidden"),false);
      await prisma.session.updateMany({where:{userId:a.id,type:'web'},data:{revokedAt:new Date()}});
      await navigate(); await loginPopup(b);
      const elapsedB = await completeFill(fixtureB);
      assert.equal(await popup.evaluate("document.querySelector('#rule-collection').hidden"),true);
      assert.equal(await popup.evaluate("document.querySelector('#run-json').value"),'');
      await prisma.session.updateMany({ where: { userId: b.id, type: 'web' }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await navigate(); await popup.click('[data-command=start]');
      await until(async () => /登录领客/.test(await popup.evaluate("document.querySelector('#progress-note').textContent")), 'expired website session failure');
      assert.equal(await page.evaluate(() => fixture.education[0].school), '');
      await loginPopup(b); hangModel = true;
      await popup.click('[data-command=start]'); await until(() => modelWaiting, 'model pending');
      await popup.click('[data-command=cancel]'); await until(() => modelClosed, 'model HTTP cancellation');
      await page.waitForFunction(() => document.querySelector('#resume-next-launcher').dataset.phase === 'cancelled');
      assert.equal(await page.evaluate(() => fixture.education[0].school), '');
      assert.equal(await page.evaluate(() => fixture.submitted), 0);
      console.log(JSON.stringify({ buildId: built.buildId, checks: ['real extension load', 'website Cookie login/expiry', 'protected content storage', 'new routes', 'two account isolation', 'two records / eight fields each', 'rerender persistence', 'ordinary/admin debug visibility', 'upstream cancellation', 'no submission'], elapsedMs: { accountA: elapsedA, accountB: elapsedB } }, null, 2));
    } finally { await closePopup(); worker.close(); }
  }, { extensionPath, chromeArgs: ['--enable-unsafe-extension-debugging'] });
} finally {
  if (api?.exitCode === null) { api.kill('SIGTERM'); await Promise.race([once(api, 'exit'), wait(2000)]); if (api.exitCode === null) api.kill('SIGKILL'); }
  await prisma.$disconnect(); await close(model); await rm(extensionPath, { recursive: true, force: true });
}
