import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResumeImportService, normalizePayload, collectRecords, toDatabaseRows, idempotencyKey } from '../src/profile/resume-import.js';

const fakePrisma = () => {
  const state = { imports: [], profiles: [], preferences: [], educations: [], experiences: [], projects: [], skills: [] };
  let sequence = 0;
  const model = (name) => ({
    async create({ data }) { const row = { id: `${name}-${++sequence}`, ...data }; state[name].push(row); return row; },
    async upsert({ where: { userId }, create, update }) {
      const current = state[name].find((row) => row.userId === userId);
      if (current) { Object.assign(current, update); return current; }
      const row = { id: `${name}-${++sequence}`, ...create }; state[name].push(row); return row;
    },
  });
  const prisma = {
    state,
    resumeImport: {
      async findUnique({ where: { userId_idempotencyKey: key } }) { return state.imports.find((row) => row.userId === key.userId && row.idempotencyKey === key.idempotencyKey) || null; },
      async create({ data }) { const row = { id: `import-${++sequence}`, ...data }; state.imports.push(row); return row; },
      async update({ where: { id }, data }) { const row = state.imports.find((item) => item.id === id); Object.assign(row, data); return row; },
    },
    profile: { async findUnique({ where: { userId } }) { return state.profiles.find((row) => row.userId === userId) || null; } },
    jobPreference: { async findUnique({ where: { userId } }) { return state.preferences.find((row) => row.userId === userId) || null; } },
    $transaction: async (callback) => callback({ profile: model('profiles'), jobPreference: model('preferences'), education: model('educations'), experience: model('experiences'), project: model('projects'), skill: model('skills'), resumeImport: prisma.resumeImport }),
  };
  return prisma;
};

test('resume import returns conflicts before writing and then replaces single values', async () => {
  const prisma = fakePrisma();
  prisma.state.profiles.push({ id: 'profile-1', userId: 'u1', name: '旧姓名' });
  const service = createResumeImportService({ prisma });
  const payload = { profile: { name: '新姓名', phone: '13800000000' }, records: { 教育经历: [{ school: '测试大学' }], 项目经历: [{ name: '测试项目' }] } };
  await assert.rejects(() => service.import({ userId: 'u1', payload, providedKey: 'k1' }), (error) => error.code === 'PROFILE_IMPORT_CONFLICT' && error.result.conflicts[0].path === 'profile.name');
  assert.equal(prisma.state.educations.length, 1);
  const result = await service.import({ userId: 'u1', payload, providedKey: 'k1', resolutions: { 'profile.name': 'replace' } });
  assert.equal(result.ok, true);
  assert.equal(prisma.state.profiles[0].name, '新姓名');
  assert.equal(prisma.state.educations.length, 1);
  assert.equal(prisma.state.projects.length, 1);
  const repeat = await service.import({ userId: 'u1', payload, providedKey: 'k1', resolutions: { 'profile.name': 'replace' } });
  assert.equal(repeat.idempotent, true);
  assert.equal(prisma.state.educations.length, 1);
});

test('repeatable records are appended for different import keys', async () => {
  const prisma = fakePrisma();
  const service = createResumeImportService({ prisma });
  const payload = { profile: {}, preferences: {}, records: { skills: [{ name: 'TypeScript' }] } };
  await service.import({ userId: 'u2', payload, providedKey: 'a' });
  await service.import({ userId: 'u2', payload, providedKey: 'b' });
  assert.equal(prisma.state.skills.length, 2);
});

test('normalizes nested education honors into append-only award records', () => {
  const payload = normalizePayload({
    educations: [{ school: '中国科学院大学', university: '重复学校', degree: '直博生', honors: [
      '三好学生标兵', { awardName: '优秀共产党员', sourcePages: [1] },
    ] }],
  });
  const grouped = collectRecords(payload.records);
  assert.equal(grouped.educations.length, 1);
  assert.equal(grouped.educations[0].row.school, '中国科学院大学');
  assert.equal(grouped.projects.length, 2);
  assert.equal(grouped.projects[0].section, '获奖经历');
  assert.equal(grouped.projects[0].row.name, '三好学生标兵');
  assert.equal(grouped.projects[0].row.relatedEducation, '中国科学院大学');
  assert.equal(grouped.projects[1].row.name, '优秀共产党员');
  assert.equal(grouped.projects[1].row.sourcePath, 'records.educations[0].honors[1]');
});

test('normalizes section and field aliases while retaining unknown fields as extra data', () => {
  const payload = normalizePayload({ records: {
    '工作经历': [{ organization: '测试公司', position: '工程师', location: '上海', detail: '负责平台开发' }],
    languages: [{ language: '英语', proficiency: '熟练' }],
    certificates: [{ certificate: 'CET-6', organization: '教育部' }],
  } });
  const grouped = collectRecords(payload.records);
  assert.equal(grouped.experiences[0].row.company, '测试公司');
  assert.equal(grouped.experiences[0].row.title, '工程师');
  assert.equal(grouped.experiences[0].row.description, '负责平台开发');
  assert.equal(grouped.skills.length, 2);
  assert.equal(grouped.skills[0].row.name, '英语');
  assert.equal(grouped.skills[1].row.certificate, 'CET-6');
  assert.equal(grouped.skills[1].row.issuer, '教育部');
});

