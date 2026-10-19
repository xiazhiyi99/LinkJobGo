import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundled = await build({ stdin: { contents: "export { reasonLabel, warningLabel } from './src/shell/ui.ts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { reasonLabel, warningLabel } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

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
