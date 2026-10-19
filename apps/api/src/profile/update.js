const { profileFields, preferenceFields, modelFields, expandRecord } = require('./service');

const sections = {
  教育经历: 'educations', '工作/实习经历': 'experiences', 在校经历: 'experiences',
  项目经历: 'projects', 获奖经历: 'projects', '论文与专利': 'projects',
  技能: 'skills', 语言能力: 'skills', 证书信息: 'skills',
};
const defaults = { educations: '教育经历', experiences: '工作/实习经历', projects: '项目经历', skills: '技能' };
const systemKeys = new Set(['id', 'userId', 'createdAt', 'updatedAt', 'deletedAt', '__proto__', 'constructor', 'prototype']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = (message, status = 400) => Object.assign(new Error(message), { status, code: 'INVALID_PROFILE_UPDATE' });
const sectionOf = (row, collection) => row.extra?.profileSection
  || (collection === 'skills' && ({ language: '语言能力', certificate: '证书信息' })[row.extra?.kind])
  || defaults[collection];
const draftId = id => /^\d{13}-[a-f\d]+$/.test(id) || /^server-[a-f\d]+$/.test(id);

// Omitted sections are untouched; an explicit [] removes only that section.
// Existing records must belong to this account AND section before any writes.
const createProfileUpdater = ({ prisma, splitData }) => {
  const project = (input, fields, existing) => {
    if (!object(input)) throw invalid('资料必须是对象');
    if (Object.hasOwn(input, 'extra') && !object(input.extra)) throw invalid('extra 必须是对象');
    const values = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'extra' && !systemKeys.has(key)));
    const data = splitData(values, fields);
    const incomingExtra = { ...(input.extra || {}), ...(data.extra || {}) };
    if (Object.keys(incomingExtra).length) {
      data.extra = { ...(existing?.extra || {}), ...Object.fromEntries(Object.entries(incomingExtra).filter(([key]) => !systemKeys.has(key))) };
    }
    return data;
  };

  async function update(user, input, { preferencesOnly = false } = {}) {
    if (!user?.id) throw invalid('未登录', 401);
    if (!object(input)) throw invalid('资料必须是对象');
    const profileInput = preferencesOnly ? undefined : Object.hasOwn(input, 'profile') ? input.profile
      : Object.fromEntries(Object.entries(input).filter(([key]) => !['records', 'preferences'].includes(key)));
    const preferenceInput = preferencesOnly ? input : input.preferences;
    const records = preferencesOnly ? undefined : input.records;
    if (records !== undefined && !object(records)) throw invalid('records 必须是对象');
    if (profileInput !== undefined && !object(profileInput)) throw invalid('profile 必须是对象');
    if (preferenceInput !== undefined && !object(preferenceInput)) throw invalid('preferences 必须是对象');

    return prisma.$transaction(async tx => {
      const plans = [];
      const loaded = new Map();
      const ids = new Set();
      for (const [section, items] of Object.entries(records || {})) {
        if (!Object.hasOwn(sections, section) || !Array.isArray(items)) throw invalid('经历分区或记录格式无效');
        const collection = sections[section], definition = modelFields[collection], model = tx[definition.model];
        if (!loaded.has(collection)) loaded.set(collection, await model.findMany({ where: { userId: user.id, deletedAt: null } }));
        const existing = loaded.get(collection).filter(row => sectionOf(row, collection) === section);
        const byId = new Map(existing.map(row => [row.id, row]));
        const entries = items.map(item => {
          if (!object(item) || (item.id !== undefined && typeof item.id !== 'string')) throw invalid('经历格式无效');
          const id = item.id || '';
          if (id && ids.has(id)) throw invalid('经历 ID 重复');
          if (id) ids.add(id);
          const current = byId.get(id);
          if (id && !current && !draftId(id)) throw invalid('经历已变化或不存在，请刷新后重试', 409);
          const data = project(item, definition.fields, current);
          if (!current) data.extra = { ...(data.extra || {}), profileSection: section };
          else if (data.extra) data.extra.profileSection = current.extra?.profileSection || section;
          return { current, data };
        });
        plans.push({ section, model, existing, entries });
      }

      const output = {};
      for (const [key, body, fields, model] of [
        ['profile', profileInput, profileFields, tx.profile],
        ['preferences', preferenceInput, preferenceFields, tx.jobPreference],
      ]) {
        if (!body || !Object.keys(body).length) continue;
        const where = { userId: user.id };
        const current = await model.findUnique({ where });
        const data = project(body, fields, current);
        if (Object.keys(data).length) output[key] = expandRecord(await model.upsert({ where, create: { ...where, ...data }, update: data }));
      }
      if (records !== undefined) output.records = {};
      for (const { section, model, existing, entries } of plans) {
        const retained = new Set(entries.filter(entry => entry.current).map(entry => entry.current.id));
        const removed = existing.filter(row => !retained.has(row.id)).map(row => row.id);
        if (removed.length) await model.updateMany({ where: { userId: user.id, id: { in: removed }, deletedAt: null }, data: { deletedAt: new Date() } });
        output.records[section] = [];
        for (const { current, data } of entries) {
          let row = current;
          if (!current) row = await model.create({ data: { ...data, userId: user.id } });
          else if (Object.keys(data).length) {
            const result = await model.updateMany({ where: { userId: user.id, id: current.id, deletedAt: null }, data });
            if (!result.count) throw invalid('经历已变化，请刷新后重试', 409);
            row = { ...current, ...data };
          }
          output.records[section].push(expandRecord(row));
        }
      }
      return output;
    });
  }
  return { update };
};

module.exports = { createProfileUpdater };
