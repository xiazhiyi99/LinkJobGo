import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const port = 3201;
const base = `http://127.0.0.1:${port}`;
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/job_assistant_dev';
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const api = spawn(process.execPath, ['src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, API_PORT: String(port), DATABASE_URL: databaseUrl, AI_PROVIDER_MODE: 'fake', AI_FAKE_FAILURES: '2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const waitForApi = async () => {
  for (let i = 0; i < 40; i += 1) {
    try { await fetch(`${base}/auth/me`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error('API did not start');
};
const request = async (path, options = {}, cookie = '') => {
  const response = await fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(options.headers || {}) } });
  const payload = await response.json();
  return { response, payload };
};
const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });
const email = `integration-${randomUUID()}@example.com`;
const secondEmail = `integration-${randomUUID()}@example.com`;
const password = 'password123';
const sessionCookie = (response) => response.headers.get('set-cookie')?.split(';')[0] || '';

try {
  await waitForApi();
  assert.equal((await request('/auth/register', json({ email, password }))).response.status, 201);
  const login = await request('/auth/login', json({ email, password }));
  assert.equal(login.response.status, 200);
  const cookie = sessionCookie(login.response);
  assert.ok(cookie);

  const genericRules = {
    schemaVersion: 'page-rules.v1',
    fields: {
      'profile.name': {
        sourcePath: 'profile.name',
        controlKind: 'text',
        strategy: 'text',
        locator: { labelTokens: ['姓名', 'name'], role: 'textbox' },
      },
    },
    repeatGroups: {},
    options: {},
    dates: {},
  };
  const forbiddenForUser = await request('/autofill/rules/drafts', json({
    scope: 'generic',
    sourceKey: 'generic:v1',
    rules: genericRules,
  }), cookie);
  assert.equal(forbiddenForUser.response.status, 403);
  assert.equal(forbiddenForUser.payload.code, 'RULE_OPERATOR_REQUIRED');
  await prisma.user.update({ where: { email }, data: { role: 'operator' } });
  const rejectedRule = await request('/autofill/rules/drafts', json({
    scope: 'generic',
    sourceKey: 'generic:v1',
    rules: { ...genericRules, fields: { 'profile.name': { sourcePath: 'profile.name', cssSelector: '#name' } } },
  }), cookie);
  assert.equal(rejectedRule.response.status, 400);
  const canonicalSourceDraft = await request('/autofill/rules/drafts', json({
    scope: 'platform',
    platformKey: 'fixture',
    sourceKey: 'https://EXAMPLE.com/resume/?token=secret',
    rules: genericRules,
  }), cookie);
  assert.equal(canonicalSourceDraft.response.status, 201);
  assert.equal(canonicalSourceDraft.payload.ruleSet.sourceKey, 'https://example.com/resume');
  assert.equal(canonicalSourceDraft.payload.ruleSet.pathPattern, '/resume');
  const draftRule = await request('/autofill/rules/drafts', json({
    scope: 'generic',
    sourceKey: 'generic:v1',
    fingerprintHash: 'layout-v1',
    fingerprintSummary: { fieldCount: 1, groupCount: 0 },
    rules: genericRules,
  }), cookie);
  assert.equal(draftRule.response.status, 201);
  const ruleId = draftRule.payload.ruleSet.id;
  const reviewedRule = await request(`/autofill/rules/${ruleId}/review`, json({}), cookie);
  assert.equal(reviewedRule.response.status, 200);
  assert.equal(reviewedRule.payload.ruleSet.state, 'review');
  const publishedRule = await request(`/autofill/rules/${ruleId}/publish`, json({}), cookie);
  assert.equal(publishedRule.response.status, 200);
  assert.equal(publishedRule.payload.ruleSet.state, 'published');
  await prisma.user.update({ where: { email }, data: { role: 'user' } });
  const resolvedRule = await request('/autofill/rules/resolve?sourceKey=generic%3Av1&fingerprintHash=layout-v1', {}, cookie);
  assert.equal(resolvedRule.response.status, 200);
  assert.equal(resolvedRule.payload.matched, true);
  assert.equal(resolvedRule.payload.fingerprintChanged, false);
  assert.deepEqual(resolvedRule.payload.rules, genericRules);
  const driftedRule = await request('/autofill/rules/resolve?sourceKey=generic%3Av1&fingerprintHash=layout-v2', {}, cookie);
  assert.equal(driftedRule.response.status, 200);
  assert.equal(driftedRule.payload.fingerprintChanged, true);
  assert.deepEqual(driftedRule.payload.rules, genericRules);
  const genericFallback = await request('/autofill/rules/resolve?url=https%3A%2F%2Funknown.example%2Fresume%2Fedit', {}, cookie);
  assert.equal(genericFallback.response.status, 200);
  assert.equal(genericFallback.payload.matched, false);
  assert.equal(genericFallback.payload.ruleSet, null);

  assert.equal((await request('/profiles/me/autofill-context')).response.status, 401);
  assert.equal((await request('/profiles/me/export')).response.status, 401);

  const aiResume = await request('/ai/resume/parse', { method: 'POST', body: JSON.stringify({ filename: 'resume.txt', content: '# 测试简历', requestId: 'integration-resume' }) }, cookie);
  assert.equal(aiResume.response.status, 200);
  assert.equal(aiResume.payload.attempts.length, 3);
  assert.equal(aiResume.payload.attempts.at(-1).tier, 'official');
  const aiAutofill = await request('/ai/autofill/suggestions', { method: 'POST', body: JSON.stringify({ fields: ['姓名'], profile: { name: '集成测试用户' }, requestId: 'integration-autofill' }) }, cookie);
  assert.equal(aiAutofill.response.status, 200);
  assert.equal(Array.isArray(aiAutofill.payload.data.suggestions), true);
  const aiVision = await request('/ai/vision/extract', { method: 'POST', body: JSON.stringify({ images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }], requestId: 'integration-vision' }) }, cookie);
  assert.equal(aiVision.response.status, 200);
  assert.equal(aiVision.payload.attempts[0].capability, 'vision');

  const profile = await request('/profiles/me', { method: 'PATCH', body: JSON.stringify({ profile: { name: '集成测试用户' } }) }, cookie);
  assert.equal(profile.response.status, 200);
  const grouped = await request('/profiles/me', { method: 'PATCH', body: JSON.stringify({
    profile: { gender: '男' },
    records: {
      '工作/实习经历': [{ company: '测试公司' }],
      在校经历: [{ title: '协会负责人' }],
      项目经历: [{ name: '测试项目' }],
      获奖经历: [{ name: '测试奖项' }],
      '论文与专利': [{ name: '测试论文' }],
      技能: [{ name: 'TypeScript', kind: 'skill' }],
      语言能力: [{ language: '英语', kind: 'language' }],
      证书信息: [{ name: '测试证书', kind: 'certificate' }],
    },
  }) }, cookie);
  assert.equal(grouped.response.status, 200);
  const education = await request('/profiles/me/educations', json({ school: '测试大学', degree: '硕士', extra: { note: 'fixture', nested: { userId: 'must-not-export' } } }), cookie);
  assert.equal(education.response.status, 201);
  const educationId = education.payload.item.id;
  const saved = await request('/profiles/me', {}, cookie);
  assert.equal(saved.payload.profile.name, '集成测试用户');
  assert.equal(saved.payload.educations.length, 1);
  assert.equal(saved.payload.experiences.length, 1);
  assert.equal(saved.payload.campusExperiences.length, 1);
  assert.equal(saved.payload.projects.length, 1);
  assert.equal(saved.payload.awards.length, 1);
  assert.equal(saved.payload.publications.length, 1);
  assert.equal(saved.payload.skills.length, 1);
  assert.equal(saved.payload.languages.length, 1);
  assert.equal(saved.payload.certificates.length, 1);

  const autofillContext = await request('/profiles/me/autofill-context', {}, cookie);
  assert.equal(autofillContext.response.status, 200);
  assert.equal(autofillContext.payload.schemaVersion, 'resume.autofill.v1');
  assert.match(autofillContext.payload.profileVersion, /^[a-f0-9]{64}$/);
  assert.match(autofillContext.payload.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(autofillContext.payload.profile.email, email);
  assert.equal('userId' in autofillContext.payload.profile, false);
  assert.equal(autofillContext.payload.records.some((record) => record.recordType === 'education' && record.fields.school === '测试大学'), true);
  assert.equal(autofillContext.payload.records.some((record) => record.recordType === 'experience' && record.fields.company === '测试公司'), true);
  assert.equal(autofillContext.payload.records.every((record) => record.id && record.recordType && Number.isInteger(record.index) && !('userId' in record.fields) && !('id' in record.fields)), true);

  const exported = await request('/profiles/me/export', {}, cookie);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get('content-disposition') || '', /autofill-context\.json/);
  assert.match(exported.response.headers.get('content-type') || '', /application\/json/);
  assert.equal(exported.payload.schemaVersion, 'resume.autofill.v1');
  assert.equal(exported.payload.profileVersion, autofillContext.payload.profileVersion);
  const exportedEducation = exported.payload.records.find((record) => record.recordType === 'education');
  assert.equal(exportedEducation.extra.nested.userId, undefined);

  const extensionLogin = await request('/auth/extension/login', json({ email, password }));
  assert.equal(extensionLogin.response.status, 200);
  const extensionContext = await request('/profiles/me/autofill-context', { headers: { authorization: `Bearer ${extensionLogin.payload.accessToken}` } });
  assert.equal(extensionContext.response.status, 200);
  assert.equal(extensionContext.payload.profileVersion, autofillContext.payload.profileVersion);

  const fakeResumePath = process.env.FAKE_RESUME_PATH || '/Users/dp/Downloads/fake_resume.txt';
  const resumeContent = existsSync(fakeResumePath) ? readFileSync(fakeResumePath, 'utf8') : '# 测试简历\n姓名：集成测试用户';
  const resume = await request('/profiles/me/resume', { method: 'POST', body: JSON.stringify({ filename: 'fake_resume.txt', contentType: 'text/plain', content: resumeContent }) }, cookie);
  assert.equal(resume.response.status, 201);
  assert.equal(resume.payload.resume.filename, 'fake_resume.txt');
  const resumeMeta = await request('/profiles/me/resume', {}, cookie);
  assert.equal(resumeMeta.payload.resume.filename, 'fake_resume.txt');
  assert.equal('content' in resumeMeta.payload.resume, false);

  await request('/auth/register', json({ email: secondEmail, password }));
  const secondLogin = await request('/auth/login', json({ email: secondEmail, password }));
  const secondCookie = sessionCookie(secondLogin.response);
  const isolated = await request('/profiles/me', {}, secondCookie);
  assert.equal(isolated.payload.educations.length, 0);
  const isolatedContext = await request('/profiles/me/autofill-context', {}, secondCookie);
  assert.equal(isolatedContext.payload.records.length, 0);
  assert.notEqual(isolatedContext.payload.profile.email, email);
  assert.equal((await request(`/profiles/me/educations/${educationId}`, { method: 'DELETE' }, secondCookie)).response.status, 404);

  assert.equal((await request(`/profiles/me/educations/${educationId}`, { method: 'DELETE' }, cookie)).response.status, 200);
  assert.equal((await request('/profiles/me', {}, cookie)).payload.educations.length, 0);
  assert.equal((await request(`/profiles/me/educations/${educationId}/restore`, json({}), cookie)).response.status, 200);
  assert.equal((await request('/profiles/me', {}, cookie)).payload.educations.length, 1);
  console.log('API integration checks passed');
} finally {
  await prisma.$disconnect();
  api.kill('SIGTERM');
}
