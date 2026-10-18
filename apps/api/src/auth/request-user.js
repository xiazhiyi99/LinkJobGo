class AuthenticationError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

const createRequestAuthenticator = ({ currentUser, databaseAvailable, verificationRequired }) => async req => {
  if (!databaseAvailable()) throw new AuthenticationError('database-unavailable', '数据库暂不可用，请先启动 PostgreSQL 并执行 Prisma 迁移。', 503);
  const user = await currentUser(req);
  if (!user) throw new AuthenticationError('authentication-required', '未登录', 401);
  if (verificationRequired() && !user.emailVerifiedAt) throw new AuthenticationError('EMAIL_NOT_VERIFIED', '请先验证邮箱', 403);
  return user;
};

module.exports = { AuthenticationError, createRequestAuthenticator };
