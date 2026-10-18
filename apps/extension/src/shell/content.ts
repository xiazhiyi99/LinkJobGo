import { createPageSession, createSitePageAdapter } from '../page/index.js';
import { createControlDriver, dialogSaveAdapter, createMeituanControlAdapter } from '../controls/index.js';
import { createVerifiedSelectControlAdapter } from '../controls/verified-selects.js';
import { createLeverLocationControlAdapter } from '../controls/lever-location.js';
import { createTencentCityControlAdapter } from '../controls/tencent-city.js';
import { createMokaControlAdapter } from '../controls/moka.js';
import { createRunner } from '../runner/index.js';
import { createMappingClient, createReadinessClient, backgroundTransport, type Transport } from './transport.js';
import { createStartCoordinator } from './coordinator.js';
import { mountLauncher, launcherStartOptions } from './ui.js';
import { extension, type MessageSender } from './chrome.js';
declare const __AUTOFILL_BUILD_ID__: string;
const instanceKey = Symbol.for('resume.next.content.instances');
const contentGlobal = globalThis as unknown as Record<symbol, WeakMap<Document, () => void>>;
const instances = contentGlobal[instanceKey] ??= new WeakMap<Document, () => void>();
export function bootstrapContent({ config = {} }: { config?: { document?: Document; transport?: Transport } } = {}): () => void {
  const doc = config.document ?? document;
  const existing = instances.get(doc); if (existing) return existing;
  const page = createPageSession({ document: doc, siteAdapter: createSitePageAdapter(doc) });
  const controls = createControlDriver({ page, adapters: [dialogSaveAdapter, createMeituanControlAdapter(), createVerifiedSelectControlAdapter(), createLeverLocationControlAdapter(), createTencentCityControlAdapter(), createMokaControlAdapter()] });
  const runner = createRunner({ page, controls, mappingClient: createMappingClient({ transport: config.transport ?? backgroundTransport }) });
  let commandLocation = doc.location.href;
  let commandDocumentId = crypto.randomUUID();
  const currentDocumentId = () => {
    if (doc.location.href !== commandLocation) { commandLocation = doc.location.href; commandDocumentId = crypto.randomUUID(); }
    return commandDocumentId;
  };
  const coordinator = createStartCoordinator({ runner, readinessClient: createReadinessClient({ transport: config.transport ?? backgroundTransport }), getDocumentId: currentDocumentId });
  const root = doc.createElement('div'); root.id = 'resume-next-launcher'; root.dataset.autofillExclude = 'true'; root.dataset.extensionId = extension.runtime.id;
  doc.documentElement.append(root);
  const unmount = mountLauncher({ runner: coordinator, root, spriteUrl: extension.runtime.getURL('pet/squirrel-motion.webp') });
  const commandState = () => ({ ...coordinator.getState(), commandDocumentId: currentDocumentId(), supportsCollegeReset: launcherStartOptions(doc.location, true, true).allowCollegeReset === true });
  let collecting = false;
  const listener = (message: any, sender: MessageSender, respond: (value: unknown) => void) => {
    if (sender.id !== extension.runtime.id || sender.url !== `chrome-extension://${extension.runtime.id}/popup.html`) return;
    if (message?.type === 'autofill-state') { respond(commandState()); return; }
    if (message?.type === 'autofill-collect-page') {
      const current = commandState(), intendedDocument = current.commandDocumentId;
      const reject = (code: string) => respond({ ok: false, error: { code } });
      if (message.commandDocumentId !== intendedDocument) { reject('document-changed'); return; }
      if (collecting || current.starting || !['idle', 'completed', 'partial', 'cancelled', 'failed'].includes(current.phase)) { reject('run-in-progress'); return; }
      collecting = true;
      void (async () => {
        try {
          const startedAt = performance.now();
          // Reuse the real scanner without entering readiness, planning or controls.
          const result = await page.scanPage({ deadlineAt: Date.now() + 10_000 });
          if (currentDocumentId() !== intendedDocument) { reject('document-changed'); return; }
          if (result.status !== 'ok') { reject('scan-failed'); return; }
          const data = { buildId: typeof __AUTOFILL_BUILD_ID__ === 'string' ? __AUTOFILL_BUILD_ID__ : 'development', collectedAt: new Date().toISOString(), scanDurationMs: Math.round(performance.now() - startedAt), snapshot: result.value, diagnostics: page.getDiagnostics() };
          if (new TextEncoder().encode(JSON.stringify(data)).length > 512 * 1024) { reject('snapshot-too-large'); return; }
          respond({ ok: true, commandDocumentId: intendedDocument, data });
        } catch { reject('scan-failed'); }
        finally { collecting = false; }
      })();
      return true;
    }
    if (message?.type !== 'autofill-command') return;
    const current = commandState();
    if (message.commandDocumentId !== current.commandDocumentId) { respond({ ...current, commandRejected: 'document-changed' }); return; }
    if (collecting && (message.command === 'start' || message.command === 'resume')) { respond({ ...current, commandRejected: 'scan-in-progress' }); return; }
    if (message.command === 'pause') coordinator.pause();
    else if (message.command === 'cancel') coordinator.cancel();
    else if (message.command === 'start' || message.command === 'resume') void (message.command === 'start' ? coordinator.start(launcherStartOptions(doc.location, message.overwriteExisting === true, message.allowCollegeReset === true)) : coordinator.resume()).catch(() => {});
    respond(commandState());
  };
  extension.runtime.onMessage.addListener(listener);
  const dispose = () => { coordinator.cancel(); coordinator.dispose(); runner.dispose(); controls.dispose(); page.dispose(); unmount(); extension.runtime.onMessage.removeListener(listener); doc.defaultView?.removeEventListener('pagehide', pageHide); instances.delete(doc); };
  // BFCache restores the same Document without reinjecting content scripts.
  // Cancel its work while hidden, but retain the launcher/listener for restore.
  const pageHide = (event: PageTransitionEvent) => { if (!event.isTrusted) return; if (event.persisted) coordinator.cancel(); else dispose(); };
  doc.defaultView?.addEventListener('pagehide', pageHide);
  instances.set(doc, dispose); return dispose;
}
if (typeof document !== 'undefined' && extension?.runtime) bootstrapContent();
