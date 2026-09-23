const crypto = require('node:crypto');

const PROFILE_FIELDS = ['name', 'avatarUrl', 'phone', 'city', 'personalWebsite', 'githubUrl', 'portfolioUrl', 'gender', 'birthday', 'homeCity', 'homeDistrict', 'schoolCity', 'address', 'politicalStatus', 'nationality', 'citizenship', 'wechat', 'nativePlace', 'highestEducation', 'firstWorkYear', 'fullTimeStudent', 'hasRelativesInCompany', 'recommendationMethod', 'workVisaRequired', 'workExperience', 'interests', 'selfIntroduction'];
const PREFERENCE_FIELDS = ['targetTitles', 'targetCities', 'employmentType', 'targetIndustries', 'availableFrom', 'salaryExpectation', 'relocation', 'preferenceNote'];
const COLLECTIONS = {
  educations: { model: 'education', fields: ['school', 'degree', 'major', 'startDate', 'endDate', 'current', 'gpa', 'courses'] },
  experiences: { model: 'experience', fields: ['company', 'title', 'city', 'startDate', 'endDate', 'current', 'description'] },
  projects: { model: 'project', fields: ['name', 'role', 'startDate', 'endDate', 'url', 'description'] },
  skills: { model: 'skill', fields: ['name', 'level', 'certificate', 'issuer', 'obtainedAt'] },
};
// Model output is intentionally allowed to be a little loose.  This layer
// turns aliases and nested sections into the small, stable shape consumed by
// the database importer.  It is deliberately deterministic: AI never gets to
// choose a Prisma model or a database field.
const KEY = (value) => String(value || '').trim().toLowerCase().replace(/[\s_\-/]+/g, '');
const SECTION_ALIASES = {
  educations: 'educations', education: 'educations', educationhistory: 'educations', 教育经历: 'educations', 教育背景: 'educations', 教育: 'educations',
  experiences: 'experiences', experience: 'experiences', workexperience: 'experiences', 工作经历: 'experiences', '工作/实习经历': 'experiences', 实习经历: 'experiences', 在校经历: 'campusExperiences', campus: 'campusExperiences', campusexperiences: 'campusExperiences',
  projects: 'projects', project: 'projects', projectexperience: 'projects', 项目经历: 'projects',
  awards: 'awards', award: 'awards', honors: 'awards', honor: 'awards', 获奖经历: 'awards', 荣誉: 'awards', 奖项: 'awards',
  publications: 'publications', publication: 'publications', papers: 'publications', patents: 'publications', patent: 'publications', 论文与专利: 'publications', 论文: 'publications', 专利: 'publications',
  skills: 'skills', skill: 'skills', 技能: 'skills', 技能与证书: 'skills',
  languages: 'languages', language: 'languages', 语言能力: 'languages', 语言: 'languages',
  certificates: 'certificates', certificate: 'certificates', 证书信息: 'certificates', 证书: 'certificates',
};
const SECTION_ALIAS_MAP = Object.entries(SECTION_ALIASES).reduce((map, [alias, canonical]) => { map[KEY(alias)] = canonical; return map; }, Object.create(null));
const FIELD_ALIASES = {
  school: ['school', 'university', 'institution', '学校', '院校'], college: ['college', 'faculty', 'department', '学院', '院系'],
  major: ['major', 'fieldofstudy', 'specialty', '专业', '研究方向'], degree: ['degree', 'education', '学历', '学位'],
  startDate: ['startdate', 'from', 'begin', 'begindate', '入学时间', '开始时间'], endDate: ['enddate', 'to', 'until', 'graduationdate', '毕业时间', '结束时间'],
  current: ['current', 'present', 'isenrolled', '在读', '在职'], gpa: ['gpa', '成绩', '绩点'], courses: ['courses', 'coursework', '主修课程'],
  company: ['company', 'employer', 'organization', '公司', '单位'], title: ['title', 'position', 'role', 'jobtitle', '职位', '岗位'],
  city: ['city', 'location', '地点', '城市'], description: ['description', 'detail', 'details', 'summary', '工作描述', '项目描述', '描述'],
  name: ['name', 'title', 'projectname', 'skillname', 'awardname', 'honorname', 'award', 'honor', 'prize', '名称', '项目名称', '奖项名称', '证书名称'],
  role: ['role', 'responsibility', '职责', '角色'], url: ['url', 'link', 'website', '项目链接', '链接'],
  level: ['level', 'proficiency', '熟练程度', '水平'], certificate: ['certificate', 'certification', '证书'], issuer: ['issuer', 'organization', '颁发机构'], obtainedAt: ['obtainedat', 'issuedat', 'date', '获得时间'],
};
const FIELD_ALIAS_MAP = Object.entries(FIELD_ALIASES).reduce((map, [canonical, aliases]) => { for (const alias of aliases) map[KEY(alias)] = canonical; return map; }, Object.create(null));
const sectionOf = (value) => SECTION_ALIAS_MAP[KEY(value)] || null;
const unwrap = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : value;
const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const nestedKind = (key) => sectionOf(key);
const SYSTEM_KEYS = new Set(['id', 'userid', 'createdat', 'updatedat', 'deletedat', 'proto', 'prototype', 'constructor']);
const isSystemKey = (key) => SYSTEM_KEYS.has(KEY(key));
const cleanExtra = (value) => {
  if (Array.isArray(value)) return value.map(cleanExtra);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, entry]) => !isSystemKey(key) && entry !== undefined)
    .map(([key, entry]) => [key, cleanExtra(entry)]));
};

