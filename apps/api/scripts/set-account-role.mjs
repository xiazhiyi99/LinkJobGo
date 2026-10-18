// Local operator command; no public endpoint accepts client-provided roles.
import { PrismaClient } from '@prisma/client';
const [email, role] = process.argv.slice(2);
if (!email || !['admin', 'user'].includes(role) || process.argv.length !== 4) {
  console.error('Usage: node scripts/set-account-role.mjs <email> <admin|user>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) throw new Error('Explicit DATABASE_URL is required');
const prisma = new PrismaClient();
try {
  const account = await prisma.user.update({ where: { email: email.trim().toLowerCase() }, data: { role }, select: { id: true, role: true } });
  console.log(JSON.stringify(account));
} finally { await prisma.$disconnect(); }
