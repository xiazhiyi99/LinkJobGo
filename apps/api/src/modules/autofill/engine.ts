export { createMappingService } from './core/index.js';
export { createAiResolver } from './ai/index.js';
export { createSiteRegistry } from './sites/registry.js';
import { createSiteRegistry } from './sites/registry.js';
import { meituanParser } from './sites/meituan/parser.js';
import { tencentParser } from './sites/tencent/parser.js';
import { alibabaParser } from './sites/alibaba/parser.js';
import { mokaDraftParser } from './sites/moka/parser.js';
import { bytedanceParser } from './sites/bytedance/parser.js';

export function createConfiguredSiteRegistry({ mokaMode = 'off' }: { mokaMode?: string } = {}) {
  if (!['off', 'candidate', 'enabled'].includes(mokaMode)) throw new Error('Invalid Moka rules mode');
  return createSiteRegistry([meituanParser, tencentParser, alibabaParser, bytedanceParser, ...(mokaMode === 'off' ? [] : [mokaDraftParser])]);
}
