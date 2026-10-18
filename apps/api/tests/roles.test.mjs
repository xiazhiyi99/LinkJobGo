import test from 'node:test';
import assert from 'node:assert/strict';
import { accountRole, accountCapabilities } from '../src/auth/roles.js';
test('only explicit admin accounts have extension debug permissions', () => {
  assert.equal(accountRole({role:'admin'}), 'admin');
  assert.deepEqual(accountCapabilities({role:'admin'}), {extensionDebug:true});
  for (const user of [undefined, {}, {role:'user'}, {role:'operator'}, {role:'ADMIN'}, {role:'unknown'}]) {
    assert.equal(accountRole(user), 'user');
    assert.deepEqual(accountCapabilities(user), {extensionDebug:false});
  }
});
