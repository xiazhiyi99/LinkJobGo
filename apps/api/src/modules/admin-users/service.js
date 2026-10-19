const { accountRole } = require('../../auth/roles');

class AdminUsersError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const reject = (code, message, status) => { throw new AdminUsersError(code, message, status); };
const requireAdmin = actor => { if (!actor?.id || accountRole(actor) !== 'admin') reject('ADMIN_REQUIRED', '仅管理员可管理用户', 403); };
const submittedWhere = { OR: [{ status: { in: ['applied', 'screening', 'interview', 'offer'] } }, { appliedOn: { not: null } }, { events: { some: { type: 'application.submitted' } } }] };
const identitySelect = { id: true, email: true, role: true, createdAt: true, emailVerifiedAt: true, profile: { select: { name: true } } };
const publicUser = row => ({ id: row.id, email: row.email, name: row.profile?.name || null, role: accountRole(row), createdAt: row.createdAt.toISOString(), emailVerified: Boolean(row.emailVerifiedAt) });

function websiteHost(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? parsed.hostname.toLowerCase().replace(/\.$/, '') : null;
  } catch { return null; }
}

function parseUsersQuery(query = {}) {
  const q = String(query.q ?? '').trim();
  const role = String(query.role ?? 'all');
  const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 25);
  if (q.length > 120 || !['all', 'admin', 'user'].includes(role) || !Number.isSafeInteger(page) || page < 1 || page > 100000 || ![10, 25, 50].includes(pageSize)) reject('INVALID_USERS_QUERY', '搜索或分页参数无效', 400);
  return { q, role, page, pageSize };
}

function createAdminUsersService({ prisma, onRoleChange = () => {} }) {
  return {
    async list(actor, query) {
      requireAdmin(actor);
      const { q, role, page, pageSize } = parseUsersQuery(query);
      const where = { ...(role === 'admin' ? { role: 'admin' } : role === 'user' ? { role: { not: 'admin' } } : {}), ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { profile: { is: { name: { contains: q, mode: 'insensitive' } } } }] } : {}) };
      const [total, rows] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({ where, select: { ...identitySelect, _count: { select: { applications: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      const summaries = new Map(rows.map(row => [row.id, { submittedCount: 0, websites: new Map(), missingWebsiteCount: 0, lastApplicationAt: null }]));
      if (rows.length) {
        // Aggregate the current page only. Never fetch résumé contents or pass
        // job URLs (query tokens, paths, credentials) through to the admin UI.
        const grouped = await prisma.application.groupBy({ by: ['userId', 'jobUrl'], where: { userId: { in: rows.map(row => row.id) }, ...submittedWhere }, _count: { _all: true }, _max: { updatedAt: true } });
        for (const group of grouped) {
          const summary = summaries.get(group.userId);
          if (!summary) continue;
          const count = group._count._all, host = websiteHost(group.jobUrl);
          summary.submittedCount += count;
          if (host) summary.websites.set(host, (summary.websites.get(host) ?? 0) + count);
          else summary.missingWebsiteCount += count;
          const latest = group._max.updatedAt;
          if (latest && (!summary.lastApplicationAt || latest > summary.lastApplicationAt)) summary.lastApplicationAt = latest;
        }
      }
      return { page, pageSize, total, items: rows.map(row => {
        const summary = summaries.get(row.id);
        return { ...publicUser(row), applicationCount: row._count.applications, submittedCount: summary.submittedCount, websites: [...summary.websites].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([host, count]) => ({ host, count })), missingWebsiteCount: summary.missingWebsiteCount, lastApplicationAt: summary.lastApplicationAt?.toISOString() ?? null };
      }) };
    },
    async changeRole(actor, targetId, input) {
      requireAdmin(actor);
      if (typeof targetId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(targetId)) reject('INVALID_USER_ID', '用户标识无效', 400);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['role', 'expectedRole'].includes(key)) || !['admin', 'user'].includes(input.role) || !['admin', 'user'].includes(input.expectedRole)) reject('INVALID_ROLE_CHANGE', '仅支持管理员和普通用户权限，请刷新后重试', 400);
      if (actor.id === targetId) reject('CANNOT_CHANGE_SELF_ROLE', '不能在此修改自己的权限', 409);
      let result;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await prisma.$transaction(async tx => {
            // Recheck the actor inside the same serializable transaction: an
            // account demoted concurrently cannot keep using a stale principal.
            const currentActor = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, role: true } });
            requireAdmin(currentActor);
            const target = await tx.user.findUnique({ where: { id: targetId }, select: identitySelect });
            if (!target) reject('USER_NOT_FOUND', '用户不存在', 404);
            const previousRole = accountRole(target);
            if (previousRole !== input.expectedRole) reject('ROLE_CONFLICT', '该用户权限已变化，请刷新后重试', 409);
            if (previousRole === input.role) return { user: publicUser(target), changed: false };
            if (previousRole === 'admin' && input.role === 'user' && await tx.user.count({ where: { role: 'admin' } }) <= 1) reject('LAST_ADMIN_REQUIRED', '至少需要保留一位管理员', 409);
            const updated = await tx.user.update({ where: { id: targetId }, data: { role: input.role }, select: identitySelect });
            return { user: publicUser(updated), changed: true, previousRole };
          }, { isolationLevel: 'Serializable' });
          break;
        } catch (error) {
          if (error?.code !== 'P2034') throw error;
          if (attempt >= 2) reject('ROLE_CONFLICT', '权限正在被其他管理员修改，请刷新后重试', 409);
        }
      }
      if (result.changed) onRoleChange({ type: 'admin.user.role.changed', actorUserId: actor.id, targetUserId: targetId, previousRole: result.previousRole, role: result.user.role, occurredAt: new Date().toISOString() });
      return { user: result.user, changed: result.changed };
    },
  };
}

module.exports = { createAdminUsersService, AdminUsersError, websiteHost, parseUsersQuery };
