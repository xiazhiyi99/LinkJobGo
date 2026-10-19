import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundled = await build({ stdin: { contents: "export { reasonLabel, warningLabel, shellView, launcherBubble } from './src/shell/ui.ts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { reasonLabel, warningLabel, shellView, launcherBubble } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('invalid snapshots show an actionable pause reason in both field details and popup warnings', () => {
  for (const render of [reasonLabel, warningLabel]) {
    assert.match(render('invalid-page-snapshot'), /页面扫描结果无效.*更新扩展.*刷新招聘页面/);
    assert.match(render('invalid-semantic-page'), /页面字段识别结果无效/);
    assert.match(render('invalid-fill-plan'), /填写方案未通过校验/);
    assert.match(render('invalid-plan-input'), /当前区块的扫描数据未通过校验/);
  }
});

test('unknown free-form errors cannot leak page data through pause messages', () => {
  assert.equal(warningLabel('unexpected-private-page-content@example.test'), '请在页面检查此项后再继续');
});

const state = overrides => ({ phase: 'paused', starting: false, readiness: { status: 'ready' }, report: null, ...overrides });
test('invalid plans and changed source identity offer a safe end instead of repeating resume', () => {
  for (const pauseReason of ['invalid-page-snapshot', 'invalid-fill-plan', 'resume-version-changed', 'overwrite-record-order-changed', 'replan-source-changed', 'incomplete-record-save-blocked']) {
    const paused = state({ pauseReason }), view = shellView(paused);
    assert.equal(view.command, 'cancel');
    assert.equal(view.primary, '结束本轮');
    assert.equal(view.status, '需要重新填写');
    assert.match(view.note, /已填内容保留/);
    assert.deepEqual(launcherBubble(paused), { kind: 'status', text: '需重新填写，请点扩展图标', warning: true });
  }
  assert.equal(shellView(state({ phase: 'cancelled' })).command, 'start');
  assert.equal(shellView(state({ phase: 'cancelled' })).primary, '重新扫描填写');
});
test('manual pauses and run timeouts remain resumable regardless of historical warnings', () => {
  for (const pauseReason of ['paused', 'deadline-exceeded', 'no-editable-scope', 'pending-record-mutation-unconfirmed']) {
    const paused = state({ pauseReason, report: { items: [], warnings: ['invalid-fill-plan'], actions: [] } });
    assert.equal(shellView(paused).command, 'resume');
    assert.equal(launcherBubble(paused).kind, 'action');
  }
});
test('waiting on the backend and completion with pending fields are explicit in both surfaces', () => {
  for (const phase of ['analyzing', 'planning']) {
    assert.match(shellView(state({ phase })).status, /等待服务/);
    assert.match(shellView(state({ phase })).note, /超时会提示重试/);
    assert.match(launcherBubble(state({ phase })).text, /等待服务/);
  }
  const done = state({ phase: 'partial' });
  assert.equal(shellView(done).status, '填写完毕，有待填事项');
  assert.equal(launcherBubble(done).text, shellView(done).status);
});
