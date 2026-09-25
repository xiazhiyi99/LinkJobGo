const crypto = require('node:crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

const authError = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const validEmail = (email) => /^\S+@\S+\.\S+$/.test(email);

function createEmailCodeService({ prisma, sendMail, verifyCaptcha, secret, production = false, now = () => new Date() }) {
  if (!secret) {
    const unavailable = async () => { throw authError('邮箱验证码服务未配置', 503, 'EMAIL_CODE_NOT_CONFIGURED'); };
    return { request: unavailable, validate: unavailable, consume: unavailable };
  }
  const digest = (value) => crypto.createHmac('sha256', secret).update(value).digest('hex');
  const codeHash = (id, email, code) => digest(`${id}:${email}:${code}`);

  const request = async ({ email: rawEmail, captcha, ip }) => {
    const email = normalizeEmail(rawEmail);
    if (!validEmail(email)) throw authError('请输入有效邮箱');
    await verifyCaptcha(captcha, { ip });

    const current = now();
    const ipHash = digest(`ip:${ip || 'unknown'}`);
    const recent = await prisma.emailCode.findFirst({ where: { email, purpose: 'register' }, orderBy: { createdAt: 'desc' } });
    if (recent && current.getTime() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw authError('发送过于频繁，请稍后再试', 429);
    }
    const since = new Date(current.getTime() - DAILY_WINDOW_MS);
    const [emailCount, ipCount] = await Promise.all([
      prisma.emailCode.count({ where: { email, purpose: 'register', createdAt: { gte: since } } }),
      prisma.emailCode.count({ where: { requestIpHash: ipHash, createdAt: { gte: since } } }),
    ]);
    if (emailCount >= 10 || ipCount >= 30) throw authError('发送次数过多，请明天再试', 429);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return { message: '如果邮箱可用于注册，验证码将发送到该邮箱。' };

    const id = crypto.randomUUID();
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await prisma.$transaction([
      prisma.emailCode.updateMany({ where: { email, purpose: 'register', usedAt: null }, data: { usedAt: current } }),
      prisma.emailCode.create({ data: {
        id, email, purpose: 'register', codeHash: codeHash(id, email, code),
        expiresAt: new Date(current.getTime() + CODE_TTL_MS), requestIpHash: ipHash,
      } }),
    ]);
    try {
      await sendMail({ to: email, subject: '领客邮箱验证码', text: `你的领客注册验证码是 ${code}，10 分钟内有效。请勿将验证码告诉他人。` });
    } catch (error) {
      await prisma.emailCode.update({ where: { id }, data: { usedAt: now() } });
      throw authError('验证码暂时无法发送，请稍后重试', 503);
    }
    return { message: '验证码已发送，10 分钟内有效。', ...(production ? {} : { debugCode: code }) };
  };

  const validate = async ({ email: rawEmail, code }) => {
    const email = normalizeEmail(rawEmail);
    if (!validEmail(email) || !/^\d{6}$/.test(String(code || ''))) throw authError('邮箱验证码无效或已过期');
    const record = await prisma.emailCode.findFirst({
      where: { email, purpose: 'register', usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.expiresAt <= now() || record.attempts >= 5) throw authError('邮箱验证码无效或已过期');
    const actual = Buffer.from(codeHash(record.id, email, code), 'hex');
    const expected = Buffer.from(record.codeHash, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      await prisma.emailCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw authError('邮箱验证码不正确');
    }
    return record;
  };

  const consume = async ({ email, code }) => {
    const record = await validate({ email, code });
    const result = await prisma.emailCode.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now() },
    });
    if (!result.count) throw authError('邮箱验证码无效或已过期');
    return record;
  };

  return { request, validate, consume };
}

module.exports = { createEmailCodeService, normalizeEmail, validEmail };
