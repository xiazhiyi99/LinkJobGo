export interface RegisteredSiteRoute { kind: 'exact' | 'regex'; path: string; flags?: string; hashRoute?: string; tenant?: string }
export interface RegisteredSiteRule { id: string; name: string; version: string; origins: string[]; mode: 'off' | 'candidate' | 'enabled'; registered: boolean; routes: RegisteredSiteRoute[] }
export interface SiteRulesCatalog { source: 'code'; generatedAt: string; sites: RegisteredSiteRule[] }
export const isAdminAccount = (account: { role?: string } | null | undefined) => account?.role === 'admin';
export function filterSiteRules(sites: RegisteredSiteRule[], query: string, status: 'all' | 'registered' | 'off' = 'all') {
  const needle = query.trim().toLocaleLowerCase();
  return sites.filter(site => (status === 'all' || site.registered === (status === 'registered')) && (!needle || [site.name, site.id, site.version, ...site.origins, ...site.routes.flatMap(route => [route.path, route.hashRoute ?? '', route.tenant ?? ''])].join('\n').toLocaleLowerCase().includes(needle)));
}
export function routeLabel(route: RegisteredSiteRoute) {
  return route.kind === 'regex' ? `/${route.path}/${route.flags ?? ''}` : route.path;
}
