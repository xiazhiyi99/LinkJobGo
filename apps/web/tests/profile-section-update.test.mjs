import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSectionUpdate, skillRecords } from '../features/profile/profile-section-update.ts';

test('basic edits send only changed fields, never records, preferences, or read-only email', () => {
  const section = { title: '基本信息', kind: 'single', fields: [{ key: 'wechat' }, { key: 'name' }, { key: 'email', readOnly: true }, { key: 'homeCity' }] };
  const before = { wechat: 'old', name: '姓名', email: 'a@example.test', homeCity: '上海' };
  assert.deepEqual(profileSectionUpdate(section, { ...before, wechat: 'new', email: 'b@example.test' }, before, [], []), { profile: { wechat: 'new' } });
  assert.deepEqual(profileSectionUpdate(section, { ...before, homeCity: '' }, before, [], []), { profile: { city: '' } });
  assert.deepEqual(profileSectionUpdate(section, before, before, [], []), { profile: {} });
});

test('preference and introduction saves cannot clear other sections', () => {
  const before = { targetCities: '北京', preferenceNote: '保留意向备注', selfIntroduction: '描述' };
  assert.deepEqual(profileSectionUpdate({ title: '求职意向', kind: 'single', fields: [{ key: 'targetCities' }, { key: 'preferenceNote' }] }, { ...before, targetCities: '上海' }, before, [], []), { preferences: { targetCities: '上海' } });
  assert.deepEqual(profileSectionUpdate({ title: '自我介绍', kind: 'single', fields: [{ key: 'selfIntroduction' }] }, { ...before, selfIntroduction: '' }, before, [], []), { profile: { selfIntroduction: '' } });
});

test('record updates retain existing IDs and omit server metadata and unrelated fields', () => {
  const section = { title: '教育经历', kind: 'repeat', fields: [{ key: 'school' }, { key: 'major' }] };
  const before = [{ id: 'education-a', school: '原学校', major: '专业', extra: '[object Object]', nested: '[object Object]', userId: 'owner' }];
  const records = [{ ...before[0], school: '新学校' }, { id: 'temporary-ui-id', school: '新增学校', major: '专业乙' }];
  assert.deepEqual(profileSectionUpdate(section, {}, {}, records, before), { records: { 教育经历: [{ id: 'education-a', school: '新学校' }, { school: '新增学校', major: '专业乙' }] } });
  assert.deepEqual(profileSectionUpdate(section, {}, {}, [], before), { records: { 教育经历: [] } });
});

test('skills without kind and non-language custom kinds remain visible without adding metadata', () => {
  const items = [{ id: 'a', name: 'TypeScript' }, { id: 'b', name: 'Python', kind: 'skill' }, { id: 'c', kind: 'language' }, { id: 'd', kind: 'certificate' }, { id: 'e', kind: 'programming' }];
  assert.deepEqual(skillRecords(items).map(item => item.id), ['a', 'b', 'e']);
  assert.equal(Object.hasOwn(items[0], 'kind'), false);
});
