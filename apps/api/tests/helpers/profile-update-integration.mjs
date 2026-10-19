import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkProfileUpdates(request, foreignEducationId) {
  const credentials = { email: `profile-update-${randomUUID()}@example.test`, password: 'profile-test-password', passwordConfirmation: 'profile-test-password' };
  const post = body => ({ method: 'POST', body: JSON.stringify(body) });
  assert.equal((await request('/auth/register', post(credentials))).response.status, 201);
  const login = await request('/auth/login', post(credentials));
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const read = async () => (await request('/profiles/me', {}, cookie)).payload;
  const patch = body => request('/profiles/me', { method: 'PATCH', body: JSON.stringify(body) }, cookie);
  const context = async () => (await request('/profiles/me/autofill-context', {}, cookie)).payload;
  const sections = {
    教育经历: [{ school: '学校甲', degree: '硕士', startDate: '2022-09', custom: { score: 0, enabled: false } }, { school: '学校乙' }],
    '工作/实习经历': [{ company: '公司', department: '研发' }], 在校经历: [{ title: '负责人' }],
    项目经历: [{ name: '项目' }], 获奖经历: [{ name: '奖项' }], '论文与专利': [{ name: '论文' }],
    技能: [{ name: 'TypeScript' }, { name: 'Python', kind: 'skill' }],
    语言能力: [{ name: '英语', kind: 'language' }], 证书信息: [{ name: '证书', kind: 'certificate' }],
  };
  const seed = await patch({ profile: { name: '测试姓名', wechat: 'before', address: '保留地址', interests: '阅读', homepage: { avatarUrl: 'data:image/webp;base64,UklGRg==', headline: '主页签名' }, untouched: { list: [0, false, '原值'] } }, preferences: { targetCities: '上海', preferenceNote: '不应清空', customPreference: { keep: true } }, records: sections });
  assert.equal(seed.response.status, 200);
  const before = await read();
  assert.equal((await context()).records.length, 11);
  const collections = ['educations', 'experiences', 'campusExperiences', 'projects', 'awards', 'publications', 'skills', 'languages', 'certificates'];
  const sameRecords = (a, b) => { for (const key of collections) assert.deepEqual(a[key], b[key], key); };

  assert.equal((await patch({ profile: { wechat: 'after' } })).response.status, 200);
  let after = await read();
  sameRecords(after, before);
  assert.deepEqual(after.preferences, before.preferences);
  assert.deepEqual(after.profile.extra, before.profile.extra);
  for (const key of Object.keys(before.profile).filter(key => !['wechat', 'updatedAt'].includes(key))) assert.deepEqual(after.profile[key], before.profile[key], key);
  assert.equal(after.profile.wechat, 'after');

  const [first, second] = before.educations;
  const stableVersion = (await context()).profileVersion;
  assert.equal((await patch({ records: { 教育经历: [{ id: first.id }, { id: second.id }] } })).response.status, 200);
  assert.equal((await context()).profileVersion, stableVersion);
  sameRecords(await read(), after);
  const edited = await patch({ records: { 教育经历: [{ id: first.id, school: '修改后的学校' }, { id: second.id }] } });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.payload.records.教育经历[0].id, first.id);
  after = await read();
  assert.equal(after.educations[0].school, '修改后的学校');
  assert.deepEqual(after.educations[0].extra, first.extra);
  assert.deepEqual(after.educations[1], second);
  for (const key of collections.filter(key => key !== 'educations')) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(after.preferences, before.preferences);

  const snapshot = await read();
  for (const records of [
    { 教育经历: [{ id: foreignEducationId }] },
    { 项目经历: [{ id: snapshot.awards[0].id }] },
    { 教育经历: [{ id: first.id }, { id: first.id }] },
    { 教育经历: null }, { 未知分区: [] },
  ]) {
    const rejected = await patch({ profile: { wechat: 'must-rollback' }, records });
    assert.ok([400, 409].includes(rejected.response.status));
    assert.deepEqual(await read(), snapshot, 'invalid record request must roll back all profile changes');
  }

  assert.equal((await patch({ records: { 语言能力: [] } })).response.status, 200);
  after = await read();
  assert.deepEqual(after.skills, snapshot.skills);
  assert.deepEqual(after.certificates, snapshot.certificates);
  assert.equal(after.languages.length, 0);
  assert.equal((await request(`/profiles/me/skills/${snapshot.languages[0].id}/restore`, post({}), cookie)).response.status, 200);

  const added = await patch({ records: { 教育经历: [{ id: first.id }, { id: second.id }, { school: '新增学校' }] } });
  assert.equal(added.response.status, 200);
  const savedItems = added.payload.records.教育经历;
  assert.equal(savedItems.length, 3); assert.ok(savedItems[2].id);
  assert.equal((await patch({ records: { 教育经历: savedItems.map(row => ({ id: row.id })) } })).response.status, 200);
  assert.equal((await read()).educations.length, 3);
  assert.equal((await patch({ records: { 教育经历: [{ id: first.id }, { id: second.id }] } })).response.status, 200);
  after = await read(); assert.deepEqual(after.educations.map(row => row.id), [first.id, second.id]);
  assert.equal((await context()).records.length, 11);
  assert.deepEqual(after.profile.homepage, before.profile.homepage);
  assert.deepEqual(after.preferences, before.preferences);
  console.log('Profile update regression passed: scoped saves, stable IDs, metadata, shared collections, rollback, ownership and no duplicates');
}
