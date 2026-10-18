const { randomUUID } = require('node:crypto');
const { PROTOCOL_VERSION } = require('@job-assistant/autofill-contracts');
const { ServiceError, checkDeadline } = require('./errors');

const ROUTES = Object.freeze({
  '/autofill/v2/readiness': 'checkReadiness',
  '/autofill/v2/analyze': 'analyzePage',
  '/autofill/v2/plan': 'buildFillPlan',
});
const metadataKeys = ['protocolVersion', 'requestId', 'runId', 'deadlineAt'];
const requestKeys = {
  checkReadiness: metadataKeys,
  analyzePage: [...metadataKeys, 'snapshot'],
  buildFillPlan: [...metadataKeys, 'snapshot', 'semanticPage', 'optionEvidence', 'scope', 'expectedProfileVersion'],
};
const deadlineError = () => new ServiceError('deadline-exceeded', 'Operation cancelled or deadline exceeded', 504, true);

const waitFor = async (operation, signal) => {
  if (signal.aborted) throw deadlineError();
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(deadlineError());
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { if (signal.aborted) throw deadlineError(); return operation(); }), stopped]); }
  finally { signal.removeEventListener('abort', abort); }
};

const readRequest = (req, signal, maxBytes) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  const cleanup = () => {
    req.off('data', data); req.off('end', end); req.off('error', fail);
    signal.removeEventListener('abort', abort);
  };
  const fail = error => { cleanup(); req.resume(); reject(error); };
  const abort = () => fail(deadlineError());
  const data = chunk => {
    size += chunk.length;
    if (size > maxBytes) return fail(new ServiceError('request-too-large', 'Request exceeds size limit', 413));
    chunks.push(chunk);
  };
  const end = () => {
    cleanup();
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { reject(new ServiceError('invalid-json', 'Invalid JSON')); return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { reject(new ServiceError('invalid-request', 'Request must be an object')); return; }
    resolve(value);
  };
  if (signal.aborted) { abort(); return; }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) { fail(new ServiceError('invalid-request', 'JSON content type required')); return; }
  if (Number(req.headers['content-length']) > maxBytes) { fail(new ServiceError('request-too-large', 'Request exceeds size limit', 413)); return; }
  req.on('data', data); req.on('end', end); req.on('error', fail);
  signal.addEventListener('abort', abort, { once: true });
});

// No listener, environment reads, authentication store or mapping rules here.
const createAutofillHandler = ({ service, authenticate, allowedOrigins = [], maxTimeoutMs = 45_000, maxRequestBytes = 512 * 1024, maxResponseBytes = 1024 * 1024 }) => async (req, res, pathname) => {
  let requestId = randomUUID();
  const controller = new AbortController();
  let deadlineAt = Date.now() + maxTimeoutMs;
  let timer = setTimeout(() => controller.abort(), maxTimeoutMs);
  const cancel = () => controller.abort();
  const close = () => { if (!res.writableEnded) cancel(); };
  req.on('aborted', cancel);
  res.on('close', close);
  const send = (status, result) => {
    if (res.destroyed || res.writableEnded) return;
    const body = JSON.stringify(result);
    if (Buffer.byteLength(body) > maxResponseBytes) throw new ServiceError('response-too-large', 'Response exceeds size limit', 502);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };
  try {
    const origin = req.headers.origin;
    if (origin) {
      if (!allowedOrigins.includes(origin)) throw new ServiceError('origin-denied', 'Origin denied', 403);
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('vary', 'Origin');
    }
    const method = Object.hasOwn(ROUTES, pathname) ? ROUTES[pathname] : null;
    if (!method) throw new ServiceError('not-found', 'Route not found', 404);
    if (req.method === 'OPTIONS' && origin) {
      res.writeHead(204, { 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, authorization, x-autofill-account-id' });
      res.end(); return;
    }
    if (req.method !== 'POST') throw new ServiceError('method-not-allowed', 'POST required', 405);
    const principal = await waitFor(() => authenticate(req), controller.signal);
    if (!principal?.id || !principal?.email) throw new ServiceError('authentication-required', 'Authentication required', 401);
    if (req.headers['x-autofill-account-id'] && req.headers['x-autofill-account-id'] !== principal.id) throw new ServiceError('authentication-required', 'Account changed; start a new run', 401);
    const input = await readRequest(req, controller.signal, maxRequestBytes);
    if (input.protocolVersion !== PROTOCOL_VERSION || !['requestId', 'runId'].every(key => typeof input[key] === 'string' && input[key].trim() && input[key].length <= 128) || !Number.isFinite(input.deadlineAt)) {
      throw new ServiceError('invalid-request', 'Invalid protocol or request metadata');
    }
    requestId = input.requestId;
    if (Object.keys(input).some(key => !requestKeys[method].includes(key))) throw new ServiceError('invalid-request', 'Unexpected request property');
    if (input.expectedProfileVersion !== undefined && (typeof input.expectedProfileVersion !== 'string' || !/^[a-f\d]{64}$/i.test(input.expectedProfileVersion))) throw new ServiceError('invalid-request', 'Invalid expected profile version');
    deadlineAt = Math.min(deadlineAt, input.deadlineAt);
    const ctx = { principal: { id: principal.id, email: principal.email }, requestId, signal: controller.signal, deadlineAt };
    checkDeadline(ctx);
    clearTimeout(timer);
    timer = setTimeout(cancel, Math.max(0, deadlineAt - Date.now()));
    const result = await waitFor(() => service[method](input, ctx), controller.signal);
    checkDeadline(ctx);
    send(200, { ok: true, requestId, data: result });
  } catch (error) {
    const failure = error instanceof ServiceError ? error : new ServiceError('internal-error', 'Autofill service unavailable', 500);
    send(failure.status, { ok: false, requestId, error: { code: failure.code, message: failure.message, retryable: failure.retryable } });
  } finally {
    clearTimeout(timer); req.off('aborted', cancel); res.off('close', close);
  }
};

module.exports = { createAutofillHandler };
