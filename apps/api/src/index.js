const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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
  // Leave room for JSON metadata while enforcing the 1 MB resume content limit
  // in the resume endpoint below.
  req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_200_000) req.destroy(); });
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
const cookieValue = (req, name) => (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
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
  const session = await prisma.session.findUnique({ where: { id: value }, include: { user: true } });
  if (!session || session.type !== 'extension' || session.revokedAt || session.expiresAt <= new Date()) return null;
  return session.user;
};
const currentUser = async (req) => (await sessionUser(req)) || (await tokenUser(req));
const requireUser = async (req, res) => {
  if (!requireDatabase(res)) return null;
  const user = await currentUser(req);
  if (!user) { json(res, 401, { error: '未登录' }); return null; }
  return user;
};

const profileFields = ['name', 'avatarUrl', 'phone', 'city', 'personalWebsite', 'githubUrl', 'portfolioUrl', 'gender', 'birthday', 'homeCity', 'homeDistrict', 'schoolCity', 'address', 'politicalStatus', 'nationality', 'workExperience', 'interests', 'selfIntroduction'];
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
    skills: skills.map(expandRecord),
  };
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const data = await body(req);

    if (req.method === 'POST' && url.pathname === '/auth/register') {
      if (!requireDatabase(res)) return;
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return json(res, 400, { error: '请输入有效邮箱和至少 8 位密码' });
      if (await prisma.user.findUnique({ where: { email } })) return json(res, 409, { error: '邮箱或密码不正确' });
      const user = await prisma.user.create({ data: { email, passwordHash: passwordHash(password), emailVerifiedAt: process.env.NODE_ENV === 'production' ? null : new Date() } });
      return json(res, 201, { user: userResponse(user) });
    }
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      if (!requireDatabase(res)) return;
      const email = String(data.email || '').trim().toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !verifyPassword(String(data.password || ''), user.passwordHash)) return json(res, 401, { error: '邮箱或密码不正确' });
      const session = await prisma.session.create({ data: { userId: user.id, type: 'web', expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), userAgent: req.headers['user-agent'] } });
      return json(res, 200, { user: userResponse(user) }, { 'set-cookie': `lingke_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      if (prisma) { const id = cookieValue(req, 'lingke_session'); if (id) await prisma.session.updateMany({ where: { id }, data: { revokedAt: new Date() } }); }
      return json(res, 200, { ok: true }, { 'set-cookie': 'lingke_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/' });
    }
    if (req.method === 'GET' && url.pathname === '/auth/me') {
      const user = await requireUser(req, res); if (!user) return; return json(res, 200, { user: userResponse(user) });
    }
    if (req.method === 'POST' && url.pathname === '/auth/forgot-password') return json(res, 200, { message: '如果邮箱存在，重置链接将发送到邮箱。' });
    if (req.method === 'POST' && url.pathname === '/auth/extension/login') {
      if (!requireDatabase(res)) return;
      const user = await prisma.user.findUnique({ where: { email: String(data.email || '').trim().toLowerCase() } });
      if (!user || !verifyPassword(String(data.password || ''), user.passwordHash)) return json(res, 401, { error: '邮箱或密码不正确' });
      const accessToken = crypto.randomBytes(32).toString('hex');
      const refreshToken = crypto.randomBytes(48).toString('hex');
      await prisma.session.create({ data: { id: accessToken, userId: user.id, type: 'extension', refreshTokenHash: hash(refreshToken), expiresAt: new Date(Date.now() + 1000 * 60 * 15), userAgent: req.headers['user-agent'] } });
      return json(res, 200, { accessToken, refreshToken, expiresIn: 900, user: userResponse(user) });
    }
    if (req.method === 'POST' && url.pathname === '/auth/extension/refresh') {
      if (!requireDatabase(res)) return;
      const refreshToken = String(data.refreshToken || '');
      const session = await prisma.session.findFirst({ where: { type: 'extension', refreshTokenHash: hash(refreshToken), revokedAt: null }, include: { user: true } });
      if (!session || session.expiresAt <= new Date()) return json(res, 401, { error: '刷新令牌无效或已过期' });
      const accessToken = crypto.randomBytes(32).toString('hex');
      await prisma.session.update({ where: { id: session.id }, data: { id: accessToken, expiresAt: new Date(Date.now() + 1000 * 60 * 15) } });
      return json(res, 200, { accessToken, expiresIn: 900, user: userResponse(session.user) });
    }
    if (req.method === 'POST' && url.pathname === '/auth/extension/logout') {
      if (prisma) { const user = await tokenUser(req); const access = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (user && access) await prisma.session.updateMany({ where: { id: access, userId: user.id }, data: { revokedAt: new Date() } }); }
      return json(res, 200, { ok: true });
    }

    const user = await requireUser(req, res); if (!user) return;
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
