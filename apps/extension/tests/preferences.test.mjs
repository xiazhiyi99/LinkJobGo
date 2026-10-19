import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const bundled = await build({ stdin: { contents: "export * from './src/shell/preferences.ts'; export * from './src/shell/background.ts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node', define: { __PLATFORM_API_ORIGIN__: '"https://linkaigo.com"', __PLATFORM_API_PATH_PREFIX__: '"/api"', __PLATFORM_LOGIN_URL__: '"https://linkaigo.com/login"', __PLATFORM_DEVELOPMENT__: 'false' } });
const { createUiPreferences, normalizeUiPreferences, isPreferenceUpdate, UI_PREFERENCES_KEY, createBackground } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
function fixture() {
  const data = {}, sent = [];
  const api = { runtime: { id: 'extension' }, storage: { local: { async setAccessLevel() {}, async get(key) { return { [key]: data[key] }; }, async set(value) { Object.assign(data, value); } } }, tabs: { async query() { return [{ id: 1 }, { id: 2 }, {}]; }, async sendMessage(id, message) { sent.push({ id, message }); if (id === 2) throw new Error('restricted page'); } } };
  return { api, data, sent };
}
test('floating island defaults to enabled and accepts only a boolean stored choice', () => {
  for (const value of [undefined, null, false, { launcherEnabled: 'false' }, {}]) assert.deepEqual(normalizeUiPreferences(value), { launcherEnabled: true });
  assert.deepEqual(normalizeUiPreferences({ launcherEnabled: false, token: 'never forwarded' }), { launcherEnabled: false });
});
test('preference survives service recreation and broadcasts despite a restricted tab', async () => {
  const f = fixture(), preferences = createUiPreferences(f.api);
  await preferences.set(false);
  assert.deepEqual(await createUiPreferences(f.api).get(), { launcherEnabled: false });
  assert.deepEqual(Object.keys(f.data), [UI_PREFERENCES_KEY]);
  assert.deepEqual(f.sent.map(value => value.id), [1, 2]);
  assert.ok(f.sent.every(value => value.message.preferences.launcherEnabled === false));
  await preferences.set(true);
  assert.deepEqual(await preferences.get(), { launcherEnabled: true });
});
test('concurrent preference saves keep their order', async () => {
  const f = fixture(), preferences = createUiPreferences(f.api);
  await Promise.all([preferences.set(false), preferences.set(true), preferences.set(false)]);
  assert.equal((await preferences.get()).launcherEnabled, false);
  assert.deepEqual(f.sent.filter(value => value.id === 1).map(value => value.message.preferences.launcherEnabled), [false, true, false]);
});
test('only the popup can save; content can read without authentication or backend calls', async () => {
  const f = fixture(), handler = createBackground(f.api, { apiOrigin: 'https://linkaigo.com', apiPathPrefix: '/api' });
  const popup = { id: 'extension', url: 'chrome-extension://extension/popup.html' };
  const content = { id: 'extension', tab: { id: 1 }, frameId: 0, documentId: 'doc', url: 'https://jobs.example.test/apply' };
  assert.equal((await handler({ type: 'autofill-ui-preferences-set', launcherEnabled: false }, content)).ok, false);
  assert.equal((await handler({ type: 'autofill-ui-preferences-set', launcherEnabled: 'false' }, popup)).ok, false);
  assert.deepEqual(await handler({ type: 'autofill-ui-preferences-set', launcherEnabled: false }, popup), { ok: true, preferences: { launcherEnabled: false } });
  assert.deepEqual(await handler({ type: 'autofill-ui-preferences-get' }, content), { ok: true, preferences: { launcherEnabled: false } });
  assert.equal((await handler({ type: 'autofill-ui-preferences-get' }, { ...content, id: 'another-extension' })).ok, false);
});
test('page scripts and popup messages cannot impersonate a background preference update', () => {
  const message = { type: 'autofill-ui-preferences-changed', preferences: { launcherEnabled: false } };
  assert.equal(isPreferenceUpdate(message, { id: 'extension', url: 'chrome-extension://extension/background.js' }, 'extension'), true);
  for (const sender of [{ id: 'other' }, { id: 'extension', tab: { id: 1 } }, { id: 'extension', url: 'chrome-extension://extension/popup.html' }, { id: 'extension', url: 'https://jobs.example.test' }]) assert.equal(isPreferenceUpdate(message, sender, 'extension'), false);
});
test('all manifest and toolbar icons are real transparent PNGs at the declared sizes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
  for (const size of [16, 32, 48, 128]) {
    const bytes = await readFile(new URL('../src/shell/' + manifest.icons[size], import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
    assert.equal(bytes[25], 6, 'RGBA alpha is preserved');
  }
});
