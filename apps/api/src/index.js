const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AiError } = require('./ai/errors');
const { createAiGateway } = require('./ai/gateway');
const { createResumeParseService } = require('./ai/tasks/resume-parse');
const { createAutofillService } = require('./ai/tasks/autofill');
const { createVisionExtractService } = require('./ai/tasks/vision-extract');
const { createResumeNormalizeService } = require('./ai/tasks/resume-normalize');
const { createResumePdfService } = require('./ai/tasks/resume-pdf');
const { createBaiduOcrService } = require('./ai/providers/baidu-ocr');
const { createResumeImportService } = require('./profile/resume-import');
const { toDatabaseRows } = require('./profile/resume-import');
const { sendMail } = require('./auth/mail');
const { createEmailCodeService } = require('./auth/email-code');
const { createCaptchaVerifier } = require('./auth/captcha');
const { createApplicationService } = require('./modules/applications/service');
const { createMailService } = require('./modules/mail/service');

// Load local .env without requiring another runtime dependency.
for (const filename of ['.env', path.resolve(__dirname, '../../../.env')]) {
  try {
    const content = fs.readFileSync(filename, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

let prisma;
try {
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
} catch (error) {
  console.error('[api] Prisma client unavailable. Run pnpm install and prisma generate.', error.message);
}

const port = Number(process.env.API_PORT || 3001);
const origin = process.env.WEB_ORIGIN || 'http://localhost:3000';
const secureCookie = process.env.SESSION_COOKIE_SECURE === 'true' || (process.env.SESSION_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production') ? '; Secure' : '';
const production = process.env.NODE_ENV === 'production';
const captchaVerifier = createCaptchaVerifier();
const emailCodeService = createEmailCodeService({
  prisma,
  sendMail,
  verifyCaptcha: captchaVerifier,
  secret: process.env.EMAIL_CODE_SECRET || (production ? '' : 'local-development-email-code-secret'),
  production,
});
const aiGateway = createAiGateway();
const resumeParseService = createResumeParseService(aiGateway);
const autofillService = createAutofillService(aiGateway);
const visionExtractService = createVisionExtractService(aiGateway);
const resumeNormalizeService = createResumeNormalizeService(aiGateway);
const baiduOcrService = createBaiduOcrService();
const resumePdfService = createResumePdfService({ visionExtractService, ocrService: baiduOcrService, resumeNormalizeService, resumeParseService, normalizePayload: require('./profile/resume-import').normalizePayload, databaseProjection: toDatabaseRows });
const resumeImportService = () => createResumeImportService({ prisma });
const applicationService = () => createApplicationService({ prisma });
const mailService = () => createMailService({ prisma, applicationService: applicationService() });
const json = (res, status, data, headers = {}) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    ...headers,
  });
  res.end(JSON.stringify(data));
};
const body = (req) => new Promise((resolve, reject) => {
  let raw = '';
  // Leave room for base64 image payloads. Individual task services enforce
  // their own stricter limits for resume and vision inputs.
  // JSON carries base64 files (up to 15MB decoded); leave headroom for the
  // base64 expansion and metadata while keeping a hard request limit.
  req.on('data', (chunk) => { raw += chunk; if (raw.length > 24_000_000) req.destroy(); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('请求数据格式错误')); } });
  req.on('error', reject);
});
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const passwordHash = (password, salt = crypto.randomBytes(16).toString('hex')) => `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const verifyPassword = (password, encoded) => {
  try {
    const [, salt, expected] = String(encoded).split('$');
    const actual = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
};
const userResponse = (user) => ({ id: user.id, email: user.email, role: user.role, emailVerified: Boolean(user.emailVerifiedAt) });
const createVerificationToken = async (userId) => {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.$transaction([
    prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.emailVerificationToken.create({ data: { userId, tokenHash: hash(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }),
  ]);
  return token;
};
const sendVerificationEmail = async (user) => {
  const token = await createVerificationToken(user.id);
  await sendMail({
    to: user.email,
    subject: '验证你的领客邮箱',
    text: `请打开 ${process.env.APP_URL || origin}/verify-email?token=${token} 完成邮箱验证。链接 24 小时内有效。`,
  });
};
const cookieValue = (req, name) => (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
const requestIp = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
};
const requireDatabase = (res) => { if (prisma) return true; json(res, 503, { error: '数据库暂不可用，请先启动 PostgreSQL 并执行 Prisma 迁移。' }); return false; };
const sessionUser = async (req) => {
  if (!prisma) return null;
  const id = cookieValue(req, 'lingke_session');
  if (!id) return null;
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session || session.type !== 'web' || session.revokedAt || session.expiresAt <= new Date()) return null;
  return session.user;
};
const tokenUser = async (req) => {
  if (!prisma) return null;
  const value = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!value) return null;
  const session = await prisma.session.findUnique({ where: { accessTokenHash: hash(value) }, include: { user: true } });
  if (!session || session.type !== 'extension' || session.revokedAt || session.expiresAt <= new Date()) return null;
  return session.user;
};
const currentUser = async (req) => (await sessionUser(req)) || (await tokenUser(req));
const requireUser = async (req, res) => {
  if (!requireDatabase(res)) return null;
  const user = await currentUser(req);
  if (!user) { json(res, 401, { error: '未登录' }); return null; }
  if (process.env.NODE_ENV === 'production' && !user.emailVerifiedAt) {
    json(res, 403, { error: '请先验证邮箱', code: 'EMAIL_NOT_VERIFIED' }); return null;
  }
  return user;
};
const requireRuleOperator = (user, res) => {
  if (user && ['admin', 'operator'].includes(user.role)) return true;
  json(res, 403, { error: '需要运营权限', code: 'RULE_OPERATOR_REQUIRED' });
  return false;
};
const aiErrorResponse = (res, error) => {
  const aiError = error instanceof AiError ? error : new AiError('AI 服务暂时不可用', 'AI_FAILED', { status: 502 });
  return json(res, aiError.status, { error: aiError.message, code: aiError.code, requestId: aiError.cause?.requestId });
};
const moduleErrorResponse = (res, error) => {
  const status = Number(error?.status) || (error?.code === 'VERSION_CONFLICT' ? 409 : 500);
  return json(res, status, { error: error?.message || '请求失败', ...(error?.code ? { code: error.code } : {}) });
};

const profileFields = ['name', 'avatarUrl', 'phone', 'city', 'personalWebsite', 'githubUrl', 'portfolioUrl', 'gender', 'birthday', 'homeCity', 'homeDistrict', 'schoolCity', 'address', 'politicalStatus', 'nationality', 'citizenship', 'wechat', 'nativePlace', 'highestEducation', 'firstWorkYear', 'fullTimeStudent', 'hasRelativesInCompany', 'recommendationMethod', 'workVisaRequired', 'workExperience', 'interests', 'selfIntroduction'];
const preferenceFields = ['targetTitles', 'targetCities', 'employmentType', 'targetIndustries', 'availableFrom', 'salaryExpectation', 'relocation', 'preferenceNote'];
const modelFields = {
  educations: { model: 'education', key: 'educations', fields: ['school', 'degree', 'major', 'startDate', 'endDate', 'current', 'gpa', 'courses'] },
  experiences: { model: 'experience', key: 'experiences', fields: ['company', 'title', 'city', 'startDate', 'endDate', 'current', 'description'] },
  projects: { model: 'project', key: 'projects', fields: ['name', 'role', 'startDate', 'endDate', 'url', 'description'] },
  skills: { model: 'skill', key: 'skills', fields: ['name', 'level', 'certificate', 'issuer', 'obtainedAt'] },
};
const splitData = (input, fields) => {
  const data = {};
  const extra = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (fields.includes(key)) {
      data[key] = key === 'current'
        ? value === true || value === 'true' || value === '在读' || value === '在职'
        : value == null ? null : String(value);
    }
    else if (!['id', 'userId', 'createdAt', 'updatedAt', 'deletedAt'].includes(key)) extra[key] = value;
  }
  if (Object.keys(extra).length) data.extra = extra;
  return data;
};
const expandRecord = (record) => ({ ...record, ...(record.extra && typeof record.extra === 'object' ? record.extra : {}) });
const profilePayload = async (userId, email) => {
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

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
};

// Page rules are a data-backed adapter. Keep URL handling and rule merging in
// the API so the extension does not need to know how versions inherit.
const normalizeOrigin = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return ''; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
  const port = parsed.port && !((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port}`;
};
const normalizePathPattern = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  let pathname = raw;
  try { if (/^https?:\/\//i.test(raw)) pathname = new URL(raw).pathname; } catch { return ''; }
  pathname = pathname.split(/[?#]/, 1)[0] || '/';
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
};
const normalizeRuleSource = (input = {}) => {
  const direct = String(input.sourceKey || '').trim();
  if (direct.startsWith('platform:') || direct.startsWith('generic:')) return { sourceKey: direct, origin: null, pathPattern: null };
  // Accept either the explicit origin/path form or a canonical URL sourceKey.
  // Query strings are intentionally discarded so a token/session id can never
  // become part of the rule identity.
  let origin = normalizeOrigin(input.origin || direct);
  let pathPattern = normalizePathPattern(input.pathPattern || input.path || (input.origin ? input.url : direct));
  if ((!origin || !pathPattern) && input.url) {
    try {
      const parsed = new URL(String(input.url));
      origin = normalizeOrigin(parsed.origin);
      pathPattern = normalizePathPattern(parsed.pathname);
    } catch {}
  }
  if (!origin || !pathPattern) return null;
  return { sourceKey: `${origin}${pathPattern}`, origin, pathPattern };
};
const sourceKeyFromRequest = (query) => {
  const direct = String(query.get('sourceKey') || '').trim();
  if (direct.startsWith('platform:') || direct.startsWith('generic:')) return direct;
  return normalizeRuleSource({ sourceKey: direct, origin: query.get('origin'), path: query.get('path'), url: query.get('url') })?.sourceKey || '';
};
const rulesObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
// Rules are declarative semantic evidence. Keep this deny-list deliberately
// broad and case-insensitive: accepting a selector under a differently cased
// key would turn the JSON blob into an unstable page-specific adapter.
const forbiddenRuleKeyPatterns = [
  /selector/i,
  /queryselector/i,
  /xpath/i,
  /dompath/i,
  /classname/i,
  /^class$/i,
  /^(?:dom)?path$/i,
  /^(?:element|field|dom)?id$/i,
  /^(?:value|values|default|actual)$/i,
  /html/i,
  /innerhtml/i,
  /outerhtml/i,
  /javascript/i,
  /(?:^|)(?:script|handler)$/i,
  /^on[a-z]/i,
  /(?:^|)(?:resume|filled|actual|target|default)(?:value|text)$/i,
];
const isForbiddenRuleKey = (key) => forbiddenRuleKeyPatterns.some((pattern) => pattern.test(String(key)));
const allowedRulePath = (value) => {
  const pathValue = String(value || '').trim();
  return /^(?:profile|preferences)\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(pathValue)
    || /^record\.[A-Za-z0-9_-]+\.[A-Za-z0-9_]+(?:\.extra\.[A-Za-z0-9_]+)*$/.test(pathValue)
    || /^records\.[A-Za-z0-9_-]+\.[A-Za-z0-9_]+(?:\.extra\.[A-Za-z0-9_]+)*$/.test(pathValue);
};
const validateRules = (rules) => {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return 'rules 必须是 JSON 对象';
  if (rules.schemaVersion !== 'page-rules.v1') return 'rules.schemaVersion 必须为 page-rules.v1';
  let error = null;
  const walk = (value, key = '') => {
    if (error) return;
    if (isForbiddenRuleKey(key)) { error = `规则不能保存页面选择器、可执行代码或简历实际值: ${key}`; return; }
    if (Array.isArray(value)) return value.forEach((item) => walk(item));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([childKey, child]) => walk(child, childKey));
  };
  walk(rules);
  if (error) return error;
  const inspectCollection = (collection) => {
    if (!collection) return [];
    return Array.isArray(collection) ? collection : Object.values(collection);
  };
  for (const section of ['fields', 'repeatGroups', 'options', 'dates']) {
    if (rules[section] !== undefined && !Array.isArray(rules[section]) && (typeof rules[section] !== 'object' || rules[section] === null)) {
      return `rules.${section} 必须是 JSON 对象或数组`;
    }
    const seen = new Set();
    for (const [index, item] of inspectCollection(rules[section]).entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const key = section === 'repeatGroups' ? item.groupKey : item.semanticKey;
      if (key === undefined) continue;
      const normalizedKey = String(key).trim();
      if (!normalizedKey) return `rules.${section}[${index}] 的语义键不能为空`;
      if (seen.has(normalizedKey)) return `rules.${section} 不能包含重复的语义键: ${normalizedKey}`;
      seen.add(normalizedKey);
    }
  }
  for (const section of ['fields', 'options', 'dates']) {
    for (const item of inspectCollection(rules[section])) {
      if (item?.sourcePath && !allowedRulePath(item.sourcePath)) return `不支持的简历字段路径: ${item.sourcePath}`;
    }
  }
  return null;
};
const validateFingerprintSummary = (summary) => {
  if (summary === undefined || summary === null) return null;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return 'fingerprintSummary 必须是 JSON 对象';
  // A fingerprint summary is an intentionally small, structural observation.
  // Reject raw markup, selectors and arbitrary nested payloads at the API
  // boundary so it cannot become a second rules or resume-value store.
  let error = null;
  const walk = (value, key = '') => {
    if (error) return;
    if (isForbiddenRuleKey(key)) { error = `fingerprintSummary 不能保存页面选择器或原始页面内容: ${key}`; return; }
    if (typeof value === 'string' && /<[^>]+>|javascript\s*:/i.test(value)) {
      error = 'fingerprintSummary 不能保存原始 HTML 或脚本';
      return;
    }
    if (Array.isArray(value)) return value.forEach((item) => walk(item));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([childKey, child]) => walk(child, childKey));
  };
  walk(summary);
  return error;
};
const mergeRuleValue = (parent, child) => {
  if (child === undefined) return parent;
  if (parent === undefined) return child;
  if (Array.isArray(parent) && Array.isArray(child)) {
    const merged = [...parent];
    for (const item of child) if (!merged.some((existing) => JSON.stringify(stableValue(existing)) === JSON.stringify(stableValue(item)))) merged.push(item);
    return merged;
  }
  if (parent && typeof parent === 'object' && !Array.isArray(parent) && child && typeof child === 'object' && !Array.isArray(child)) {
    const result = { ...parent };
    for (const [key, value] of Object.entries(child)) result[key] = mergeRuleValue(result[key], value);
    return result;
  }
  return child;
};
const ruleEntryKey = (section, item, fallback) => {
  if (section === 'repeatGroups') return item?.groupKey || fallback;
  if (section === 'fields' || section === 'dates') return item?.semanticKey || fallback;
  if (section === 'options') return item?.semanticKey || `${item?.sourceEnum || ''}:${fallback}`;
  return item?.semanticKey || item?.groupKey || fallback;
};
const mergeRuleCollection = (parent, child, section) => {
  if (Array.isArray(parent) || Array.isArray(child)) {
    const output = [];
    const index = new Map();
    for (const item of [...(Array.isArray(parent) ? parent : []), ...(Array.isArray(child) ? child : [])]) {
      const key = ruleEntryKey(section, item, output.length);
      if (index.has(key)) output[index.get(key)] = mergeRuleValue(output[index.get(key)], item);
      else { index.set(key, output.length); output.push(item); }
    }
    return output;
  }
  return mergeRuleValue(parent || {}, child || {});
};
const mergeRules = (parent, child) => {
  const result = mergeRuleValue(parent || {}, child || {});
  for (const section of ['fields', 'repeatGroups', 'options', 'dates']) {
    if (parent?.[section] !== undefined || child?.[section] !== undefined) result[section] = mergeRuleCollection(parent?.[section], child?.[section], section);
  }
  return result;
};
const getRuleChain = async (leaf) => {
  const chain = [];
  const seen = new Set();
  let current = leaf;
  while (current) {
    if (seen.has(current.id) || chain.length > 20) throw new Error('页面规则继承关系存在循环');
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentRuleSetId ? await prisma.autofillRuleSet.findUnique({ where: { id: current.parentRuleSetId } }) : null;
  }
  return chain;
};
const effectiveRulesFor = async (leaf) => {
  const chain = await getRuleChain(leaf);
  return { chain, rules: chain.reduce((merged, item) => mergeRules(merged, item.rules), {}) };
};
const currentRuleVersion = async (sourceKey) => {
  const latest = await prisma.autofillRuleSet.findFirst({ where: { sourceKey }, orderBy: [{ versionNo: 'desc' }] });
  return (latest?.versionNo || 0) + 1;
};

const autofillContextPayload = async (userId, email) => {
  const source = await profilePayload(userId, email);
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
    generatedAt: new Date().toISOString(),
  };
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    const data = await body(req);

    if (req.method === 'POST' && url.pathname === '/auth/register') {
      if (!requireDatabase(res)) return;
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      const passwordConfirmation = String(data.passwordConfirmation || '');
      const emailCode = String(data.emailCode || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return json(res, 400, { error: '请输入有效邮箱和至少 8 位密码' });
      if (password !== passwordConfirmation) return json(res, 400, { error: '两次输入的密码不一致' });
      if (await prisma.user.findUnique({ where: { email } })) return json(res, 409, { error: '邮箱或密码不正确' });
      if (production && !emailCode) return json(res, 400, { error: '请输入邮箱验证码', code: 'EMAIL_CODE_REQUIRED' });
      if (emailCode) {
        try {
          await emailCodeService.consume({ email, code: emailCode });
        } catch (error) {
          return json(res, Number(error.status) || 400, { error: error.message || '邮箱验证码无效或已过期', ...(error.code ? { code: error.code } : {}) });
        }
      }
      let user;
      try {
        user = await prisma.user.create({ data: { email, passwordHash: passwordHash(password), emailVerifiedAt: new Date() } });
      } catch (error) {
        if (error?.code === 'P2002') return json(res, 409, { error: '邮箱或密码不正确' });
        throw error;
      }
      const session = await prisma.session.create({ data: { userId: user.id, type: 'web', expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), userAgent: req.headers['user-agent'] } });
      return json(res, 201, { user: userResponse(user) }, { 'set-cookie': `lingke_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureCookie}` });
    }
    if (req.method === 'POST' && url.pathname === '/auth/email-code') {
      if (!requireDatabase(res)) return;
      try {
        return json(res, 200, await emailCodeService.request({ email: data.email, captcha: data.captcha, ip: requestIp(req) }));
      } catch (error) {
        return json(res, Number(error.status) || 400, { error: error.message || '验证码发送失败', ...(error.code ? { code: error.code } : {}) });
      }
    }
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      if (!requireDatabase(res)) return;
      const email = String(data.email || '').trim().toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !verifyPassword(String(data.password || ''), user.passwordHash)) return json(res, 401, { error: '邮箱或密码不正确' });
      const session = await prisma.session.create({ data: { userId: user.id, type: 'web', expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), userAgent: req.headers['user-agent'] } });
      return json(res, 200, { user: userResponse(user) }, { 'set-cookie': `lingke_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureCookie}` });
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      if (prisma) { const id = cookieValue(req, 'lingke_session'); if (id) await prisma.session.updateMany({ where: { id }, data: { revokedAt: new Date() } }); }
      return json(res, 200, { ok: true }, { 'set-cookie': `lingke_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${secureCookie}` });
    }
    if (req.method === 'GET' && url.pathname === '/auth/me') {
      const user = await requireUser(req, res); if (!user) return; return json(res, 200, { user: userResponse(user) });
    }
    if (req.method === 'POST' && url.pathname === '/auth/forgot-password') {
      if (prisma) {
        const target = await prisma.user.findUnique({ where: { email: String(data.email || '').trim().toLowerCase() } });
        if (target) {
          const token = crypto.randomBytes(32).toString('hex');
          await prisma.passwordResetToken.create({ data: { userId: target.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
          void sendMail({ to: target.email, subject: '重置你的领客密码', text: `请打开 ${process.env.APP_URL || origin}/reset-password?token=${token} 完成密码重置。链接 1 小时内有效。` }).catch((error) => console.error('[mail] reset failed:', error.message));
          // A real mail provider will deliver this token in production. Returning
          // it only in development keeps local testing deterministic.
          return json(res, 200, { message: '如果邮箱存在，重置链接将发送到邮箱。', ...(process.env.NODE_ENV === 'production' ? {} : { resetToken: token }) });
        }
      }
      return json(res, 200, { message: '如果邮箱存在，重置链接将发送到邮箱。' });
    }
    if (req.method === 'POST' && url.pathname === '/auth/reset-password') {
      if (!requireDatabase(res)) return;
      const token = String(data.token || '');
      const password = String(data.password || '');
      if (password.length < 8 || !token) return json(res, 400, { error: '请输入有效的重置令牌和至少 8 位密码' });
      const reset = await prisma.passwordResetToken.findFirst({ where: { tokenHash: hash(token), usedAt: null }, include: { user: true } });
      if (!reset || reset.expiresAt <= new Date()) return json(res, 400, { error: '重置令牌无效或已过期' });
      await prisma.$transaction([
        prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: passwordHash(password) } }),
        prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
        prisma.session.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/auth/verify-email') {
      if (!requireDatabase(res)) return;
      const token = String(data.token || '');
      const verification = await prisma.emailVerificationToken.findFirst({ where: { tokenHash: hash(token), usedAt: null }, include: { user: true } });
      if (!verification || verification.expiresAt <= new Date()) return json(res, 400, { error: '验证令牌无效或已过期' });
      await prisma.$transaction([
        prisma.user.update({ where: { id: verification.userId }, data: { emailVerifiedAt: new Date() } }),
        prisma.emailVerificationToken.update({ where: { id: verification.id }, data: { usedAt: new Date() } }),
      ]);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/auth/resend-verification') {
      if (!requireDatabase(res)) return;
      const target = await prisma.user.findUnique({ where: { email: String(data.email || '').trim().toLowerCase() } });
      if (target && !target.emailVerifiedAt) {
        void sendVerificationEmail(target).catch((error) => console.error('[mail] verification failed:', error.message));
      }
      return json(res, 200, { message: '如果邮箱存在，验证链接将发送到邮箱。' });
    }
    if (req.method === 'POST' && url.pathname === '/auth/extension/login') {
      if (!requireDatabase(res)) return;
      const user = await prisma.user.findUnique({ where: { email: String(data.email || '').trim().toLowerCase() } });
      if (!user || !verifyPassword(String(data.password || ''), user.passwordHash)) return json(res, 401, { error: '邮箱或密码不正确' });
      const accessToken = crypto.randomBytes(32).toString('hex');
      const refreshToken = crypto.randomBytes(48).toString('hex');
      await prisma.session.create({ data: { userId: user.id, type: 'extension', accessTokenHash: hash(accessToken), refreshTokenHash: hash(refreshToken), expiresAt: new Date(Date.now() + 1000 * 60 * 15), userAgent: req.headers['user-agent'] } });
      return json(res, 200, { accessToken, refreshToken, expiresIn: 900, user: userResponse(user) });
    }
    if (req.method === 'POST' && url.pathname === '/auth/extension/refresh') {
      if (!requireDatabase(res)) return;
      const refreshToken = String(data.refreshToken || '');
      const session = await prisma.session.findFirst({ where: { type: 'extension', refreshTokenHash: hash(refreshToken), revokedAt: null }, include: { user: true } });
      if (!session || session.expiresAt <= new Date()) return json(res, 401, { error: '刷新令牌无效或已过期' });
      const accessToken = crypto.randomBytes(32).toString('hex');
      await prisma.session.update({ where: { id: session.id }, data: { accessTokenHash: hash(accessToken), expiresAt: new Date(Date.now() + 1000 * 60 * 15) } });
      return json(res, 200, { accessToken, expiresIn: 900, user: userResponse(session.user) });
    }
    if (req.method === 'POST' && url.pathname === '/auth/extension/logout') {
      if (prisma) { const user = await tokenUser(req); const access = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (user && access) await prisma.session.updateMany({ where: { accessTokenHash: hash(access), userId: user.id }, data: { revokedAt: new Date() } }); }
      return json(res, 200, { ok: true });
    }

    const user = await requireUser(req, res); if (!user) return;
    // Applications, mail and calendar are kept behind the same authenticated
    // boundary. Every service query receives the session user id and never
    // trusts a userId supplied by the browser.
    try {
      const applications = applicationService();
      const mail = mailService();
      if (req.method === 'GET' && url.pathname === '/applications') return json(res, 200, await applications.list(user.id, Object.fromEntries(url.searchParams.entries())));
      if (req.method === 'POST' && url.pathname === '/applications') return json(res, 201, { application: await applications.create(user.id, data) });
      const applicationMatch = url.pathname.match(/^\/applications\/([^/]+)$/);
      if (applicationMatch && req.method === 'GET') return json(res, 200, { application: await applications.get(user.id, applicationMatch[1]) });
      if (applicationMatch && req.method === 'PATCH') return json(res, 200, { application: await applications.update(user.id, applicationMatch[1], data) });
      const eventMatch = url.pathname.match(/^\/applications\/([^/]+)\/events$/);
      if (eventMatch && req.method === 'POST') return json(res, 201, { application: await applications.addEvent(user.id, eventMatch[1], data) });
      const applicationTaskMatch = url.pathname.match(/^\/applications\/([^/]+)\/tasks$/);
      if (applicationTaskMatch && req.method === 'POST') return json(res, 201, { task: await applications.createTask(user.id, applicationTaskMatch[1], data) });
      if (applicationTaskMatch && req.method === 'GET') return json(res, 200, await applications.listTasks(user.id, { ...Object.fromEntries(url.searchParams.entries()), applicationId: applicationTaskMatch[1] }));
      if (req.method === 'GET' && url.pathname === '/tasks') return json(res, 200, await applications.listTasks(user.id, Object.fromEntries(url.searchParams.entries())));
      const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
      if (taskMatch && req.method === 'PATCH') return json(res, 200, { task: await applications.updateTask(user.id, taskMatch[1], data) });
      if (req.method === 'GET' && url.pathname === '/calendar') return json(res, 200, await applications.calendar(user.id, Object.fromEntries(url.searchParams.entries())));

      if (req.method === 'GET' && url.pathname === '/mail/providers') return json(res, 200, await mail.providers());
      if (req.method === 'GET' && url.pathname === '/mail-accounts') return json(res, 200, await mail.listAccounts(user.id));
      if (req.method === 'POST' && url.pathname === '/mail-accounts/imap') return json(res, 201, { account: await mail.createImap(user.id, data) });
      if (req.method === 'POST' && url.pathname === '/mail-accounts/oauth/start') return json(res, 200, await mail.createOAuthStart(user.id, data));
      if (req.method === 'POST' && url.pathname === '/mail-accounts/oauth/callback') return json(res, 200, { account: await mail.completeOAuth(user.id, data) });
      if (req.method === 'GET' && url.pathname === '/mail-accounts/oauth/callback') {
        const account = await mail.completeOAuth(user.id, Object.fromEntries(url.searchParams.entries()));
        const target = new URL('/workspace/applications', process.env.WEB_ORIGIN || origin);
        target.searchParams.set('mail', 'connected');
        target.searchParams.set('provider', account.provider);
        res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' });
        return res.end();
      }
      const accountSyncMatch = url.pathname.match(/^\/mail-accounts\/([^/]+)\/sync$/);
      if (accountSyncMatch && req.method === 'POST') {
        const syncRun = await mail.startSync(user.id, accountSyncMatch[1], data);
        return json(res, 202, { data: { syncRunId: syncRun.id, status: syncRun.status, rangeDays: syncRun.rangeDays }, syncRun });
      }
      const accountMatch = url.pathname.match(/^\/mail-accounts\/([^/]+)$/);
      if (accountMatch && req.method === 'DELETE') return json(res, 200, await mail.removeAccount(user.id, accountMatch[1]));
      const syncMatch = url.pathname.match(/^\/sync-runs\/([^/]+)$/);
      if (syncMatch && req.method === 'GET') return json(res, 200, { syncRun: await mail.getSyncRun(user.id, syncMatch[1]) });
      if (req.method === 'GET' && url.pathname === '/mail-messages') return json(res, 200, await mail.listMessages(user.id, Object.fromEntries(url.searchParams.entries())));
      const analysisMatch = url.pathname.match(/^\/mail-messages\/([^/]+)\/analysis$/);
      if (analysisMatch && req.method === 'PATCH') return json(res, 200, await mail.updateAnalysis(user.id, analysisMatch[1], data));
      const messageMatch = url.pathname.match(/^\/mail-messages\/([^/]+)$/);
      if (messageMatch && req.method === 'GET') return json(res, 200, { message: await mail.getMessage(user.id, messageMatch[1]) });
      if (messageMatch && req.method === 'PATCH') return json(res, 200, { message: await mail.updateMessage(user.id, messageMatch[1], data) });
    } catch (error) {
      return moduleErrorResponse(res, error);
    }
    if (req.method === 'GET' && url.pathname === '/autofill/rules/resolve') {
      const sourceKey = sourceKeyFromRequest(url.searchParams);
      if (!sourceKey) return json(res, 400, { error: '请提供有效的 sourceKey，或 origin/path、url' });
      const leaf = await prisma.autofillRuleSet.findFirst({ where: { sourceKey, state: 'published' }, orderBy: [{ priority: 'desc' }, { versionNo: 'desc' }] });
      if (!leaf) return json(res, 200, { matched: false, sourceKey, rules: null, ruleSet: null });
      const resolved = await effectiveRulesFor(leaf);
      const fingerprintHash = String(url.searchParams.get('fingerprintHash') || '');
      const fingerprintChanged = Boolean(fingerprintHash && leaf.fingerprintHash && fingerprintHash !== leaf.fingerprintHash);
      if (fingerprintChanged) {
        await prisma.autofillRuleSet.update({ where: { id: leaf.id }, data: { needsReview: true, health: 'review', fingerprintObservedAt: new Date() } });
      }
      return json(res, 200, {
        matched: true,
        sourceKey,
        fingerprintChanged,
        needsReview: resolved.chain.some((item) => item.needsReview) || fingerprintChanged,
        rules: resolved.rules,
        ruleSet: {
          id: leaf.id,
          scope: leaf.scope,
          platformKey: leaf.platformKey,
          sourceKey: leaf.sourceKey,
          origin: leaf.origin,
          pathPattern: leaf.pathPattern,
          queryPolicy: leaf.queryPolicy,
          versionNo: leaf.versionNo,
          state: leaf.state,
          health: fingerprintChanged ? 'review' : leaf.health,
          chain: resolved.chain.map((item) => ({ id: item.id, scope: item.scope, sourceKey: item.sourceKey, versionNo: item.versionNo })),
        },
      });
    }
    if (req.method === 'POST' && url.pathname === '/autofill/rules/drafts') {
      if (!requireRuleOperator(user, res)) return;
      const source = normalizeRuleSource(data);
      if (!source) return json(res, 400, { error: '请提供有效的 origin/pathPattern、url 或 sourceKey' });
      const validationError = validateRules(data.rules);
      if (validationError) return json(res, 400, { error: validationError });
      const fingerprintError = validateFingerprintSummary(data.fingerprintSummary);
      if (fingerprintError) return json(res, 400, { error: fingerprintError });
      const scope = String(data.scope || 'tenant');
      if (!['generic', 'platform', 'variant', 'tenant'].includes(scope)) return json(res, 400, { error: 'scope 不合法' });
      const queryPolicy = String(data.queryPolicy || 'ignore');
      if (!['ignore', 'allowlist'].includes(queryPolicy)) return json(res, 400, { error: 'queryPolicy 不合法' });
      if (scope === 'generic' && !source.sourceKey.startsWith('generic:')) return json(res, 400, { error: 'generic 规则必须使用 generic: sourceKey' });
      if (scope !== 'generic' && source.sourceKey.startsWith('generic:')) return json(res, 400, { error: '非 generic 规则不能使用 generic: sourceKey' });
      let parent = null;
      if (data.parentRuleSetId) {
        parent = await prisma.autofillRuleSet.findUnique({ where: { id: String(data.parentRuleSetId) } });
        if (!parent || parent.state !== 'published') return json(res, 400, { error: 'parentRuleSetId 必须指向已发布规则' });
        if (parent.id === data.supersedesId) return json(res, 400, { error: '规则不能同时继承并覆盖自身' });
      }
      let supersedes = null;
      if (data.supersedesId) {
        supersedes = await prisma.autofillRuleSet.findUnique({ where: { id: String(data.supersedesId) } });
        if (!supersedes || supersedes.sourceKey !== source.sourceKey) return json(res, 400, { error: 'supersedesId 必须指向同一 sourceKey 的规则' });
      }
      const versionNo = await currentRuleVersion(source.sourceKey);
      const draft = await prisma.autofillRuleSet.create({ data: {
        scope,
        platformKey: data.platformKey ? String(data.platformKey) : null,
        sourceKey: source.sourceKey,
        origin: source.origin,
        pathPattern: source.pathPattern,
        queryPolicy,
        parentRuleSetId: parent?.id || null,
        supersedesId: supersedes?.id || null,
        versionNo,
        priority: Number.isFinite(Number(data.priority)) ? Number(data.priority) : 0,
        state: 'draft',
        health: 'healthy',
        needsReview: false,
        rules: data.rules,
        fingerprintHash: data.fingerprintHash ? String(data.fingerprintHash) : null,
        fingerprintSummary: data.fingerprintSummary && typeof data.fingerprintSummary === 'object' ? data.fingerprintSummary : undefined,
        createdByUserId: user.id,
      } });
      return json(res, 201, { ruleSet: draft });
    }
    const ruleMatch = url.pathname.match(/^\/autofill\/rules\/([^/]+)\/(publish|review)$/);
    if (ruleMatch && req.method === 'POST') {
      if (!requireRuleOperator(user, res)) return;
      const [, ruleId, action] = ruleMatch;
      const ruleSet = await prisma.autofillRuleSet.findUnique({ where: { id: ruleId } });
      if (!ruleSet) return json(res, 404, { error: '规则不存在' });
      if (action === 'review') {
        const needsReview = data.needsReview !== false;
        const fingerprintError = validateFingerprintSummary(data.fingerprintSummary);
        if (fingerprintError) return json(res, 400, { error: fingerprintError });
        // Reviewing a candidate advances the workflow even when the review
        // clears a prior health flag. Published rows remain published; review
        // is a health signal for those rows, not a second publication state.
        const nextState = ruleSet.state === 'draft' ? 'review' : ruleSet.state;
        const updated = await prisma.autofillRuleSet.update({ where: { id: ruleId }, data: {
          state: nextState,
          needsReview,
          health: needsReview ? 'review' : (ruleSet.health === 'review' ? 'healthy' : ruleSet.health),
          fingerprintHash: data.fingerprintHash ? String(data.fingerprintHash) : undefined,
          fingerprintSummary: data.fingerprintSummary && typeof data.fingerprintSummary === 'object' ? data.fingerprintSummary : undefined,
          fingerprintObservedAt: data.fingerprintHash || data.fingerprintSummary ? new Date() : undefined,
        } });
        return json(res, 200, { ruleSet: updated });
      }
      if (!['draft', 'review'].includes(ruleSet.state)) return json(res, 409, { error: '只有 draft 或 review 规则可以发布' });
      const validationError = validateRules(ruleSet.rules);
      if (validationError) return json(res, 409, { error: validationError });
      if (ruleSet.parentRuleSetId) {
        const parent = await prisma.autofillRuleSet.findUnique({ where: { id: ruleSet.parentRuleSetId } });
        if (!parent || parent.state !== 'published') return json(res, 409, { error: '父规则必须先发布' });
      }
      const published = await prisma.$transaction(async (tx) => {
        const previous = await tx.autofillRuleSet.findFirst({ where: { sourceKey: ruleSet.sourceKey, state: 'published' }, orderBy: { versionNo: 'desc' } });
        await tx.autofillRuleSet.updateMany({ where: { sourceKey: ruleSet.sourceKey, state: 'published' }, data: { state: 'deprecated' } });
        return tx.autofillRuleSet.update({ where: { id: ruleId }, data: {
          state: 'published',
          health: 'healthy',
          needsReview: false,
          reviewedByUserId: user.id,
          publishedAt: new Date(),
          supersedesId: ruleSet.supersedesId || previous?.id || null,
        } });
      });
      return json(res, 200, { ruleSet: published });
    }
    if (req.method === 'POST' && url.pathname === '/ai/resume/parse') {
      try {
        const result = await resumeParseService.parse({ content: data.content, filename: data.filename, userId: user.id, requestId: data.requestId });
        return json(res, 200, result);
      } catch (error) { return aiErrorResponse(res, error); }
    }
    if (req.method === 'POST' && url.pathname === '/ai/resume/parse-file') {
      try {
        const result = await resumePdfService.parseFile({ filename: data.filename, contentType: data.contentType, contentBase64: data.contentBase64, userId: user.id, requestId: data.requestId });
        return json(res, 200, result);
      } catch (error) { return aiErrorResponse(res, error); }
    }
    if (req.method === 'POST' && url.pathname === '/profiles/me/resume/import') {
      try {
        if (!requireDatabase(res)) return;
        const payload = data.result || data.payload || data.data || data;
        const key = req.headers['idempotency-key'] || data.idempotencyKey;
        const resolutions = data.resolutions || (typeof data.replace === 'boolean' ? { __all: data.replace ? 'replace' : 'keep' } : {});
        const result = await resumeImportService().import({ userId: user.id, payload, providedKey: key, resolutions });
        return json(res, 200, result);
      } catch (error) {
        if (error?.code === 'PROFILE_IMPORT_CONFLICT') return json(res, 409, error.result);
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/ai/autofill/suggestions') {
      try {
        const result = await autofillService.suggest({ fields: data.fields, profile: data.profile || {}, jobContext: data.jobContext || {}, userId: user.id, requestId: data.requestId });
        return json(res, 200, result);
      } catch (error) { return aiErrorResponse(res, error); }
    }
    if (req.method === 'POST' && url.pathname === '/ai/vision/extract') {
      try {
        const result = await visionExtractService.extract({ images: data.images, instruction: data.instruction, userId: user.id, requestId: data.requestId });
        return json(res, 200, result);
      } catch (error) { return aiErrorResponse(res, error); }
    }
    if (req.method === 'POST' && url.pathname === '/ai/resume/normalize') {
      try {
        const result = await resumeNormalizeService.normalize({ payload: data.result || data.payload || data.data || data, userId: user.id, requestId: data.requestId });
        return json(res, 200, result);
      } catch (error) { return aiErrorResponse(res, error); }
    }
    if (req.method === 'POST' && url.pathname === '/profiles/me/resume') {
      const content = typeof data.content === 'string' ? data.content : '';
      const filename = String(data.filename || 'resume.txt').slice(0, 200);
      const contentType = String(data.contentType || 'text/plain').slice(0, 120);
      if (!content) return json(res, 400, { error: '简历内容不能为空' });
      if (Buffer.byteLength(content, 'utf8') > 1_000_000) return json(res, 413, { error: '简历文件不能超过 1MB' });
      if (!/\.(txt|md|markdown)$/i.test(filename)) return json(res, 400, { error: '当前仅支持 TXT 或 Markdown 简历' });
      const document = await prisma.resumeDocument.create({ data: { userId: user.id, filename, contentType, content } });
      return json(res, 201, { resume: { id: document.id, filename: document.filename, contentType: document.contentType, size: Buffer.byteLength(document.content, 'utf8'), createdAt: document.createdAt } });
    }
    if (req.method === 'GET' && url.pathname === '/profiles/me/resume') {
      const document = await prisma.resumeDocument.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
      return json(res, 200, { resume: document ? { id: document.id, filename: document.filename, contentType: document.contentType, size: Buffer.byteLength(document.content, 'utf8'), createdAt: document.createdAt } : null });
    }
    if (req.method === 'GET' && (url.pathname === '/profiles/me/autofill-context' || url.pathname === '/profiles/me/export')) {
      const context = await autofillContextPayload(user.id, user.email);
      const headers = url.pathname === '/profiles/me/export'
        ? { 'content-disposition': 'attachment; filename="autofill-context.json"' }
        : {};
      return json(res, 200, context, headers);
    }
    if (req.method === 'GET' && url.pathname === '/profiles/me') return json(res, 200, await profilePayload(user.id, user.email));
    if (req.method === 'PATCH' && (url.pathname === '/profiles/me' || url.pathname === '/profiles/me/preferences')) {
      const isPreferences = url.pathname.endsWith('/preferences');
      const fields = isPreferences ? preferenceFields : profileFields;
      const model = isPreferences ? prisma.jobPreference : prisma.profile;
      const where = { userId: user.id };
      const updateData = splitData(isPreferences ? data : (data.profile || data), fields);
      const record = await model.upsert({ where, create: { userId: user.id, ...updateData }, update: updateData });
      let preferencesRecord = null;
      if (!isPreferences && data.preferences && typeof data.preferences === 'object') {
        const preferenceData = splitData(data.preferences, preferenceFields);
        preferencesRecord = await prisma.jobPreference.upsert({ where, create: { userId: user.id, ...preferenceData }, update: preferenceData });
      }
      // The profile editor saves its three groups together. Replace the active
      // rows for each group in one transaction so browser-only draft ids never
      // leak into the database and a second save cannot create duplicates.
      if (!isPreferences && data.records && typeof data.records === 'object') {
        const sectionNames = {
          教育经历: 'educations',
          '工作/实习经历': 'experiences',
          项目经历: 'projects',
          '在校经历': 'experiences',
          获奖经历: 'projects',
          '论文与专利': 'projects',
          语言能力: 'skills',
          证书信息: 'skills',
          技能: 'skills',
        };
        const grouped = {};
        for (const [section, items] of Object.entries(data.records)) {
          const collection = sectionNames[section];
          if (!collection || !Array.isArray(items)) continue;
          grouped[collection] = [...(grouped[collection] || []), ...items.map((item) => ({ item, section }))];
        }
        await prisma.$transaction(async (tx) => {
          for (const [collection, definition] of Object.entries(modelFields)) {
            const modelForGroup = tx[definition.model];
            await modelForGroup.updateMany({ where: { userId: user.id, deletedAt: null }, data: { deletedAt: new Date() } });
            for (const { item, section } of grouped[collection] || []) {
              const recordData = splitData(item, definition.fields);
              recordData.extra = { ...(recordData.extra || {}), profileSection: section };
              await modelForGroup.create({ data: { userId: user.id, ...recordData } });
            }
          }
        });
      }
      return json(res, 200, { [isPreferences ? 'preferences' : 'profile']: expandRecord(record), ...(preferencesRecord ? { preferences: expandRecord(preferencesRecord) } : {}) });
    }

    const match = url.pathname.match(/^\/profiles\/me\/(educations|experiences|projects|skills)(?:\/([^/]+))?(?:\/(restore))?$/);
    if (match) {
      const [, collection, id, action] = match;
      const definition = modelFields[collection];
      const model = prisma[definition.model];
      if (action === 'restore' && req.method === 'POST' && id) {
        const result = await model.updateMany({ where: { id, userId: user.id }, data: { deletedAt: null } });
        if (!result.count) return json(res, 404, { error: '资料条目不存在' });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && !id) return json(res, 201, { item: expandRecord(await model.create({ data: { userId: user.id, ...splitData(data, definition.fields) } })) });
      if (req.method === 'PATCH' && id) {
        const result = await model.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: splitData(data, definition.fields) });
        if (!result.count) return json(res, 404, { error: '资料条目不存在' });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && id) {
        const result = await model.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: { deletedAt: new Date() } });
        if (!result.count) return json(res, 404, { error: '资料条目不存在' });
        return json(res, 200, { ok: true });
      }
    }
    if (url.pathname.startsWith('/workspace')) return json(res, 200, { ok: true });
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('[api]', error);
    return json(res, 500, { error: '服务器错误' });
  }
});
server.listen(port, () => console.log(`[api] database API listening on http://localhost:${port}`));
