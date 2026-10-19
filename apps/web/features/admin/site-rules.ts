export interface RegisteredSiteRoute { kind: 'exact' | 'regex'; path: string; flags?: string; hashRoute?: string; hashRouteKind?: 'exact' | 'regex'; hashRouteFlags?: string; tenant?: string }
export interface RegisteredSiteRule { id: string; name: string; version: string; origins: string[]; scope: 'site' | 'provider'; provider: string | null; priority: number; mode: 'off' | 'candidate' | 'enabled'; registered: boolean; routes: RegisteredSiteRoute[] }
export interface SiteRulesCatalog { source: 'code'; generatedAt: string; sites: RegisteredSiteRule[] }
export const isAdminAccount = (account: { role?: string } | null | undefined) => account?.role === 'admin';
export function filterSiteRules(sites: RegisteredSiteRule[], query: string, status: 'all' | 'registered' | 'off' = 'all') {
  const needle = query.trim().toLocaleLowerCase();
  return sites.filter(site => (status === 'all' || site.registered === (status === 'registered')) && (!needle || [site.name, site.id, site.version, site.provider ?? '', site.scope === 'provider' ? '服务商通用' : '网站专属', ...site.origins, ...site.routes.flatMap(route => [route.path, route.hashRoute ?? '', route.tenant ?? ''])].join('\n').toLocaleLowerCase().includes(needle)));
}
export function hashRouteLabel(route: RegisteredSiteRoute) {
  return route.hashRouteKind === 'regex' ? `/${route.hashRoute}/${route.hashRouteFlags ?? ''}` : route.hashRoute ?? '';
}
export function routeLabel(route: RegisteredSiteRoute) {
  return route.kind === 'regex' ? `/${route.path}/${route.flags ?? ''}` : route.path;
}
