import type { SiteAdapter } from '../index.js';
import { createMeituanPageAdapter } from './meituan.js';
import { createTencentPageAdapter } from './tencent.js';
import { createAlibabaPageAdapter } from './alibaba.js';
import { createBytedancePageAdapter } from './bytedance.js';
import { createMokaPageAdapter, isCompatibleMokaDocument } from './moka.js';
/** Choose only the verified résumé origin and pathname, never a substring of an untrusted URL. */
export function createSitePageAdapter(document: Document): SiteAdapter | undefined {
  const { origin, pathname } = document.location;
  if (origin === 'https://zhaopin.meituan.com' && /^\/web\/(?:delivery-confirm|personal-center\/resume-detail)\/?$/.test(pathname)) return createMeituanPageAdapter();
  if (origin === 'https://careers.tencent.com' && /^\/resume\.html$/.test(pathname)) return createTencentPageAdapter();
  if (origin === 'https://campus-talent.alibaba.com' && /^\/personal\/resume\/?$/.test(pathname)) return createAlibabaPageAdapter();
  if (origin === 'https://jobs.bytedance.com' && /^\/campus\/resume\/\d+\/apply\/?$/.test(pathname)) return createBytedancePageAdapter();
  if (isCompatibleMokaDocument(document)) return createMokaPageAdapter();
  return undefined;
}
