import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { sessionCookieConfig } = createRequire(import.meta.url)('../src/auth/session-cookie.js');
test('session cookie defaults preserve main site; test cookie name and path are independent', () => {
  assert.deepEqual(sessionCookieConfig({}), {name:'lingke_session',path:'/'});
  assert.deepEqual(sessionCookieConfig({SESSION_COOKIE_NAME:'lingke_autofill_test',SESSION_COOKIE_PATH:'/autofill-test'}), {name:'lingke_autofill_test',path:'/autofill-test'});
  for (const input of [{SESSION_COOKIE_NAME:'x; Secure'},{SESSION_COOKIE_PATH:'/; Domain=other'},{SESSION_COOKIE_NAME:'(.*)'},{SESSION_COOKIE_PATH:'//other'}]) assert.throws(()=>sessionCookieConfig(input));
});