test('canonical education, project, language and patent records reach their database collections', () => {
  const payload = normalizePayload({ records: {
    educations: [{ school: '测试大学', major: '人工智能' }],
    projects: [{ name: '测试项目', role: '负责人' }],
    languages: [{ name: '英语', level: '商务会话' }],
    patents: [{ name: '测试专利', publicationNumber: 'CN1' }],
  } });
  const rows = toDatabaseRows(payload);
  assert.equal(rows.educations.length, 1);
  assert.equal(rows.educations[0].school, '测试大学');
  assert.equal(rows.projects.length, 2);
  assert.equal(rows.projects.some((row) => row.name === '测试专利' && row.extra.profileSection === '论文与专利'), true);
  assert.equal(rows.skills.length, 1);
  assert.equal(rows.skills[0].name, '英语');
  assert.equal(rows.skills[0].extra.profileSection, '语言能力');
});

test('normalized payload changes produce a new import key when recovered sections appear', () => {
  const first = normalizePayload({ records: { projects: [{ name: '已有项目' }] } });
  const recovered = normalizePayload({ records: {
    projects: [{ name: '已有项目' }],
    educations: [{ school: '补充学校' }],
    languages: [{ name: '英语', level: '熟练' }],
  } });
  assert.notEqual(idempotencyKey(first), idempotencyKey(recovered));
});

test('expands grouped skills into one database row per skill', () => {
  const payload = normalizePayload({ records: { skills: [{ category: '工程能力', items: ['Python', 'PyTorch'] }] } });
  const grouped = collectRecords(payload.records);
  assert.deepEqual(grouped.skills.map(({ row }) => row.name), ['Python', 'PyTorch']);
  assert.equal(grouped.skills[0].row.category, '工程能力');
});

test('nested records are idempotent and preserve campus labels and source paths', () => {
  const once = normalizePayload({ records: {
    educations: [{ school: '测试大学', honors: [{ name: '奖项 A', sourcePath: 'resume.page.1' }] }],
    campusExperiences: [{ title: '社团负责人', sourcePath: 'resume.page.2', evidence: { page: 2 } }],
  } });
  const twice = normalizePayload(once);
  assert.deepEqual(twice.records, once.records);
  const grouped = collectRecords(twice.records);
  assert.equal(grouped.experiences[0].section, '在校经历');
  assert.equal(grouped.experiences[0].row.sourcePath, 'resume.page.2');
  assert.deepEqual(grouped.experiences[0].row.evidence, { page: 2 });
});

test('projection is the same shape used for persisted rows and strips system keys', async () => {
  const payload = { profile: { name: '新用户', email: 'user@example.com', id: 'attacker', extra: { userId: 'bad', note: '保留' } }, records: {
    campusExperiences: [{ title: '志愿者', sourcePath: 'p3', id: 'bad-id', extra: { userId: 'bad', evidence: '照片' } }],
  } };
  const projection = toDatabaseRows(payload);
  assert.equal(projection.profile.id, undefined);
  assert.deepEqual(projection.profile.extra, { note: '保留', resumeEmail: 'user@example.com' });
  assert.equal(projection.experiences[0].extra.id, undefined);
  assert.equal(projection.experiences[0].extra.userId, undefined);
  assert.equal(projection.experiences[0].extra.profileSection, '在校经历');
  const prisma = fakePrisma();
  const service = createResumeImportService({ prisma });
  await service.import({ userId: 'projection-user', payload, providedKey: 'projection-key' });
  const written = prisma.state.experiences[0];
  const comparable = ({ id, userId, ...row }) => row;
  assert.deepEqual(comparable(written), projection.experiences[0]);
});

test('profile extra conflicts support keep and replace without system-key writes', async () => {
  const prisma = fakePrisma();
  prisma.state.profiles.push({ id: 'profile-1', userId: 'u-extra', name: '已有', extra: { note: '旧', stable: 'keep' } });
  const service = createResumeImportService({ prisma });
  const payload = { profile: { name: '已有', extra: { note: '新', userId: 'attacker', fresh: '值' } } };
  await assert.rejects(() => service.import({ userId: 'u-extra', payload, providedKey: 'extra-key' }), (error) => error.code === 'PROFILE_IMPORT_CONFLICT' && error.result.conflicts.some((item) => item.path === 'profile.extra.note'));
  assert.deepEqual(prisma.state.profiles[0].extra, { note: '旧', stable: 'keep', fresh: '值' });
  const replaced = await service.import({ userId: 'u-extra', payload, providedKey: 'extra-key', resolutions: { 'profile.extra.note': 'keep' } });
  assert.equal(replaced.ok, true);
  assert.deepEqual(prisma.state.profiles[0].extra, { note: '旧', stable: 'keep', fresh: '值' });
  const replacePayload = { profile: { name: '已有', extra: { note: '替换', fresh: '二次' } } };
  await service.import({ userId: 'u-extra', payload: replacePayload, providedKey: 'extra-replace', resolutions: { 'profile.extra.note': 'replace', 'profile.extra.fresh': 'replace' } });
  assert.deepEqual(prisma.state.profiles[0].extra, { note: '替换', stable: 'keep', fresh: '二次' });
});