const standardizeRow = (source, section, sourcePath, relatedEducation) => {
  if (typeof source === 'string' || typeof source === 'number') return { name: String(source), sourcePath, ...(relatedEducation ? { relatedEducation } : {}) };
  if (!isRecord(source)) return null;
  const row = {};
  for (const [key, value] of Object.entries(source)) {
    if (isSystemKey(key)) continue;
    if (nestedKind(key) && value != null && (Array.isArray(value) || isRecord(value) || ['honor', 'award', 'prize', '荣誉', '奖项'].includes(KEY(key)))) {
      // Keep the original nested value on the parent row as extra metadata;
      // appendNested below also emits normalized child records. This preserves
      // source fidelity without relying on a resume-specific rule.
      row[key] = unwrap(value);
      continue;
    }
    let canonical = FIELD_ALIAS_MAP[KEY(key)];
    // "title" means a job title for work rows, but the name of a project,
    // publication, award or certificate in those sections.
    if (KEY(key) === 'title') canonical = section === 'experiences' || section === 'campusExperiences' ? 'title' : 'name';
    if (KEY(key) === 'role' && ['experiences', 'campusExperiences'].includes(section)) canonical = 'title';
    if (KEY(key) === 'language') canonical = 'name';
    if (KEY(key) === 'organization' && !['certificates', 'languages'].includes(section)) canonical = section === 'experiences' || section === 'campusExperiences' ? 'company' : canonical;
    if (KEY(key) === 'organization' && ['certificates', 'languages'].includes(section)) canonical = 'issuer';
    if (canonical && row[canonical] == null) row[canonical] = unwrap(value);
    else row[key] = unwrap(value);
  }
  if (!row.sourcePath && sourcePath) row.sourcePath = sourcePath;
  if (!row.relatedEducation && relatedEducation) row.relatedEducation = relatedEducation;
  if (section === 'languages' && !row.name && source.language) row.name = unwrap(source.language);
  if (section === 'certificates' && !row.certificate) row.certificate = row.name || unwrap(source.certificate);
  return row;
};

