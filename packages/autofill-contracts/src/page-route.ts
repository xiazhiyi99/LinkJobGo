/** Public path-shaped fragment only; raw fragments and fragment queries stay local. */
export function isHashRoute(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 && /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/.test(value) && !value.split('/').some(segment => segment === '.' || segment === '..');
}

export function readHashRoute(hash: string): string | undefined {
  if (!hash.startsWith('#/')) return undefined;
  const query = hash.indexOf('?');
  const route = hash.slice(1, query < 0 ? undefined : query);
  return isHashRoute(route) ? route : undefined;
}
