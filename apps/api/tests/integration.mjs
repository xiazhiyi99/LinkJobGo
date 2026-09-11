import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const port = 3201;
const base = `http://127.0.0.1:${port}`;
const api = spawn(process.execPath, ['src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, API_PORT: String(port), DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/job_assistant_dev' },
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
  const education = await request('/profiles/me/educations', json({ school: '测试大学', degree: '硕士' }), cookie);
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
  assert.equal(saved.payload.skills.length, 3);

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
  assert.equal((await request(`/profiles/me/educations/${educationId}`, { method: 'DELETE' }, secondCookie)).response.status, 404);

  assert.equal((await request(`/profiles/me/educations/${educationId}`, { method: 'DELETE' }, cookie)).response.status, 200);
  assert.equal((await request('/profiles/me', {}, cookie)).payload.educations.length, 0);
  assert.equal((await request(`/profiles/me/educations/${educationId}/restore`, json({}), cookie)).response.status, 200);
  assert.equal((await request('/profiles/me', {}, cookie)).payload.educations.length, 1);
  console.log('API integration checks passed');
} finally {
  api.kill('SIGTERM');
}