const normalizePayload = (payload = {}) => {
  const profileInput = isRecord(payload.profile) ? payload.profile : isRecord(payload.fields) ? payload.fields : {};
  const preferencesInput = isRecord(payload.preferences) ? payload.preferences : isRecord(payload.jobPreference) ? payload.jobPreference : {};
  const profile = {}; const preferences = {};
  const profileAliases = { fullname: 'name', realname: 'name', 姓名: 'name', phoneNumber: 'phone', 手机号: 'phone', 所在城市: 'city', location: 'city', 地点: 'city', 个人主页: 'personalWebsite', github: 'githubUrl', portfolio: 'portfolioUrl' };
  for (const [key, value] of Object.entries(profileInput)) {
    if (!isSystemKey(key)) profile[Object.hasOwn(profileAliases, key) ? profileAliases[key] : Object.hasOwn(profileAliases, KEY(key)) ? profileAliases[KEY(key)] : key] = unwrap(value);
  }
  const preferenceAliases = { targetjobs: 'targetTitles', targetpositions: 'targetTitles', desiredcities: 'targetCities', desiredcity: 'targetCities', employment: 'employmentType', 工作类型: 'employmentType', 期望职位: 'targetTitles', 期望城市: 'targetCities' };
  for (const [key, value] of Object.entries(preferencesInput)) {
    if (!isSystemKey(key)) preferences[Object.hasOwn(preferenceAliases, key) ? preferenceAliases[key] : Object.hasOwn(preferenceAliases, KEY(key)) ? preferenceAliases[KEY(key)] : key] = unwrap(value);
  }
  const records = { educations: [], experiences: [], projects: [], awards: [], publications: [], campusExperiences: [], skills: [], languages: [], certificates: [] };
  const unmapped = [];
  const sourceRecords = { ...(isRecord(payload.records) ? payload.records : {}) };
  for (const key of Object.keys(SECTION_ALIASES)) {
    if (payload[key] != null && sourceRecords[key] == null) sourceRecords[key] = payload[key];
  }
  const identities = new Map(Object.keys(records).map((section) => [section, new Set()]));
  const append = (section, source, path, relatedEducation) => {
    const row = standardizeRow(source, section, path, relatedEducation);
    if (!row) return;
    const identity = JSON.stringify(stable(row));
    if (identities.get(section).has(identity)) return;
    identities.get(section).add(identity);
    appendNested(source, row.sourcePath || path, section === 'educations' ? row.school : row.relatedEducation);
    records[section].push(row);
  };
  const appendNested = (row, path, relatedEducation) => {
    if (!isRecord(row)) return;
    for (const [key, value] of Object.entries(row)) {
      const nested = nestedKind(key);
      if (!nested || value == null || (!Array.isArray(value) && !isRecord(value) && !['honor', 'award', 'prize', '荣誉', '奖项'].includes(KEY(key)))) continue;
      const children = asArray(value);
      for (let index = 0; index < children.length; index += 1) {
        append(nested, children[index], `${path}.${key}[${index}]`, relatedEducation);
      }
    }
  };
  for (const [rawSection, rawRows] of Object.entries(sourceRecords)) {
    const section = sectionOf(rawSection);
    if (!section) {
      if (rawSection === 'unmapped' && Array.isArray(rawRows)) unmapped.push(...rawRows);
      else if (rawSection === 'unmapped' && rawRows != null) unmapped.push(rawRows);
      else if (rawRows != null) unmapped.push({ sourcePath: `records.${rawSection}`, value: rawRows });
      continue;
    }
    const rows = asArray(rawRows);
    for (let index = 0; index < rows.length; index += 1) {
      const path = `records.${rawSection}[${index}]`;
      append(section, rows[index], path);
    }
  }
  if (Array.isArray(payload.unmapped)) unmapped.push(...payload.unmapped);
  else if (payload.unmapped != null) unmapped.push(payload.unmapped);
  return { profile, preferences, records, unmapped: Array.from(new Map(unmapped.map((entry) => [JSON.stringify(stable(entry)), entry])).values()) };
};

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
};
const idempotencyKey = (payload, provided) => String(provided || crypto.createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex')).slice(0, 200);
const valueOf = (value) => value == null ? '' : String(value).trim();
const incomingValue = (value, field) => field === 'current' ? (value === true || value === 'true' || value === '在读' || value === '在职') : valueOf(value);
const splitRecord = (item, definition, section) => {
  const data = {};
  const extra = cleanExtra(isRecord(item?.extra) ? item.extra : {});
  for (const [key, value] of Object.entries(item || {})) {
    if (definition.fields.includes(key)) data[key] = key === 'current' ? Boolean(incomingValue(value, key)) : valueOf(value) || null;
    else if (key !== 'extra' && !isSystemKey(key) && value !== undefined) extra[key] = cleanExtra(value);
  }
  if (section) extra.profileSection = section;
  if (Object.keys(extra).length) data.extra = extra;
  return data;
};

const inputExtras = (input, fields, { rename = {} } = {}) => {
  const extra = {};
  const candidates = { ...(isRecord(input?.extra) ? input.extra : {}), ...input };
  for (const [key, value] of Object.entries(candidates)) {
    if (fields.includes(key) || key === 'extra' || isSystemKey(key) || value == null || value === '') continue;
    extra[Object.hasOwn(rename, key) ? rename[key] : key] = cleanExtra(value);
  }
  return extra;
};

// This is the single database projection used by both the preview response and
// the importer. Keeping it here prevents the UI preview and the Prisma writes
// from silently drifting apart as the resume schema grows.
const toDatabaseRows = (payload) => {
  const normalized = normalizePayload(payload || {});
  const profile = {};
  for (const field of PROFILE_FIELDS) if (normalized.profile?.[field] != null && valueOf(normalized.profile[field]) !== '') profile[field] = incomingValue(normalized.profile[field], field) || null;
  const profileExtra = inputExtras(normalized.profile, PROFILE_FIELDS, { rename: { email: 'resumeEmail' } });
  if (Object.keys(profileExtra).length) profile.extra = profileExtra;
  const preferences = {};
  for (const field of PREFERENCE_FIELDS) if (normalized.preferences?.[field] != null && valueOf(normalized.preferences[field]) !== '') preferences[field] = incomingValue(normalized.preferences[field], field) || null;
  const preferenceExtra = inputExtras(normalized.preferences, PREFERENCE_FIELDS);
  if (Object.keys(preferenceExtra).length) preferences.extra = preferenceExtra;
  const grouped = collectRecords(normalized.records);
  const rows = { educations: [], experiences: [], projects: [], skills: [] };
  for (const [collection, entries] of Object.entries(grouped)) {
    const definition = COLLECTIONS[collection];
    rows[collection] = entries.map(({ row, section }) => splitRecord(row, definition, section));
  }
  return { profile, preferences, ...rows, unmapped: Array.isArray(normalized.unmapped) ? normalized.unmapped : [] };
};

const collectRecords = (records) => {
  const grouped = { educations: [], experiences: [], projects: [], skills: [] };
  for (const [section, rows] of Object.entries(records || {})) {
    const canonicalSection = sectionOf(section);
    const collection = canonicalSection === 'campusExperiences' ? 'experiences' : ['languages', 'certificates'].includes(canonicalSection) ? 'skills' : ['awards', 'publications'].includes(canonicalSection) ? 'projects' : canonicalSection;
    if (!collection || !grouped[collection] || !Array.isArray(rows)) continue;
    const label = ({ campusExperiences: '在校经历', awards: '获奖经历', publications: '论文与专利', languages: '语言能力', certificates: '证书信息' }[canonicalSection]);
    for (const source of rows) if (source && typeof source === 'object') {
      // VLMs commonly return skills grouped as { category, items: [] } while
      // the Prisma Skill table stores one skill per row. Expand the group
      // deterministically and retain its category in `extra`.
      const skillSources = collection === 'skills' && Array.isArray(source.items)
        ? source.items.map((name) => ({ ...source, name: String(name), items: undefined }))
        : [source];
      for (const skillSource of skillSources) {
        const row = { ...skillSource };
        // AI results use descriptive names for language/certificate entries;
        // normalize them to the Skill table without losing the original data.
        if (collection === 'skills' && !row.name && row.language) row.name = row.language;
        if (collection === 'skills' && ['证书信息', 'certificates'].includes(section) && !row.certificate && row.name) row.certificate = row.name;
        grouped[collection].push({ row, section: label });
      }
    }
  }
  return grouped;
};

const createResumeImportService = ({ prisma }) => ({
  async import({ userId, payload, providedKey, resolutions = {} }) {
    const normalized = normalizePayload(payload);
    const projected = toDatabaseRows(normalized);
    const key = idempotencyKey(normalized, providedKey);
    let operation = await prisma.resumeImport.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } });
    if (operation?.status === 'completed') return { ...operation.result, idempotent: true, importId: operation.id };
    if (!operation) {
      try {
        operation = await prisma.resumeImport.create({ data: { userId, idempotencyKey: key, payload: normalized, status: 'pending' } });
      } catch (error) {
        // Another request may have won the unique-key race; reuse its operation.
        if (error?.code !== 'P2002') throw error;
        operation = await prisma.resumeImport.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } });
        if (!operation) throw error;
      }
    }

    const [profile, preferences] = await Promise.all([
      prisma.profile.findUnique({ where: { userId } }),
      prisma.jobPreference.findUnique({ where: { userId } }),
    ]);
    const conflicts = [];
    const equalValues = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
    const checkGroup = (group, current) => {
      const check = (field, incoming, existing, path) => {
        if (existing != null && valueOf(existing) !== '' && !equalValues(existing, incoming)) {
          conflicts.push({ path, field, group, existing, incoming, importId: operation.id });
        }
      };
      for (const [field, incoming] of Object.entries(projected[group])) {
        if (field === 'extra') {
          for (const [key, value] of Object.entries(incoming)) check(key, value, current?.extra?.[key], `${group}.extra.${key}`);
        } else check(field, incoming, current?.[field], `${group}.${field}`);
      }
    };
    checkGroup('profile', profile);
    checkGroup('preferences', preferences);
    const resolutionFor = (path) => resolutions[path] || resolutions[path.replace(/^profile\.|^preferences\./, '')] || resolutions.__all || resolutions['*'];
    const unresolved = conflicts.filter((conflict) => !['replace', 'keep'].includes(resolutionFor(conflict.path)));
    const conflictPaths = new Set(conflicts.map(({ path }) => path));
    const resolvedGroup = (group, current) => {
      const data = {};
      const shouldWrite = (path) => !conflictPaths.has(path) || resolutionFor(path) === 'replace';
      for (const [field, incoming] of Object.entries(projected[group])) {
        if (field === 'extra') {
          const extra = cleanExtra(isRecord(current?.extra) ? current.extra : {});
          for (const [key, value] of Object.entries(incoming)) {
            if (shouldWrite(`${group}.extra.${key}`)) extra[key] = value;
          }
          if (Object.keys(extra).length) data.extra = extra;
        } else if (shouldWrite(`${group}.${field}`)) data[field] = incoming;
      }
      return data;
    };

    const result = await prisma.$transaction(async (tx) => {
      const profileData = resolvedGroup('profile', profile);
      const prefData = resolvedGroup('preferences', preferences);
      if (Object.keys(profileData).length) await tx.profile.upsert({ where: { userId }, create: { userId, ...profileData }, update: profileData });
      if (Object.keys(prefData).length) await tx.jobPreference.upsert({ where: { userId }, create: { userId, ...prefData }, update: prefData });
      // Records are append-only. If this operation already applied its records
      // while returning conflicts, a resolution retry must not duplicate them.
      const created = { educations: [], experiences: [], projects: [], skills: [] };
      if (!operation.result?.applied) {
        for (const [collection, definition] of Object.entries(COLLECTIONS)) {
          for (const row of projected[collection]) {
            const record = await tx[definition.model].create({ data: { userId, ...row } });
            created[collection].push(record.id);
          }
        }
      }
      const output = { ok: true, importId: operation.id, created, unmapped: projected.unmapped, conflicts: conflicts.map((item) => ({ ...item, resolution: resolutionFor(item.path) || 'keep' })) };
      if (unresolved.length) {
        await tx.resumeImport.update({ where: { id: operation.id }, data: { status: 'pending', result: { ...output, ok: false, code: 'PROFILE_IMPORT_CONFLICT', conflicts: unresolved, message: '已有资料与识别结果存在冲突，请选择替换或保留。', applied: true } } });
      } else {
        await tx.resumeImport.update({ where: { id: operation.id }, data: { status: 'completed', result: output, completedAt: new Date() } });
      }
      return output;
    });
    if (unresolved.length) {
      const conflictResult = { ...result, ok: false, code: 'PROFILE_IMPORT_CONFLICT', conflicts: unresolved, message: '已有资料与识别结果存在冲突，请选择替换或保留。', applied: true };
      const error = new Error(conflictResult.message); error.code = conflictResult.code; error.status = 409; error.result = conflictResult; throw error;
    }
    return result;
  },
});

module.exports = { createResumeImportService, normalizePayload, collectRecords, toDatabaseRows, idempotencyKey, PROFILE_FIELDS, PREFERENCE_FIELDS, COLLECTIONS };
