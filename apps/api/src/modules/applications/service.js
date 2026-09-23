const STATUS_ORDER = { saved: 0, applied: 1, screening: 2, interview: 3, offer: 4, closed: 5 };
const STATUSES = new Set(Object.keys(STATUS_ORDER));
const SOURCES = new Set(['manual', 'extension', 'email']);
const EVENT_TYPES = new Set(['fill.completed', 'application.submitted']);

const text = (value, max = 500) => {
  if (value == null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
};
const dateOrNull = (value) => {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('日期格式无效'), { code: 'INVALID_DATE' });
  return date;
};
const error = (message, code = 'INVALID_APPLICATION', status = 400) => Object.assign(new Error(message), { code, status });
const parseCursor = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed?.id || !parsed?.updatedAt) return null;
    const updatedAt = dateOrNull(parsed.updatedAt);
    return { id: String(parsed.id), updatedAt };
  } catch { throw error('cursor 无效', 'INVALID_CURSOR'); }
};
const encodeCursor = (row) => Buffer.from(JSON.stringify({ id: row.id, updatedAt: row.updatedAt.toISOString() })).toString('base64url');

function applicationPayload(input = {}, { source = 'manual' } = {}) {
  const company = text(input.company, 160);
  const title = text(input.title || input.role, 160);
  if (!company || !title) throw error('company 和 title 不能为空');
  const status = text(input.status, 40) || 'saved';
  if (!STATUSES.has(status)) throw error('status 不合法');
  const normalizedSource = text(input.source, 40) || source;
  if (!SOURCES.has(normalizedSource)) throw error('source 不合法');
  return {
    company,
    title,
    jobUrl: text(input.jobUrl, 1000),
    source: normalizedSource,
    status,
    appliedOn: dateOrNull(input.appliedOn),
    eventStart: dateOrNull(input.eventStart),
    eventEnd: dateOrNull(input.eventEnd),
    assessmentUrl: text(input.assessmentUrl, 1000),
    interviewUrl: text(input.interviewUrl, 1000),
    nextFollowUpAt: dateOrNull(input.nextFollowUpAt),
    nextAction: text(input.nextAction, 500),
    nextActionUrl: text(input.nextActionUrl, 1000),
    notes: text(input.notes, 4000),
  };
}

function publicApplication(row, { includeEvents = false } = {}) {
  if (!row) return null;
  const output = { ...row };
  if (includeEvents && row.events) output.events = row.events;
  return output;
}

