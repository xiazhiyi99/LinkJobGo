import type { ChromeApi, MessageSender } from './chrome.js';

export interface UiPreferences { launcherEnabled: boolean }
export const UI_PREFERENCES_KEY = 'autofillUiPreferences';
export function normalizeUiPreferences(value: unknown): UiPreferences {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { launcherEnabled: typeof saved.launcherEnabled === 'boolean' ? saved.launcherEnabled : true };
}
export function isPreferenceUpdate(message: any, sender: MessageSender, extensionId: string): boolean {
  return message?.type === 'autofill-ui-preferences-changed' && typeof message.preferences?.launcherEnabled === 'boolean'
    && sender.id === extensionId && sender.tab === undefined
    && (sender.url === undefined || sender.url === `chrome-extension://${extensionId}/background.js`);
}
/** UI preferences are device-local; content scripts never read protected storage. */
export function createUiPreferences(api: Pick<ChromeApi, 'storage' | 'tabs'>) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async get(): Promise<UiPreferences> {
      await queue;
      return normalizeUiPreferences((await api.storage.local.get(UI_PREFERENCES_KEY))[UI_PREFERENCES_KEY]);
    },
    set(launcherEnabled: boolean): Promise<UiPreferences> {
      const operation = queue.then(async () => {
        const preferences = { launcherEnabled };
        await api.storage.local.set({ [UI_PREFERENCES_KEY]: preferences });
        // A closed/restricted tab cannot invalidate an already saved choice.
        const tabs = await api.tabs.query({}).catch(() => []);
        await Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(tab => api.tabs.sendMessage(tab.id!, { type: 'autofill-ui-preferences-changed', preferences })));
        return preferences;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
