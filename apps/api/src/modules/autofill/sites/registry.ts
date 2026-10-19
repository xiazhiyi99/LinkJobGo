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
export interface SiteParser {
  id: string;
  name: string;
  version: string;
  origins: readonly string[];
  routes: readonly { path: string | RegExp; hashRoute?: string; tenant?: string }[];
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
  }
  return {
    classify(snapshot: PageSnapshot): SiteClassification {
      const matching = parsers.filter(parser => parser.origins.includes(snapshot.page.origin) && (!parser.ownsPage || parser.ownsPage(snapshot.page)));
      if (matching.length > 1) throw new Error('Conflicting site origins');
      const parser = matching[0];
      return parser ? { kind: 'known', parser, supported: parser.matches(snapshot.page, snapshot) } : { kind: 'unknown' };
    },
  };
}
