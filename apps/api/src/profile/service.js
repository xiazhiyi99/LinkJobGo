const { createHash } = require('node:crypto');
const { PROFILE_FIELDS, PREFERENCE_FIELDS, RECORD_FIELDS } = require('@job-assistant/autofill-contracts');

// This service accepts only the server's authenticated account, never request body ownership.
const assertUser = (user) => {
  if (!user || typeof user.id !== 'string' || !user.id.trim() || typeof user.email !== 'string' || !user.email.trim()) {
    throw new TypeError('Profile service requires an authenticated account');
  }
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const profileFields = PROFILE_FIELDS.filter((field) => field !== 'email');
const preferenceFields = [...PREFERENCE_FIELDS];
const modelFields = {
  educations: { model: 'education', key: 'educations', fields: [...RECORD_FIELDS.education] },
  experiences: { model: 'experience', key: 'experiences', fields: [...RECORD_FIELDS.experience] },
  projects: { model: 'project', key: 'projects', fields: [...RECORD_FIELDS.project] },
  skills: { model: 'skill', key: 'skills', fields: [...RECORD_FIELDS.skill] },
};

const expandRecord = (record) => ({ ...record, ...(record.extra && typeof record.extra === 'object' ? record.extra : {}) });
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
};

/** No environment loading, HTTP, or database connection is created here. */
const createProfileService = ({ prisma, now = () => new Date() }) => {
  const getProfile = async (user) => {
    assertUser(user);
    const { id: userId, email } = user;
    const [profile, preferences, educations, experiences, projects, skills] = await Promise.all([
      prisma.profile.findUnique({ where: { userId } }),
      prisma.jobPreference.findUnique({ where: { userId } }),
      prisma.education.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      prisma.experience.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      prisma.project.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      prisma.skill.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    ]);
    const sectionOf = (record) => record.extra && typeof record.extra === 'object' ? record.extra.profileSection : null;
    return {
      profile: { ...(profile ? expandRecord(profile) : { userId }), email },
      preferences: preferences ? expandRecord(preferences) : { userId },
      educations: educations.map(expandRecord),
      experiences: experiences.filter((record) => !sectionOf(record) || sectionOf(record) === '工作/实习经历').map(expandRecord),
      campusExperiences: experiences.filter((record) => sectionOf(record) === '在校经历').map(expandRecord),
      projects: projects.filter((record) => !sectionOf(record) || sectionOf(record) === '项目经历').map(expandRecord),
      awards: projects.filter((record) => sectionOf(record) === '获奖经历').map(expandRecord),
      publications: projects.filter((record) => sectionOf(record) === '论文与专利').map(expandRecord),
      skills: skills.filter((record) => !['语言能力', '证书信息'].includes(sectionOf(record))).map(expandRecord),
      languages: skills.filter((record) => sectionOf(record) === '语言能力').map(expandRecord),
      certificates: skills.filter((record) => sectionOf(record) === '证书信息').map(expandRecord),
    };
  };

  const getAutofillContext = async (user) => {
    const source = await getProfile(user);
    const { email } = user;
    const systemKeys = new Set(['id', 'userId', 'createdAt', 'updatedAt', 'deletedAt', 'extra']);
    const cleanExtra = (value) => {
      if (Array.isArray(value)) return value.map(cleanExtra);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !systemKeys.has(key))
        .map(([key, item]) => [key, cleanExtra(item)]));
    };
    const projectFields = (value, allowedFields) => {
      const fields = {};
      const extra = {};
      const nestedExtra = value?.extra && typeof value.extra === 'object' ? cleanExtra(value.extra) : {};
      for (const [key, item] of Object.entries(value || {})) {
        if (systemKeys.has(key) || item === undefined) continue;
        if (allowedFields.has(key)) fields[key] = item;
        else extra[key] = cleanExtra(item);
      }
      for (const [key, item] of Object.entries(nestedExtra)) {
        if (!allowedFields.has(key)) extra[key] = item;
      }
      return { fields, extra };
    };
    const profileProjection = projectFields({ ...source.profile, email }, new Set([...profileFields, 'email']));
    const preferenceProjection = projectFields(source.preferences, new Set(preferenceFields));
    const profile = { ...profileProjection.fields, ...(Object.keys(profileProjection.extra).length ? { extra: profileProjection.extra } : {}) };
    const preferences = { ...preferenceProjection.fields, ...(Object.keys(preferenceProjection.extra).length ? { extra: preferenceProjection.extra } : {}) };
    const definitions = [
      ['educations', 'education', modelFields.educations.fields],
      ['experiences', 'experience', modelFields.experiences.fields],
      ['campusExperiences', 'campus', modelFields.experiences.fields],
      ['projects', 'project', modelFields.projects.fields],
      ['awards', 'award', modelFields.projects.fields],
      ['publications', 'publication', modelFields.projects.fields],
      ['languages', 'language', modelFields.skills.fields],
      ['certificates', 'certificate', modelFields.skills.fields],
      ['skills', 'skill', modelFields.skills.fields],
    ];
    const records = definitions.flatMap(([key, recordType, allowedFields]) => (source[key] || []).map((record, index) => {
      const projection = projectFields(record, new Set(allowedFields));
      return {
        id: record.id,
        recordType,
        index,
        fields: projection.fields,
        ...(Object.keys(projection.extra).length ? { extra: projection.extra } : {}),
      };
    }));
    const context = {
      schemaVersion: 'resume.autofill.v1',
      profile,
      preferences,
      records,
    };
    return {
      ...context,
      profileVersion: hash(JSON.stringify(stableValue(context))),
      generatedAt: now().toISOString(),
    };
  };

  return { getProfile, getAutofillContext };
};

module.exports = { createProfileService, profileFields, preferenceFields, modelFields, expandRecord };
