import test from 'node:test';
import assert from 'node:assert/strict';
import { canChangeUserRole, formatAdminDate, roleChangeExplanation, roleLabel } from '../features/admin/users.ts';

test('admin role controls target other accounts only', () => {
  assert.equal(canChangeUserRole({ id: 'a', role: 'admin' }, { id: 'b' }), true);
  for (const actor of [null, { id: 'a', role: 'user' }, { id: 'a', role: 'operator' }, { id: 'a', role: 'ADMIN' }, { id: 'a', role: 'admin' }]) assert.equal(canChangeUserRole(actor, { id: 'a' }), false);
});
test('role confirmation describes the changed capabilities and registration dates remain real timestamps', () => {
  assert.equal(roleLabel('admin'), '管理员'); assert.equal(roleLabel('user'), '普通用户');
  assert.match(roleChangeExplanation('admin'), /调整其他账号权限/); assert.match(roleChangeExplanation('user'), /个人资料与投递记录保留/);
  assert.equal(formatAdminDate(null), '—'); assert.match(formatAdminDate('2026-10-01T10:30:00Z'), /2026/);
});
