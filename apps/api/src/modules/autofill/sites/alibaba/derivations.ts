import type { ResumeRecord, SourceRef } from '@job-assistant/autofill-contracts';
import type { SiteDerivationInput, SiteDerivedValue } from '../registry.js';

const ref = (record: ResumeRecord, field: string): SourceRef => ({ scope: 'record', recordType: record.recordType, recordId: record.id, path: ['fields', field] });
const failure = (status: SiteDerivedValue['status'], reason: string, sourceRefs: SourceRef[] = []): SiteDerivedValue => ({ status, value: null, sourceRefs, reason });
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

// Observed Alibaba labels paired only with explicit, matching source citations.
export const paperVenues = [
  { code: 'CVPR', title: 'IEEE/CVF Conference on Computer Vision and Pattern Recognition', label: 'CVPR（IEEE/CVF Computer Vision and Pattern Recognition Conference）' },
  { code: 'ACL', title: 'Annual Meeting of the Association for Computational Linguistics', label: 'ACL（Annual Meeting of the Association for Computational Linguistics）' },
  { code: 'ICLR', title: 'International Conference on Learning Representations', label: 'ICLR（ICLR International Conference on Learning Representations）' },
  { code: 'EMNLP', title: 'Conference on Empirical Methods in Natural Language Processing', label: 'EMNLP（Conference on Empirical Methods in Natural Language Processing）' },
  { code: 'ICRA', title: 'IEEE International Conference on Robotics and Automation', label: 'ICRA（IEEE International Conference on Robotics and Automation）' },
] as const;
function venueQuery(venue: string): string {
  const normalized = venue.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const known = paperVenues.find(item => normalized === `${item.title} (${item.code})` || normalized === item.code);
  // Copy the explicit abbreviation for search; do not infer it from a title.
  return known?.code ?? venue;
}

/** A deliberately narrow citation grammar; no venue or date is inferred. */
function citationVenue(record: ResumeRecord): string | null {
  const name = text(record.fields.name), description = text(record.fields.description), year = text(record.fields.startDate);
  if (!name || !description || !year || !/^\d{4}$/.test(year) || description.length > 10000) return null;
  const start = description.indexOf(name);
  if (start < 0 || description.indexOf(name, start + name.length) !== -1) return null;
  const tail = description.slice(start + name.length);
  const match = /^(?:\*\*)?\.\s*([^\n]+?),\s*(\d{4})(?=[,，。.]|$)/u.exec(tail);
  if (!match || match[2] !== year) return null;
  const venue = match[1]!.trim();
  return venue && venue.length <= 2000 && !/专利|\bpatent\b/iu.test(venue) ? venue : null;
}

const paperRefs = (record: ResumeRecord): SourceRef[] => [
  { scope: 'record', recordType: 'publication', recordId: record.id, path: ['extra', 'publicationType'] },
  ...['description', 'name', 'startDate'].map(key => ref(record, key)),
];

/** Explicit patent types are never paper records, regardless of citation text. */
export function isAlibabaPaper(record: ResumeRecord): boolean {
  if (record.recordType !== 'publication') return false;
  const rawType = record.extra?.publicationType;
  if (rawType != null && typeof rawType !== 'string') return false;
  const type = text(rawType);
  if (type && /专利|\bpatent\b/iu.test(type)) return false;
  if (type) return ['论文', '会议论文', '期刊论文', 'paper', 'conference paper', 'journal article'].includes(type.toLowerCase());
  return citationVenue(record) !== null;
}

export function deriveAlibabaValue({ derivation, resume, record, field }: SiteDerivationInput): SiteDerivedValue {
  if (derivation === 'alibaba-awards-summary') {
    if (record !== null || field.kind !== 'textarea') return failure('unsupported', 'Award summary requires a singleton textarea');
    const awards = resume.records.filter(item => item.recordType === 'award').sort((a, b) => a.index - b.index);
    if (!awards.length) return failure('missing-source', 'No award records');
    if (awards.length > 1000) return failure('unsupported', 'Award summary source limit exceeded');
    const sourceRefs: SourceRef[] = [], lines: string[] = [];
    let missingDates = 0;
    for (const award of awards) {
      sourceRefs.push(ref(award, 'name'), ref(award, 'startDate'));
      const name = text(award.fields.name);
      if (!name) return failure('missing-source', 'An award name is missing; summary was not truncated', sourceRefs);
      const rawDate = award.fields.startDate, date = text(rawDate);
      if (rawDate != null && rawDate !== '' && typeof rawDate !== 'string') return failure('unsupported', 'Invalid award date type', sourceRefs);
      if (!date) missingDates++;
      lines.push(date ? `${name}（${date}）` : name);
    }
    const value = lines.join('\n');
    const observedMax = field.hints.maxLength ?? field.hints.maxlength;
    const max = typeof observedMax === 'number' && Number.isSafeInteger(observedMax) && observedMax > 0 ? Math.min(3000, observedMax) : 3000;
    if (value.length > max) return failure('unsupported', 'Award summary exceeds the field limit; no truncation is allowed', sourceRefs);
    return { status: 'ready', value, sourceRefs, transform: 'join', ...(missingDates ? { reason: `${missingDates} award dates are absent; only supplied facts are included` } : {}) };
  }
  if (!record || !isAlibabaPaper(record)) return failure('unsupported', 'Record is not an explicitly supported paper');
  if (derivation === 'alibaba-paper-venue') {
    const sourceRefs = paperRefs(record);
    if (!text(record.fields.description)) return failure('missing-source', 'Paper citation is missing', sourceRefs);
    const value = citationVenue(record);
    return value === null ? failure('unresolved', 'Citation venue does not match the supported explicit grammar', sourceRefs) : { status: 'ready', value: field.kind === 'combobox' ? venueQuery(value) : value, sourceRefs, transform: 'split' };
  }
  if (derivation === 'alibaba-paper-author') {
    const sourceRefs = [...paperRefs(record), ref(record, 'role')];
    const role = text(record.fields.role);
    if (!role) return failure('missing-source', 'Author role is absent', sourceRefs);
    const compact = role.replace(/\s/g, '');
    const roles = compact.split(/[、,，;；]/u);
    const qualifying = ['第一作者', '第二作者', '通讯作者'];
    if (roles.length && roles.every(item => qualifying.includes(item))) {
      if (field.kind === 'checkbox') return { status: 'ready', value: true, sourceRefs, transform: 'split' };
      const unique = [...new Set(roles)];
      return unique.length === 1 ? { status: 'ready', value: unique[0]!, sourceRefs, transform: 'split' } : failure('unresolved', 'Multiple author roles cannot choose one categorical option', sourceRefs);
    }
    if (field.kind === 'checkbox' && ['非第一、二或通讯作者', '不是第一、二或通讯作者'].includes(compact)) return { status: 'ready', value: false, sourceRefs, transform: 'split' };
    return failure('unresolved', 'Role does not explicitly establish the first, second, or corresponding author answer', sourceRefs);
  }
  return failure('unsupported', 'Unknown Alibaba derivation');
}
