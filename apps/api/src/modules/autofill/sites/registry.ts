import type { PageSnapshot, FieldCatalog, PartialSemanticPage, SourceKey, Value, OptionSnapshot, OptionEvidence, SemanticBinding, ResumeContext, ResumeRecord, FieldSnapshot, FillAssignment, SourceRef } from '@job-assistant/autofill-contracts';

export interface SiteDerivedValue {
  status: 'ready' | 'missing-source' | 'unresolved' | 'unsupported';
  value: Value;
  sourceRefs: SourceRef[];
  reason?: string;
  transform?: FillAssignment['transform'];
}
export interface SiteDerivationInput {
  derivation: NonNullable<SemanticBinding['derivation']>;
  resume: ResumeContext;
  record: ResumeRecord | null;
  field: FieldSnapshot;
}
export interface SiteFormattedValue {
  status: 'ready' | 'unresolved' | 'unsupported';
  value: Value;
  transform: 'identity' | 'date-format';
  reason?: string;
}
export interface SiteRoute {
  path: string | RegExp;
  hashRoute?: string | RegExp;
  tenant?: string;
}
const matchesPart = (pattern: string | RegExp, value: string) => typeof pattern === 'string' ? pattern === value : pattern.test(value);
export const matchesSiteRoute = (route: SiteRoute, page: PageSnapshot['page']) => matchesPart(route.path, page.path) && (route.hashRoute === undefined || page.hashRoute !== undefined && matchesPart(route.hashRoute, page.hashRoute));
export interface SiteParser {
  id: string;
  name: string;
  version: string;
  origins: readonly string[];
  routes: readonly SiteRoute[];
  // Explicit scopes use the declared URL routes as ownership boundaries.
  // Company rules override provider rules; provider rules additionally require
  // compatible control evidence, otherwise unknown-site routing remains available.
  scope?: 'site' | 'provider';
  provider?: string;
  // Shared ATS hosts may own only observed application routes. Omission retains
  // whole-origin identity even when matches rejects a page's current structure.
  ownsPage?(page: PageSnapshot['page']): boolean;
  priority?: number;
  deriveValue?(input: SiteDerivationInput): SiteDerivedValue;
  // Formats an already-present ordinary source without changing its SourceRef.
  formatValue?(input: { sourceKey: SourceKey; sourceValue: Value; field: FieldSnapshot }): SiteFormattedValue;
  allowCustomInput?(input: { sourceKey: SourceKey; sourceValue: Value; field: FieldSnapshot; evidence: OptionEvidence }): boolean;
  includeRecord?(input: { filter: NonNullable<import('@job-assistant/autofill-contracts').SemanticSection['recordFilter']>; record: ResumeRecord }): boolean;
  matches(page: PageSnapshot['page'], snapshot: PageSnapshot): boolean;
  parse(input: { snapshot: PageSnapshot; catalog: FieldCatalog }): PartialSemanticPage;
  resolveOption?(input: { sourceKey: SourceKey; sourceValue: Value; candidates: OptionSnapshot[]; field?: FieldSnapshot }): string | string[] | null;
}
export type SiteClassification = { kind: 'unknown' } | { kind: 'known'; parser: SiteParser; supported: boolean };
export interface SiteRegistry { classify(snapshot: PageSnapshot): SiteClassification }
export function createSiteRegistry(parsers: SiteParser[]) {
  if (new Set(parsers.map(parser => parser.id)).size !== parsers.length) throw new Error('Duplicate site parser id');
  for (const parser of parsers) {
    if (!parser.origins.length || parser.origins.some(origin => new URL(origin).origin !== origin)) throw new Error('Site parser requires exact origins');
    if (parser.priority !== undefined && !Number.isSafeInteger(parser.priority)) throw new Error('Site parser priority must be a safe integer');
    if (parser.scope && !['site', 'provider'].includes(parser.scope) || parser.scope === 'provider' && !parser.provider) throw new Error('Invalid site parser scope or provider');
    for (const route of parser.routes) for (const pattern of [route.path, route.hashRoute]) {
      if (pattern instanceof RegExp && (pattern.global || pattern.sticky)) throw new Error('Site routes must not use stateful regular expressions');
    }
  }
  const rank = (parser: SiteParser) => parser.scope === 'provider' ? 0 : 1;
  const ordered = [...parsers].sort((a, b) => rank(b) - rank(a) || (b.priority ?? 0) - (a.priority ?? 0));
  return {
    classify(snapshot: PageSnapshot): SiteClassification {
      const matching = ordered.filter(parser => parser.origins.includes(snapshot.page.origin)
        && (!parser.scope || parser.routes.some(route => matchesSiteRoute(route, snapshot.page)))
        && (!parser.ownsPage || parser.ownsPage(snapshot.page)));
      for (let index = 0; index < matching.length;) {
        const first = matching[index]!;
        const group: { parser: SiteParser; supported: boolean }[] = [];
        do {
          const parser = matching[index++]!;
          const supported = parser.matches(snapshot.page, snapshot);
          if (parser.scope !== 'provider' || supported) group.push({ parser, supported });
        } while (index < matching.length && rank(matching[index]!) === rank(first) && (matching[index]!.priority ?? 0) === (first.priority ?? 0));
        if (group.length > 1) throw new Error('Conflicting site rules at the same scope and priority');
        if (group[0]) return { kind: 'known', ...group[0] };
      }
      return { kind: 'unknown' };
    },
  };
}
