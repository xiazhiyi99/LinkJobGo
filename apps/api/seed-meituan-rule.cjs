const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..');
const envPath = path.join(root, '.env');
try {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const seedPath = path.join(root, 'seed', 'autofill-rules', 'meituan-resume-detail.v1.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const prisma = new PrismaClient();
(async () => {
  const data = {
    scope: seed.scope,
    platformKey: seed.platformKey || null,
    sourceKey: seed.sourceKey,
    origin: seed.origin || null,
    pathPattern: seed.pathPattern || null,
    queryPolicy: seed.queryPolicy || 'ignore',
    versionNo: Number(seed.versionNo || 1),
    priority: Number(seed.priority || 0),
    state: seed.state || 'draft',
    health: seed.health || 'review',
    needsReview: seed.needsReview !== false,
    rules: seed.rules,
    fingerprintHash: seed.fingerprintHash || null,
    fingerprintSummary: seed.fingerprintSummary || null,
    publishedAt: seed.state === 'published' ? new Date() : null
  };
  const ruleSet = await prisma.autofillRuleSet.upsert({
    where: { id: seed.id },
    create: { id: seed.id, ...data },
    update: data
  });
  console.log(JSON.stringify({ id: ruleSet.id, sourceKey: ruleSet.sourceKey, versionNo: ruleSet.versionNo, state: ruleSet.state, health: ruleSet.health, needsReview: ruleSet.needsReview }));
})().finally(() => prisma.$disconnect());
