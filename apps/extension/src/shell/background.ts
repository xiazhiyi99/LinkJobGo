import { PROTOCOL_VERSION, type ApiResult } from '@job-assistant/autofill-contracts';
import { extension, type ChromeApi, type MessageSender } from './chrome.js';
import { platformConfig } from '../platform/config.js';
import { createApiClient, PlatformError } from '../platform/api-client.js';
import { createAuthService } from '../platform/auth.js';
import { createUiPreferences } from './preferences.js';

const failure = (requestId: string, code: string): ApiResult<never> => ({ ok: false, requestId, error: { code, message: code, retryable: code === 'backend-unavailable' } });
export function createBackground(api: ChromeApi, config: { apiOrigin: string; apiPathPrefix?: string; loginUrl?: string }) {
  const pending = new Map<string, AbortController>();
  const runAccounts = new Map<string, number>();
  const uiPreferences = createUiPreferences(api);
  let accountGeneration = 0;
  const auth = createAuthService({ apiOrigin: config.apiOrigin, apiPathPrefix: config.apiPathPrefix, api: createApiClient(config), onAccountChange() {
    accountGeneration++;
    for (const controller of pending.values()) controller.abort();
  } });
  void api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
  return async function handleBackgroundRequest(message: unknown, sender: MessageSender): Promise<unknown> {
    if (!message || typeof message !== 'object' || sender.id !== api.runtime.id) return failure('', 'invalid-message-source');
    const data = message as Record<string, any>;
    const popup = sender.url === `chrome-extension://${api.runtime.id}/popup.html` && (!sender.origin || sender.origin === `chrome-extension://${api.runtime.id}`) && sender.tab === undefined;
    const trustedContent = sender.tab?.id !== undefined && sender.frameId === 0 && typeof sender.documentId === 'string' && /^https?:/.test(sender.url ?? '');
    let requestId = '';
    try {
      if (data.type === 'autofill-ui-preferences-get' && (popup || trustedContent)) return { ok: true, preferences: await uiPreferences.get() };
      if (data.type === 'autofill-ui-preferences-set' && popup && typeof data.launcherEnabled === 'boolean') return { ok: true, preferences: await uiPreferences.set(data.launcherEnabled) };
      if (data.type === 'autofill-auth-status' && popup) return await auth.status();
      if (data.type === 'autofill-open-login' && popup) {
        await api.tabs.create({ url: config.loginUrl ?? new URL('/login', config.apiOrigin).href });
        return { ok: true };
      }
      if (data.type === 'autofill-debug-permission' && (popup || trustedContent)) {
        const status = await auth.status();
        return { allowed: status.authenticated && status.capabilities.extensionDebug === true };
      }
      if (data.type === 'autofill-settings-load' && trustedContent) {
        const status = await auth.status();
        return { authenticated: status.authenticated, state: status.state };
      }
      if (!trustedContent) return failure('', 'invalid-message-source');
      const documentKey = `${sender.tab!.id}:${sender.documentId}`;
      if (data.type === 'autofill-cancel-request' && typeof data.requestId === 'string') {
        pending.get(`${documentKey}:${data.requestId}`)?.abort(); return { ok: true };
      }
      if (data.type !== 'autofill-request' || !['readiness', 'analyze', 'plan'].includes(data.operation) || !data.input || data.input.protocolVersion !== PROTOCOL_VERSION || !['requestId', 'runId'].every(key => typeof data.input[key] === 'string' && data.input[key].trim() && data.input[key].length <= 128) || !Number.isFinite(data.input.deadlineAt)) return failure('', 'invalid-message');
      requestId = data.input.requestId;
      if (new TextEncoder().encode(JSON.stringify(data.input)).length > 512 * 1024) return failure(requestId, 'request-too-large');
      const key = `${documentKey}:${requestId}`;
      if (pending.has(key)) return failure(requestId, 'duplicate-request');
      const runKey = `${documentKey}:${data.input.runId}`;
      if (runAccounts.has(runKey) && runAccounts.get(runKey) !== accountGeneration) return failure(requestId, 'authentication-required');
      if (runAccounts.size >= 1000 && !runAccounts.has(runKey)) return failure(requestId, 'too-many-runs');
      runAccounts.set(runKey, accountGeneration);
      const controller = new AbortController(); pending.set(key, controller);
      try { return await auth.fill(data.operation, data.input, { signal: controller.signal, deadlineAt: Math.min(data.input.deadlineAt, Date.now() + 45_000) }); }
      finally { pending.delete(key); }
    } catch (error) {
      const code = error instanceof PlatformError ? error.code : 'settings-invalid';
      return failure(requestId, code);
    }
  };
}
if (extension?.runtime?.onMessage) {
  const handle = createBackground(extension, platformConfig);
  extension.runtime.onMessage.addListener((message, sender, respond) => {
    if (!String(message?.type ?? '').startsWith('autofill-')) return;
    void handle(message, sender).then(respond, () => respond(failure('', 'backend-unavailable')));
    return true;
  });
}
