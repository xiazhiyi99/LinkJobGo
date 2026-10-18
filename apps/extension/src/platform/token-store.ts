export interface Account { id: string; email: string; emailVerified: boolean }
export interface Session { apiOrigin: string; apiPathPrefix?: string; accessToken: string; expiresAt: number; user: Account; needsLogin?: boolean }
export interface StoredAuth { revision: string; session?: Session }
export interface StoragePort {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}
const key = 'platformAuth';
export function validSession(value: unknown): value is Session {
  const item = value as Session | undefined;
  return !!item && typeof item.apiOrigin === 'string' && (item.apiPathPrefix === undefined || typeof item.apiPathPrefix === 'string') && typeof item.accessToken === 'string' && !!item.accessToken && item.accessToken.length <= 4096 && !/[\r\n]/.test(item.accessToken) && Number.isFinite(item.expiresAt) && !!item.user && typeof item.user.id === 'string' && !!item.user.id && typeof item.user.email === 'string' && !!item.user.email && typeof item.user.emailVerified === 'boolean' && (item.needsLogin === undefined || typeof item.needsLogin === 'boolean');
}

export function createTokenStore(storage: StoragePort) {
  let restriction: Promise<void> | undefined;
  let queue = Promise.resolve();
  const initialize = () => restriction ??= storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(async () => { await initialize(); return work(); });
    queue = result.then(() => {}, () => {});
    return result;
  };
  const read = async (): Promise<StoredAuth> => {
    const raw = (await storage.get(key))[key] as StoredAuth | undefined;
    if (!raw) return { revision: '' };
    if (typeof raw.revision !== 'string' || (raw.session !== undefined && !validSession(raw.session))) throw new Error('settings-invalid');
    return raw;
  };
  return {
    initialize,
    clear: () => serialized(async () => {
      const previous = await read().catch(() => ({ revision: '' } as StoredAuth));
      await storage.set({ [key]: { revision: crypto.randomUUID() } });
      return previous;
    }),
    read: () => serialized(read),
    // Compare-and-set prevents late login responses/401s from replacing a newer account.
    update: (revision: string, session?: Session) => serialized(async () => {
      const current = await read();
      if (current.revision !== revision) return false;
      if (session && !validSession(session)) throw new Error('settings-invalid');
      await storage.set({ [key]: { revision: crypto.randomUUID(), ...(session ? { session } : {}) } });
      return true;
    }),
  };
}
export type TokenStore = ReturnType<typeof createTokenStore>;
