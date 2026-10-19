export interface MessageSender { id?: string; tab?: { id?: number }; url?: string; origin?: string; frameId?: number; documentId?: string }
export interface ChromeApi {
  runtime: { id: string; lastError?: { message?: string }; getURL(path: string): string; sendMessage(message: unknown): Promise<any>; onMessage: { addListener(listener: (message: any, sender: MessageSender, respond: (value: unknown) => void) => boolean | void): void; removeListener(listener: (message: any, sender: MessageSender, respond: (value: unknown) => void) => boolean | void): void } };
  storage: { local: { setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>; get(key: string): Promise<Record<string, unknown>>; set(value: Record<string, unknown>): Promise<void> } };
  tabs: { create(options: { url: string }): Promise<unknown>; query(query: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number }>>; sendMessage(tabId: number, message: unknown): Promise<any> };
}
export const extension = (globalThis as unknown as { chrome: ChromeApi }).chrome;
