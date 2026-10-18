/** A build-time deployment path, never supplied by a page or a message. */
export function normalizeApiPathPrefix(value = ''): string {
  if (value === '' || value === '/') return '';
  const prefix = value.replace(/\/$/, '');
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw new Error('invalid-api-path-prefix');
  return prefix;
}
