/** Memory-only, account-scoped read cache. Never persists résumé data in storage. */
export function createProfileCache<T>({ load, now = Date.now }: { load(signal: AbortSignal): Promise<T>; now?: () => number }) {
  let account: string | null = null, value: T | null = null, updatedAt = -Infinity, generation = 0;
  let pending: Promise<T> | undefined, controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const invalidate = () => { generation++; controller?.abort(); pending = undefined; updatedAt = -Infinity; };
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    generation: () => generation,
    setAccount(id: string | null) { if (id === account) return; account = id; invalidate(); value = null; emit(); },
    invalidate,
    update(update: (current: T) => T, expectedGeneration: number) {
      if (expectedGeneration !== generation) return;
      invalidate(); if (value) { value = update(value); emit(); }
    },
    read(fresh = false): Promise<T> {
      if (!account) return Promise.reject(new Error('请先登录。'));
      if (pending) return pending;
      if (!fresh && value && now() - updatedAt < 30_000) return Promise.resolve(value);
      const mine = generation; controller = new AbortController();
      const request = load(controller.signal).then(result => {
        if (mine !== generation) throw new Error('资料所属账号或版本已变化，请重试。');
        value = result; updatedAt = now(); emit(); return result;
      }).finally(() => { if (pending === request) pending = undefined; });
      pending = request; return request;
    },
  };
}
