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
  const definitions = [meituanParser, tencentParser, alibabaParser, bytedanceParser, mokaDraftParser].map(parser => ({ parser, mode: parser.id === 'moka' ? mokaMode : 'enabled' }));
  return {
    ...createSiteRegistry(definitions.filter(({ mode }) => mode !== 'off').map(({ parser }) => parser)),
    // The same definitions drive dispatch and this read-only operator view.
    list() {
      return definitions.map(({ parser, mode }) => ({
        id: parser.id, name: parser.name, version: parser.version, origins: [...parser.origins], mode, registered: mode !== 'off',
        scope: parser.scope ?? 'site', provider: parser.provider ?? null, priority: parser.priority ?? 0,
        routes: parser.routes.map(route => ({
          kind: route.path instanceof RegExp ? 'regex' : 'exact',
          path: route.path instanceof RegExp ? route.path.source : route.path,
          ...(route.path instanceof RegExp ? { flags: route.path.flags } : {}),
          ...(route.hashRoute ? { hashRoute: route.hashRoute instanceof RegExp ? route.hashRoute.source : route.hashRoute, hashRouteKind: route.hashRoute instanceof RegExp ? 'regex' : 'exact', ...(route.hashRoute instanceof RegExp ? { hashRouteFlags: route.hashRoute.flags } : {}) } : {}), ...(route.tenant ? { tenant: route.tenant } : {}),
        })),
      }));
    },
  };
}
