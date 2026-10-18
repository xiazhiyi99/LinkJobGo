import { normalizeApiPathPrefix } from './api-prefix.js';
declare const __PLATFORM_API_ORIGIN__: string;
declare const __PLATFORM_API_PATH_PREFIX__: string;
declare const __PLATFORM_DEVELOPMENT__: boolean;

export function normalizeApiOrigin(value: string, development: boolean): string {
  const url = new URL(value);
  const local = development && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('invalid-api-origin');
  return url.origin;
}
export const platformConfig = {
  apiOrigin: normalizeApiOrigin(__PLATFORM_API_ORIGIN__, __PLATFORM_DEVELOPMENT__),
  apiPathPrefix: normalizeApiPathPrefix(__PLATFORM_API_PATH_PREFIX__),
  development: __PLATFORM_DEVELOPMENT__,
};
