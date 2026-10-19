import { FIELD_CATALOG, PROFILE_FIELDS, PREFERENCE_FIELDS, RECORD_FIELDS, sourceKeyId } from './catalog.js';
import { PROTOCOL_VERSION, RESUME_SCHEMA_VERSION } from './types.js';
import { isHashRoute } from './page-route.js';
import type { FieldCatalog, FillPlan, OptionEvidence, PageSnapshot, ResumeContext, SemanticPage, SourceKey, SourceRef, ValidationIssue, ValidationResult } from './types.js';

type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const string = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 10000;
const list = (v: unknown): v is any[] => Array.isArray(v) && v.length <= 2000;
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const version = (v: unknown) => typeof v === 'string' && /^[a-f\d]{64}$/i.test(v);
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const safeJson = (v: unknown, depth = 0): boolean => {
  if (depth > 20) return false;
  if (v === null || ['string', 'boolean'].includes(typeof v)) return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length <= 2000 && v.every(x => safeJson(x, depth + 1));
  return object(v) && Object.entries(v).every(([k, x]) => !forbidden.has(k) && safeJson(x, depth + 1));
};
function validator<T>(value: unknown, run: (v: Obj, add: (p: string, m: string) => void) => void): ValidationResult<T> {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => { if (issues.length < 40) issues.push({ path, code: 'invalid-contract', message }); };
  if (!object(value) || !safeJson(value)) add('', 'Expected bounded plain JSON');
  else if (JSON.stringify(value).length > 1_000_000) add('', 'Payload too large');
  else { try { run(value, add); } catch { add('', 'Malformed contract structure'); } }
  return issues.length ? { ok: false, issues } : { ok: true, value: value as T };
}
export function validateResumeContext(value: unknown): ValidationResult<ResumeContext> {
  return validator(value, (v, add) => {
    if (v.schemaVersion !== RESUME_SCHEMA_VERSION || !version(v.profileVersion) || !string(v.generatedAt) || Number.isNaN(Date.parse(v.generatedAt))) add('schemaVersion', 'Invalid resume version or timestamp');
    for (const [scope, fields] of [['profile', PROFILE_FIELDS], ['preferences', PREFERENCE_FIELDS]] as const) {
      if (!object(v[scope])) { add(scope, 'Expected object'); continue; }
      for (const [key, item] of Object.entries(v[scope])) {
        if (key === 'extra') { if (!object(item)) add(`${scope}.extra`, 'Expected object'); }
        else if (!(fields as readonly string[]).includes(key) || (item !== null && typeof item !== 'string')) add(`${scope}.${key}`, 'Unknown field or invalid fixed field type');
      }
    }
    if (!list(v.records)) { add('records', 'Expected bounded array'); return; }
    const ids = new Set<string>(), indices = new Set<string>();
    v.records.forEach((r, i) => {
      if (!object(r) || !string(r.id) || !string(r.recordType) || !Object.hasOwn(RECORD_FIELDS, r.recordType) || !integer(r.index) || !object(r.fields)) { add(`records.${i}`, 'Invalid record'); return; }
      if (ids.has(r.id) || indices.has(`${r.recordType}:${r.index}`)) add(`records.${i}`, 'Duplicate record identity or order');
      ids.add(r.id); indices.add(`${r.recordType}:${r.index}`);
      for (const [field, item] of Object.entries(r.fields)) if (!RECORD_FIELDS[r.recordType as keyof typeof RECORD_FIELDS].includes(field) || (item !== null && typeof item !== (field === 'current' ? 'boolean' : 'string'))) add(`records.${i}.fields.${field}`, 'Unknown field or invalid type');
      if (r.extra !== undefined && !object(r.extra)) add(`records.${i}.extra`, 'Expected object');
    });
  });
}
export function validateSourceRef(value: unknown, catalog: FieldCatalog = FIELD_CATALOG, resume?: ResumeContext): ValidationResult<SourceRef> {
  return validator(value, (v, add) => {
    if (!['profile', 'preferences', 'record'].includes(v.scope) || !list(v.path) || !v.path.length || v.path.some((k: unknown) => !string(k) || forbidden.has(k as string))) { add('', 'Invalid source path'); return; }
    if (v.scope === 'record' && (!string(v.recordType) || !Object.hasOwn(RECORD_FIELDS, v.recordType) || !string(v.recordId))) { add('recordId', 'Record source requires identity'); return; }
    if (!catalog.some(entry => sourceKeyId(entry.sourceKey) === sourceKeyId(v as SourceKey))) add('path', 'Source is outside field catalog');
    if (resume && v.scope === 'record' && !resume.records.some(r => r.id === v.recordId && r.recordType === v.recordType)) add('recordId', 'Record does not exist');
  });
}
export function validatePageSnapshot(value: unknown): ValidationResult<PageSnapshot> {
  return validator(value, (v, add) => {
    if (v.protocolVersion !== PROTOCOL_VERSION || !string(v.documentId) || !integer(v.pageRevision)) add('', 'Invalid page identity');
    if (!object(v.page) || !string(v.page.origin) || !string(v.page.path) || typeof v.page.title !== 'string') add('page', 'Invalid page metadata');
    if (object(v.page) && v.page.hashRoute !== undefined && !isHashRoute(v.page.hashRoute)) add('page.hashRoute', 'Expected a bounded public hash path without query or fragment');
    if (!list(v.sections)) { add('sections', 'Expected sections'); return; }
    const ids = new Set<string>();
    const id = (val: any, path: string) => { if (!string(val) || ids.has(val)) add(path, 'Missing or duplicate id'); else ids.add(val); };
    v.sections.forEach((s, si) => {
      const p = `sections.${si}`;
      if (!object(s)) { add(p, 'Invalid section'); return; }
      id(s.sectionId, p); if (typeof s.label !== 'string' || !['inline', 'modal', 'multistep', 'unknown'].includes(s.mode) || typeof s.repeatable !== 'boolean') add(p, 'Invalid section metadata');
      if (!list(s.records) || !list(s.actions)) { add(p, 'Expected records/actions'); return; }
      s.records.forEach((r: any, ri: number) => {
        if (!object(r) || !list(r.fields)) { add(`${p}.records.${ri}`, 'Invalid record view'); return; }
        id(r.viewId, `${p}.viewId`);
        r.fields.forEach((f: any) => {
          if (!object(f)) { add(p, 'Invalid field'); return; }
          id(f.fieldId, `${p}.fieldId`);
          if (typeof f.label !== 'string' || !['text','textarea','select','radio','checkbox','combobox','date','contenteditable','unknown'].includes(f.kind) || typeof f.required !== 'boolean' || !['empty','nonempty','unknown'].includes(f.currentState) || !object(f.hints)) add(p, 'Invalid field description');
          if ('value' in f || 'element' in f || 'html' in f) add(p, 'Private DOM data is not permitted');
          if (f.options !== undefined && !validOptions(f.options)) add(p, 'Invalid options');
        });
      });
      s.actions.forEach((a: any) => {
        if (!object(a)) { add(p, 'Invalid action'); return; }
        id(a.actionId, `${p}.actionId`);
        if (a.sectionId !== s.sectionId || !['open-record','add-record','remove-record','save-record','close-record','next-section'].includes(a.kind) || typeof a.label !== 'string' || !object(a.hints) || (a.kind === 'remove-record' && a.viewId === undefined) || (a.viewId !== undefined && !s.records.some((r: any) => object(r) && r.viewId === a.viewId))) add(p, 'Invalid action scope');
      });
    });
  });
}
function validOptions(v: unknown): boolean {
  if (!list(v)) return false;
  const ids = new Set();
  return v.every(o => { if (!object(o) || !string(o.optionId) || typeof o.label !== 'string' || typeof o.disabled !== 'boolean' || ids.has(o.optionId)) return false; ids.add(o.optionId); return true; });
}
export function validateOptionEvidence(value: unknown, snapshot: PageSnapshot): ValidationResult<OptionEvidence> {
  return validator(value, (v, add) => {
    const section = snapshot.sections.find(item => item.sectionId === v.sectionId);
    const field = section?.records.flatMap(record => record.fields).find(item => item.fieldId === v.templateFieldId);
    if (v.documentId !== snapshot.documentId || v.pageRevision !== snapshot.pageRevision || !string(v.probeId) || !field || !section?.records.some(record => record.viewId === v.viewId) || (v.recordId !== undefined && !string(v.recordId))) add('', 'Option evidence does not belong to this page');
    if (!['ready', 'unavailable', 'failed'].includes(v.status) || !validOptions(v.options)) add('options', 'Invalid option evidence status or candidates');
    if (v.customInput !== undefined && (v.customInput !== 'exact-text' || v.status !== 'ready' || field?.kind !== 'combobox')) add('customInput', 'Exact-text capability requires a ready combobox probe');
  });
}
export function validateSemanticPage(value: unknown, snapshot: PageSnapshot, catalog: FieldCatalog = FIELD_CATALOG): ValidationResult<SemanticPage> {
  return validator(value, (v, add) => {
    if (v.documentId !== snapshot.documentId || v.pageRevision !== snapshot.pageRevision || !list(v.sections) || !list(v.warnings)) { add('', 'Stale or invalid semantic page'); return; }
    const seen = new Set();
    for (const section of v.sections) {
      const original = snapshot.sections.find(s => s.sectionId === section?.sectionId);
      if (!object(section) || !original || seen.has(section.sectionId) || !object(section.template) || !list(section.template.fields) || !list(section.bindings)) { add('sections', 'Invalid semantic section'); continue; }
      seen.add(section.sectionId);
      const template = original.records.find(r => r.viewId === section.template.viewId);
      const structure = (record: any) => JSON.stringify([record?.viewId, record?.fields?.map((f: any) => [f.fieldId, f.label, f.kind, f.required, f.groupId, f.partRole, Object.fromEntries(Object.entries(f.hints ?? {}).filter(([key]) => key !== 'disabled'))])]);
      if (!template || structure(template) !== structure(section.template)) { add('template', 'Template structure must originate from snapshot'); continue; }
      if (section.recordType !== undefined && !Object.hasOwn(RECORD_FIELDS, section.recordType)) add('recordType', 'Unknown record type');
      if (section.recordVariants !== undefined && (!list(section.recordVariants) || !section.recordVariants.length || section.recordType !== undefined || section.bindings.length || !original.repeatable)) add('recordVariants', 'Mixed section requires exclusive repeated variants');
      if (section.recordFilter !== undefined && (['internships', 'employment'].includes(section.recordFilter) ? section.recordType !== 'experience' : !['papers', 'alibaba-papers'].includes(section.recordFilter) || section.recordType !== 'publication')) add('recordFilter', 'Invalid record filter');
      const variants = section.recordVariants ?? [{ recordType: section.recordType, bindings: section.bindings }];
      const types = new Set();
      for (const variant of variants) {
        if (!object(variant) || !list(variant.bindings) || (section.recordVariants !== undefined && variant.recordType === undefined) || (variant.recordType !== undefined && !Object.hasOwn(RECORD_FIELDS, variant.recordType)) || types.has(variant.recordType)) { add('recordVariants', 'Invalid or duplicate variant'); continue; }
        types.add(variant.recordType);
        const fields = new Set();
        for (const b of variant.bindings) {
          if (!object(b) || !template.fields.some(f => f.fieldId === b.templateFieldId) || fields.has(b.templateFieldId) || !['resolved','unresolved','unsupported'].includes(b.status) || !['site','ai',null].includes(b.resolvedBy)) { add('bindings', 'Invalid binding'); continue; }
          fields.add(b.templateFieldId);
          if (b.derivation !== undefined && !validDerivationBinding(b, variant.recordType)) add('derivation', 'Invalid derived binding');
          if (b.status === 'resolved') {
            if (['alibaba-awards-summary', 'moka-highest-education-school'].includes(b.derivation) && validDerivationBinding(b, variant.recordType)) continue;
            if (!object(b.sourceKey) || !catalog.some(c => sourceKeyId(c.sourceKey) === sourceKeyId(b.sourceKey as SourceKey))) add('sourceKey', 'Unknown source');
            else if (b.sourceKey.scope === 'record' && b.sourceKey.recordType !== variant.recordType) add('sourceKey', 'Wrong record type');
          } else if (b.sourceKey !== null) add('sourceKey', 'Unresolved binding cannot carry source');
        }
      }
    }
  });
}
export interface PlanValidationContext { snapshot?: PageSnapshot; semanticPage?: SemanticPage; catalog?: FieldCatalog; resumeContext?: ResumeContext; documentId?: string; pageRevision?: number; profileVersion?: string; runId?: string; }
export function validateFillPlan(value: unknown, context: PlanValidationContext = {}): ValidationResult<FillPlan> {
  return validator(value, (v, add) => {
    if (!string(v.runId) || !string(v.documentId) || !integer(v.pageRevision) || !version(v.profileVersion) || !list(v.sections) || !list(v.warnings)) { add('', 'Invalid plan'); return; }
    const doc = context.documentId ?? context.snapshot?.documentId, rev = context.pageRevision ?? context.snapshot?.pageRevision;
    if ((doc !== undefined && doc !== v.documentId) || (rev !== undefined && rev !== v.pageRevision) || (context.profileVersion && context.profileVersion !== v.profileVersion) || (context.runId && context.runId !== v.runId)) add('', 'Plan identity mismatch');
    const sections = new Set();
    for (const s of v.sections) {
      if (!object(s) || !string(s.sectionId) || !list(s.records) || sections.has(s.sectionId)) { add('sections', 'Invalid section plan'); continue; }
      sections.add(s.sectionId);
      if (context.snapshot && !context.snapshot.sections.some(x => x.sectionId === s.sectionId)) add('sectionId', 'Unknown section');
      const semantic = context.semanticPage?.sections.find(x => x.sectionId === s.sectionId);
      const template = semantic?.template;
      const types = s.recordTypes ?? (s.recordType ? [s.recordType] : []);
      if (!list(types) || types.some(t => !Object.hasOwn(RECORD_FIELDS, t)) || new Set(types).size !== types.length || (s.recordTypes !== undefined && (!types.length || s.recordType !== undefined))) add('recordTypes', 'Invalid section record types');
      const expectedTypes = semantic?.recordVariants?.map(x => x.recordType) ?? (semantic?.recordType ? [semantic.recordType] : []);
      if (semantic && JSON.stringify(types) !== JSON.stringify(expectedTypes)) add('recordTypes', 'Section types changed');
      const records = new Set(), positions = new Set();
      for (const r of s.records) {
        if (!object(r) || !list(r.assignments) || records.has(r.recordId) || (types.length ? !string(r.recordId) || !integer(r.recordIndex) || !integer(r.targetIndex) || !types.includes(r.recordType) || positions.has(r.targetIndex) : r.recordId !== null || r.recordIndex !== null || r.targetIndex !== null || r.recordType !== null)) { add('records', 'Invalid record plan'); continue; }
        records.add(r.recordId); positions.add(r.targetIndex);
        if (context.resumeContext && types.length && !context.resumeContext.records.some(x => x.id === r.recordId && x.recordType === r.recordType && x.index === r.recordIndex)) add('recordId', 'Record does not match resume');
        if (context.resumeContext && types.length && !semantic?.recordFilter) {
          const ordered = types.flatMap((type: string) => context.resumeContext!.records.filter(x => x.recordType === type).sort((a,b) => a.index-b.index));
          if (ordered[r.targetIndex]?.id !== r.recordId) add('targetIndex', 'Destination ordinal does not match full source union');
        }
        const bindings = semantic?.recordVariants?.find(x => x.recordType === r.recordType)?.bindings ?? semantic?.bindings;
        const fields = new Set();
        for (const a of r.assignments) {
          if (!object(a) || !string(a.templateFieldId) || fields.has(a.templateFieldId) || !['ready','needs-options','missing-source','unresolved','unsupported'].includes(a.status) || !['identity','date-format','enum-option','split','join'].includes(a.transform) || !['site','ai',null].includes(a.resolvedBy)) { add('assignments', 'Invalid assignment'); continue; }
          fields.add(a.templateFieldId);
          if (template && !template.fields.some(x => x.fieldId === a.templateFieldId)) add('templateFieldId', 'Unknown template field');
          const binding = bindings?.find(x => x.templateFieldId === a.templateFieldId);
          if (binding && (binding.derivation !== a.derivation || (a.sourceRef !== null && (!binding.sourceKey || sourceKeyId(binding.sourceKey) !== sourceKeyId(a.sourceRef))))) add('assignment', 'Assignment differs from binding');
          if (!(a.value === null || typeof a.value === 'string' || typeof a.value === 'boolean' || (typeof a.value === 'number' && Number.isFinite(a.value)) || (Array.isArray(a.value) && a.value.every((x: unknown) => typeof x === 'string')))) add('value', 'Invalid assignment value');
          if (a.sourceRef !== null) {
            if (!validateSourceRef(a.sourceRef, context.catalog ?? FIELD_CATALOG, context.resumeContext).ok) add('sourceRef', 'Invalid source');
            if (a.sourceRef?.scope === 'record' && (a.sourceRef.recordId !== r.recordId || a.sourceRef.recordType !== r.recordType)) add('sourceRef', 'Source belongs to another record');
          }
          if (a.derivation !== undefined) {
            const key = a.sourceRef === null ? null : a.sourceRef;
            if (!validDerivationBinding({ derivation:a.derivation, sourceKey:key, resolvedBy:a.resolvedBy, status:'resolved' }, r.recordType ?? undefined) || !list(a.sourceRefs)) { add('derivation', 'Invalid derived assignment'); continue; }
            const refs = new Set();
            for (const ref of a.sourceRefs) {
              const id = JSON.stringify(ref);
              if (!validateSourceRef(ref, context.catalog ?? FIELD_CATALOG, context.resumeContext).ok || refs.has(id) || ref.scope !== 'record' && a.derivation !== 'moka-highest-education-school') { add('sourceRefs', 'Invalid or duplicate provenance'); continue; }
              refs.add(id);
              const allowed = a.derivation === 'moka-highest-education-school'
                ? ref.scope === 'profile' && ref.path.join('.') === 'highestEducation' || ref.scope === 'record' && ref.recordType === 'education' && ['fields.degree', 'fields.school', 'extra.educationType'].includes(ref.path.join('.'))
                : a.derivation === 'alibaba-awards-summary' ? ref.recordType === 'award' && ['fields.name','fields.startDate'].includes(ref.path.join('.')) : ref.recordType === 'publication' && ref.recordId === r.recordId && (a.derivation === 'alibaba-paper-author' ? ['fields.role','fields.name','fields.startDate','fields.description','extra.publicationType'] : ['fields.name','fields.startDate','fields.description','extra.publicationType']).includes(ref.path.join('.'));
              if (!allowed) add('sourceRefs', 'Foreign derivation provenance');
            }
            if (a.status === 'ready' && !a.sourceRefs.length) add('sourceRefs', 'Ready derivation requires provenance');
            if (a.status === 'ready' && !['alibaba-awards-summary', 'moka-highest-education-school'].includes(a.derivation)) {
              const requiredPaths = ['extra.publicationType','fields.description','fields.name','fields.startDate', ...(a.derivation === 'alibaba-paper-author' ? ['fields.role'] : [])];
              if (a.sourceRefs.length !== requiredPaths.length || requiredPaths.some(path => !a.sourceRefs.some((ref: SourceRef) => ref.path.join('.') === path))) add('sourceRefs', 'Incomplete paper provenance');
            }
            if (a.derivation === 'alibaba-awards-summary' && a.status === 'ready') {
              if (a.sourceRef !== null || a.transform !== 'join' || typeof a.value !== 'string' || a.value.length > 3000) add('derivation', 'Invalid award aggregate');
              const awardIds = new Set(a.sourceRefs.map((ref: SourceRef) => ref.scope === 'record' ? ref.recordId : null));
              if (a.sourceRefs.length !== awardIds.size * 2 || [...awardIds].some(id => !['name','startDate'].every(field => a.sourceRefs.some((ref: SourceRef) => ref.scope === 'record' && ref.recordId === id && ref.path.join('.') === `fields.${field}`)))) add('sourceRefs', 'Incomplete award provenance pairs');
              if (context.resumeContext) {
                const expected = context.resumeContext.records.filter(x => x.recordType === 'award').flatMap(x => ['name','startDate'].map(field => JSON.stringify({scope:'record',recordType:'award',recordId:x.id,path:['fields',field]})));
                if (expected.length !== refs.size || expected.some(x => !refs.has(x))) add('sourceRefs', 'Incomplete award provenance');
              }
            }
            if (a.derivation === 'moka-highest-education-school' && a.status === 'ready') {
              const profiles = a.sourceRefs.filter((ref: SourceRef) => ref.scope === 'profile');
              const schools = a.sourceRefs.filter((ref: SourceRef) => ref.scope === 'record' && ref.path.join('.') === 'fields.school');
              const degrees = a.sourceRefs.filter((ref: SourceRef) => ref.scope === 'record' && ref.path.join('.') === 'fields.degree');
              const types = a.sourceRefs.filter((ref: SourceRef) => ref.scope === 'record' && ref.path.join('.') === 'extra.educationType');
              if (a.sourceRef !== null || a.transform !== 'identity' || typeof a.value !== 'string' || !a.value.trim() || profiles.length !== 1 || schools.length !== 1 || !degrees.length || !degrees.some((ref: SourceRef) => ref.scope === 'record' && ref.recordId === schools[0]?.recordId) || types.some((ref: SourceRef) => ref.scope === 'record' && !degrees.some((degree: SourceRef) => degree.scope === 'record' && degree.recordId === ref.recordId))) add('derivation', 'Invalid highest-education school provenance');
              if (context.resumeContext) {
                const education = context.resumeContext.records.filter(record => record.recordType === 'education');
                if (degrees.length !== education.length || education.some(record => !degrees.some((ref: SourceRef) => ref.scope === 'record' && ref.recordId === record.id))) add('sourceRefs', 'Incomplete education degree provenance');
                const missing = education.filter(record => record.fields.degree == null || typeof record.fields.degree === 'string' && !record.fields.degree.trim());
                if (types.length !== missing.length || missing.some(record => record.extra?.educationType !== '交换生' || !types.some((ref: SourceRef) => ref.scope === 'record' && ref.recordId === record.id))) add('sourceRefs', 'Missing degree requires explicit exchange provenance');
                const selected = education.find(record => record.id === schools[0]?.recordId);
                if (selected?.fields.school !== a.value) add('value', 'Highest school differs from its exact source');
              }
            }
          } else if (a.sourceRefs !== undefined) add('sourceRefs', 'Ordinary assignments cannot carry aggregate provenance');
          if (a.status === 'ready' && ((a.sourceRef === null && !['alibaba-awards-summary', 'moka-highest-education-school'].includes(a.derivation)) || a.value === null)) add('assignment', 'Ready assignment needs source and value');
        }
      }
    }
  });
}

function validDerivationBinding(binding: any, recordType: unknown): boolean {
  if (binding.resolvedBy !== 'site' || binding.status !== 'resolved') return false;
  if (['alibaba-awards-summary', 'moka-highest-education-school'].includes(binding.derivation)) return recordType === undefined && binding.sourceKey === null;
  const field = binding.derivation === 'alibaba-paper-venue' ? 'description' : binding.derivation === 'alibaba-paper-author' ? 'role' : null;
  return field !== null && recordType === 'publication' && binding.sourceKey?.scope === 'record' && binding.sourceKey.recordType === 'publication' && JSON.stringify(binding.sourceKey.path) === JSON.stringify(['fields',field]);
}