function createApplicationService({ prisma }) {
  const ownedApplication = (userId, id) => prisma.application.findFirst({ where: { id: String(id), userId } });

  async function create(userId, input = {}) {
    const data = applicationPayload(input);
    const idempotencyKey = text(input.idempotencyKey, 200);
    if (idempotencyKey) {
      const existing = await prisma.application.findFirst({ where: { userId, idempotencyKey } });
      if (existing) return publicApplication(existing);
    }
    try {
      return publicApplication(await prisma.$transaction(async (tx) => tx.application.create({ data: { userId, ...data, idempotencyKey } })));
    } catch (caught) {
      if (idempotencyKey && caught?.code === 'P2002') {
        const existing = await prisma.application.findFirst({ where: { userId, idempotencyKey } });
        if (existing) return publicApplication(existing);
      }
      throw caught;
    }
  }

  async function list(userId, query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const cursor = parseCursor(query.cursor);
    const where = { userId };
    if (query.status && STATUSES.has(String(query.status))) where.status = String(query.status);
    if (query.q) {
      const q = String(query.q).trim();
      if (q) where.OR = [{ company: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }];
    }
    const from = dateOrNull(query.from);
    const to = dateOrNull(query.to);
    if (from || to) where.updatedAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (cursor) where.AND = [{ OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] }];
    const rows = await prisma.application.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => publicApplication(row));
    return { items, nextCursor: hasMore ? encodeCursor(rows[limit - 1]) : null };
  }

  async function get(userId, id) {
    const row = await prisma.application.findFirst({ where: { id: String(id), userId }, include: { events: { orderBy: { occurredAt: 'desc' } }, tasks: { orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] }, mailMessages: { select: { id: true, subject: true, receivedAt: true, providerMessageId: true }, orderBy: { receivedAt: 'desc' }, take: 20 } } });
    if (!row) throw error('投递记录不存在', 'APPLICATION_NOT_FOUND', 404);
    return publicApplication(row, { includeEvents: true });
  }

  async function update(userId, id, input = {}) {
    const version = Number(input.version);
    if (!Number.isInteger(version)) throw error('version 必须是整数', 'VERSION_REQUIRED');
    const current = await ownedApplication(userId, id);
    if (!current) throw error('投递记录不存在', 'APPLICATION_NOT_FOUND', 404);
    if (current.version !== version) throw error('记录已被更新，请刷新后重试', 'VERSION_CONFLICT', 409);
    const next = {};
    for (const key of ['company', 'title', 'jobUrl', 'assessmentUrl', 'interviewUrl', 'nextAction', 'nextActionUrl', 'notes']) if (input[key] !== undefined) next[key] = text(input[key], key === 'notes' ? 4000 : 1000);
    for (const key of ['appliedOn', 'eventStart', 'eventEnd', 'nextFollowUpAt']) if (input[key] !== undefined) next[key] = dateOrNull(input[key]);
    if (input.status !== undefined) {
      if (!STATUSES.has(String(input.status))) throw error('status 不合法');
      next.status = String(input.status);
    }
    if (!Object.keys(next).length) return publicApplication(current);
    next.version = { increment: 1 };
    next.isUserEdited = true;
    const result = await prisma.application.updateMany({ where: { id: String(id), userId, version }, data: next });
    if (!result.count) throw error('记录已被更新，请刷新后重试', 'VERSION_CONFLICT', 409);
    return publicApplication(await ownedApplication(userId, id));
  }

  async function addEvent(userId, id, input = {}) {
    const application = await ownedApplication(userId, id);
    if (!application) throw error('投递记录不存在', 'APPLICATION_NOT_FOUND', 404);
    const type = text(input.type, 60);
    if (!EVENT_TYPES.has(type)) throw error('事件类型不支持');
    const clientEventId = text(input.clientEventId, 200);
    if (!clientEventId) throw error('clientEventId 不能为空');
    const occurredAt = dateOrNull(input.occurredAt) || new Date();
    return publicApplication(await prisma.$transaction(async (tx) => {
      const duplicate = await tx.applicationEvent.findUnique({ where: { userId_clientEventId: { userId, clientEventId } } });
      if (duplicate) return tx.application.findUnique({ where: { id: application.id } });
      const metadata = input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {};
      if (input.fillRunId) metadata.fillRunId = text(input.fillRunId, 200);
      await tx.applicationEvent.create({ data: { userId, applicationId: application.id, type, clientEventId, source: text(input.source, 40), occurredAt, metadata: Object.keys(metadata).length ? metadata : undefined } });
      const patch = {};
      if (type === 'application.submitted' && STATUS_ORDER[application.status] < STATUS_ORDER.applied && !application.isUserEdited) { patch.status = 'applied'; patch.appliedOn = occurredAt; }
      if (Object.keys(patch).length) { patch.version = { increment: 1 }; await tx.application.update({ where: { id: application.id }, data: patch }); }
      return tx.application.findUnique({ where: { id: application.id } });
    }));
  }

  async function createTask(userId, applicationId, input = {}) {
    if (applicationId) { const app = await ownedApplication(userId, applicationId); if (!app) throw error('投递记录不存在', 'APPLICATION_NOT_FOUND', 404); }
    const title = text(input.title, 300); if (!title) throw error('任务标题不能为空');
    const idempotencyKey = text(input.idempotencyKey, 200);
    if (idempotencyKey) {
      const existing = await prisma.task.findFirst({ where: { userId, idempotencyKey } });
      if (existing) return existing;
    }
    try {
      return await prisma.task.create({ data: { userId, applicationId: applicationId || null, title, kind: text(input.kind, 40) || 'follow_up', status: text(input.status, 40) || 'open', dueAt: dateOrNull(input.dueAt), url: text(input.url, 1000), source: text(input.source, 40) || 'manual', idempotencyKey } });
    } catch (caught) {
      if (idempotencyKey && caught?.code === 'P2002') return prisma.task.findFirst({ where: { userId, idempotencyKey } });
      throw caught;
    }
  }

  async function listTasks(userId, query = {}) {
    const where = { userId };
    if (query.status) where.status = String(query.status);
    if (query.applicationId) {
      const application = await ownedApplication(userId, query.applicationId);
      if (!application) throw error('投递记录不存在', 'APPLICATION_NOT_FOUND', 404);
      where.applicationId = String(query.applicationId);
    }
    return { items: await prisma.task.findMany({ where, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], take: Math.min(Math.max(Number(query.limit) || 100, 1), 100) }) };
  }

  async function updateTask(userId, id, input = {}) {
    const data = {};
    for (const key of ['title', 'kind', 'status', 'url']) if (input[key] !== undefined) data[key] = text(input[key], key === 'title' ? 300 : 1000);
    if (input.dueAt !== undefined) data.dueAt = dateOrNull(input.dueAt);
    const result = await prisma.task.updateMany({ where: { id: String(id), userId }, data });
    if (!result.count) throw error('任务不存在', 'TASK_NOT_FOUND', 404);
    return prisma.task.findFirst({ where: { id: String(id), userId } });
  }

  async function calendar(userId, query = {}) {
    const from = dateOrNull(query.from) || new Date(Date.now() - 30 * 86400000);
    const to = dateOrNull(query.to) || new Date(Date.now() + 90 * 86400000);
    const [applications, tasks] = await Promise.all([
      prisma.application.findMany({ where: { userId, eventStart: { gte: from, lte: to } }, orderBy: { eventStart: 'asc' } }),
      prisma.task.findMany({ where: { userId, dueAt: { gte: from, lte: to } }, orderBy: { dueAt: 'asc' } }),
    ]);
    return { items: [...applications.map((item) => ({ type: 'application', id: item.id, title: `${item.company} · ${item.title}`, start: item.eventStart, end: item.eventEnd, status: item.status, applicationId: item.id })), ...tasks.map((item) => ({ type: 'task', id: item.id, title: item.title, start: item.dueAt, end: item.dueAt, status: item.status, applicationId: item.applicationId }))].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()) };
  }

  // Worker-facing bridge for a classified message. It is intentionally a
  // service call rather than an HTTP self-request so user isolation and the
  // mail/application link are committed in one transaction.
  async function upsertFromMail(userId, mailMessageId, parsed = {}) {
    const company = text(parsed.company, 160);
    const title = text(parsed.title || parsed.role, 160);
    if (!company || !title) return null;
    const result = await prisma.$transaction(async (tx) => {
      const message = await tx.mailMessage.findFirst({ where: { id: String(mailMessageId), userId } });
      if (!message) throw error('邮件不存在', 'MAIL_MESSAGE_NOT_FOUND', 404);
      let application = message.applicationId ? await tx.application.findFirst({ where: { id: message.applicationId, userId } }) : null;
      if (!application) application = await tx.application.findFirst({ where: { userId, company, title } });
      const parsedStatus = STATUSES.has(String(parsed.status)) ? String(parsed.status) : 'saved';
      const patch = {};
      for (const [key, value] of [['jobUrl', text(parsed.jobUrl, 1000)], ['assessmentUrl', text(parsed.assessmentUrl, 1000)], ['interviewUrl', text(parsed.interviewUrl, 1000)]]) if (value) patch[key] = value;
      for (const [key, value] of [['appliedOn', parsed.appliedOn], ['eventStart', parsed.eventStart], ['eventEnd', parsed.eventEnd]]) if (value) patch[key] = dateOrNull(value);
      if (!application) application = await tx.application.create({ data: { userId, company, title, source: 'email', status: parsedStatus, idempotencyKey: `mail:${message.id}`, ...patch } });
      else if (!application.isUserEdited) {
        if (STATUS_ORDER[parsedStatus] > STATUS_ORDER[application.status]) patch.status = parsedStatus;
        application = await tx.application.update({ where: { id: application.id }, data: patch });
      }
      await tx.mailMessage.update({ where: { id: message.id }, data: { applicationId: application.id } });
      return application;
    });
    return publicApplication(result);
  }

  return { create, list, get, update, addEvent, createTask, listTasks, updateTask, calendar, upsertFromMail, applicationPayload };
}

module.exports = { createApplicationService, applicationPayload, STATUS_ORDER, STATUSES, SOURCES };
