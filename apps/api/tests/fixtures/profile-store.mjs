import assert from 'node:assert/strict';

export const userA = { id: 'fixture-user-a', email: 'fixture-a@example.test' };
export const userB = { id: 'fixture-user-b', email: 'fixture-b@example.test' };
export const fixedDate = '2026-10-17T12:00:00.000Z';

export function createProfileStore() {
  const row = (id, fields = {}, extra = {}) => ({
    id, userId: userA.id, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: null, ...fields, extra,
  });
  const rows = {
    profile: [row('profile-a', { name: '合成候选人甲', city: '北京', birthday: null }, { research: ['甲', '乙'], score: 0 })],
    jobPreference: [row('preference-a', { targetCities: '北京,上海', availableFrom: null }, { customPreference: false })],
    education: [
      row('education-new', { school: '示例大学乙', degree: '硕士', current: true, createdAt: '2026-02-01T00:00:00.000Z' }),
      row('education-old', { school: '示例大学甲', degree: '本科', current: false, startDate: '2020-09', endDate: null },
        { score: 0, nested: { userId: 'removed', kept: ['甲', { id: 'removed', valid: false }] } }),
      row('education-deleted', { school: '已删除', deletedAt: '2026-02-02T00:00:00.000Z' }),
      row('education-user-b', { userId: userB.id, school: '示例大学丙', current: false }),
    ],
    experience: [
      row('experience-work', { company: '示例公司', title: '开发', current: false }, { department: '研发', profileSection: '工作/实习经历' }),
      row('experience-campus', { title: '社团成员', current: false }, { profileSection: '在校经历' }),
    ],
    project: [
      row('project-a', { name: '示例项目' }),
      row('award-a', { name: '示例奖项', startDate: '2024' }, { profileSection: '获奖经历' }),
      row('publication-a', { name: '示例论文', role: '第一作者' }, { profileSection: '论文与专利' }),
    ],
    skill: [
      row('skill-a', { name: 'TypeScript' }),
      row('language-a', { name: '英语', level: null }, { profileSection: '语言能力' }),
      row('certificate-a', { name: '示例证书' }, { profileSection: '证书信息' }),
    ],
  };
  const calls = [];
  const prisma = Object.fromEntries(Object.entries(rows).map(([name, records]) => [name, {
    async findUnique({ where }) {
      assert.deepEqual(Object.keys(where), ['userId']);
      assert.ok([userA.id, userB.id].includes(where.userId));
      calls.push({ name, userId: where.userId });
      return structuredClone(records.find(record => record.userId === where.userId) ?? null);
    },
    async findMany({ where, orderBy }) {
      assert.deepEqual(Object.keys(where).sort(), ['deletedAt', 'userId']);
      assert.equal(where.deletedAt, null);
      assert.deepEqual(orderBy, { createdAt: 'asc' });
      assert.ok([userA.id, userB.id].includes(where.userId));
      calls.push({ name, userId: where.userId });
      return structuredClone(records.filter(record => record.userId === where.userId && record.deletedAt === null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    },
  }]));
  return { prisma, rows, calls };
}
