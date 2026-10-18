import { validatePageSnapshot, validateSemanticPage, validateSourceRef, validateResumeContext, validateFillPlan, validateOptionEvidence } from '@job-assistant/autofill-contracts';
import type { ReadinessRequest, ReadinessResult, AnalyzeRequest, PlanRequest, FieldCatalog, SemanticPage, SourceRef, ResumeContext, FillPlan, FillAssignment, Value, SemanticSection } from '@job-assistant/autofill-contracts';
import type { AiResolver } from '../ai/index.js';
import type { SiteClassification, SiteRegistry } from '../sites/registry.js';
import type { RequestContext, ResumeClient } from '../types.js';
import { ServiceError, checkDeadline } from '../errors.js';
export { ServiceError } from '../errors.js';

export function readSourceValue(resume: ResumeContext, ref: SourceRef): { status: 'present'; value: Value } | { status: 'missing' | 'invalid' } {
  let node: unknown = ref.scope === 'record' ? resume.records.find(record => record.id === ref.recordId && record.recordType === ref.recordType) : resume[ref.scope];
  for (const part of ref.path) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, part) || ['__proto__', 'constructor', 'prototype'].includes(part)) return { status: 'missing' };
    node = (node as Record<string, unknown>)[part];
  }
  if (node === null || node === undefined || node === '') return { status: 'missing' };
  if (['string', 'number', 'boolean'].includes(typeof node) || Array.isArray(node) && node.every(value => typeof value === 'string')) return { status: 'present', value: node as Value };
  return { status: 'invalid' };
}

const variantsOf = (section: SemanticSection) => section.recordVariants ?? [{ recordType: section.recordType, bindings: section.bindings }];

export function createMappingService({ resumeClient, siteRegistry, aiResolver, catalog }: {
  resumeClient: ResumeClient; siteRegistry: SiteRegistry;
  aiResolver?: AiResolver; catalog: FieldCatalog;
}) {
  const classify = (snapshot: AnalyzeRequest['snapshot']) => {
    try { return siteRegistry.classify(snapshot); }
    catch { throw new ServiceError('site-classification-failed', 'Site routing failed; no AI fallback', 502); }
  };
  const sitePage = (snapshot: AnalyzeRequest['snapshot'], route: SiteClassification): SemanticPage => {
    let siteResult;
    try { siteResult = route.kind === 'known' && route.supported ? route.parser.parse({ snapshot, catalog }) : undefined; }
    catch { throw new ServiceError('site-parser-failed', 'Site parser failed; no AI fallback', 502); }
    const unsupported = route.kind === 'known' && !route.supported;
    const page: SemanticPage = { documentId: snapshot.documentId, pageRevision: snapshot.pageRevision, warnings: [...(siteResult?.warnings ?? []), ...(route.kind === 'known' ? [`site-parser:${route.parser.id}@${route.parser.version}`] : []), ...(unsupported ? ['site-page-unsupported'] : [])], sections: snapshot.sections.filter(section => section.records.length).map(section => {
      const found = siteResult?.sections.find(item => item.sectionId === section.sectionId);
      const template = section.records[0];
      const fillBindings = (bindings: SemanticSection['bindings'] | undefined): SemanticSection['bindings'] => template.fields.map(field => bindings?.find(binding => binding.templateFieldId === field.fieldId) ?? { templateFieldId: field.fieldId, sourceKey: null, status: unsupported ? 'unsupported' : 'unresolved', resolvedBy: null, reason: unsupported ? 'Site page structure or path is not supported' : route.kind === 'known' ? 'Not covered by this site parser' : 'Unknown website field' });
      return { sectionId: section.sectionId, ...(found?.recordType ? { recordType: found.recordType } : {}), ...(found?.recordFilter ? {recordFilter:found.recordFilter} : {}), ...(found?.recordVariants ? { recordVariants:found.recordVariants.map(variant => ({recordType:variant.recordType,bindings:fillBindings(variant.bindings)})) } : {}), template, bindings: found?.recordVariants ? [] : fillBindings(found?.bindings) };
    }) };
    const sanitized = validateSemanticPage(page, snapshot, catalog);
    if (!sanitized.ok) throw new ServiceError('site-mapping-invalid', 'Site parser returned invalid mapping', 502);
    return page;
  };
  return {
    async checkReadiness(_input: ReadinessRequest, ctx: RequestContext): Promise<ReadinessResult> {
      checkDeadline(ctx);
      const resume = await resumeClient.load({ principal: ctx.principal, signal: ctx.signal, deadlineAt: ctx.deadlineAt });
      const checked = validateResumeContext(resume);
      if (!checked.ok) throw new ServiceError('resume-api-invalid', 'Invalid resume context', 502);
      checkDeadline(ctx);
      return { profileVersion: checked.value.profileVersion };
    },
    async analyzePage(input: AnalyzeRequest, ctx: RequestContext): Promise<SemanticPage> {
      checkDeadline(ctx);
      const checked = validatePageSnapshot(input.snapshot);
      if (!checked.ok) throw new ServiceError('invalid-snapshot', 'Invalid page snapshot');
      const snapshot = checked.value;
      const route = classify(snapshot);
      const page = sitePage(snapshot, route);
      const unresolved = page.sections.flatMap(section => section.bindings.filter(binding => binding.status === 'unresolved').map(binding => ({ sectionId: section.sectionId, templateFieldId: binding.templateFieldId })));
      if (route.kind === 'unknown' && unresolved.length && aiResolver) {
        try {
          const result = await aiResolver.resolveUnknownFields({ snapshot, unresolved, catalog }, { ...ctx, runId: input.runId, aiPhase: 'mapping', siteId: null, siteVersion: null });
          checkDeadline(ctx);
          page.warnings.push(...result.warnings);
          for (const target of unresolved) {
            const section = page.sections.find(item => item.sectionId === target.sectionId)!;
            const binding = section.bindings.find(item => item.templateFieldId === target.templateFieldId)!;
            const matches = result.bindings.filter(item => item.sectionId === target.sectionId && item.templateFieldId === target.templateFieldId);
            if (matches.length !== 1) continue;
            const proposal = matches[0];
            const candidate: SemanticPage = structuredClone(page);
            const candidateSection = candidate.sections.find(item => item.sectionId === target.sectionId)!;
            Object.assign(candidateSection.bindings.find(item => item.templateFieldId === target.templateFieldId)!, { sourceKey: proposal.sourceKey, status: 'resolved', resolvedBy: 'ai' });
            if (proposal.sourceKey.scope === 'record') candidateSection.recordType ??= proposal.sourceKey.recordType;
            if (validateSemanticPage(candidate, snapshot, catalog).ok) {
              Object.assign(binding, { sourceKey: proposal.sourceKey, status: 'resolved', resolvedBy: 'ai' });
              if (candidateSection.recordType !== undefined) section.recordType = candidateSection.recordType;
              delete binding.reason;
            } else binding.reason = 'Invalid AI source or section ownership';
          }
        } catch { checkDeadline(ctx); page.warnings.push('ai-mapping-unavailable'); }
      }
      if (route.kind === 'unknown' && unresolved.length && !aiResolver) page.warnings.push('ai-not-configured');
      checkDeadline(ctx);
      return page;
    },
    async buildFillPlan(input: PlanRequest, ctx: RequestContext): Promise<FillPlan> {
      checkDeadline(ctx);
      if (!validatePageSnapshot(input.snapshot).ok || !validateSemanticPage(input.semanticPage, input.snapshot, catalog).ok) throw new ServiceError('invalid-plan-input', 'Invalid snapshot or semantic mapping');
      const route = classify(input.snapshot);
      if (route.kind === 'known') {
        const parserStamp = `site-parser:${route.parser.id}@${route.parser.version}`;
        if (input.semanticPage.warnings.some(warning => warning.startsWith('site-parser:') && warning !== parserStamp)) throw new ServiceError('site-parser-changed', 'Site parser changed; analyze again', 409);
      }
      // Re-derive known-site bindings, including unsupported pages. Client source
      // provenance cannot authorize either AI calls or source mappings.
      const semanticPage = route.kind === 'known' ? sitePage(input.snapshot, route) : input.semanticPage;
      if (!input.scope || !Array.isArray(input.scope.sectionIds) || !input.scope.sectionIds.length || new Set(input.scope.sectionIds).size !== input.scope.sectionIds.length || input.scope.sectionIds.some(id => !input.semanticPage.sections.some(section => section.sectionId === id))) throw new ServiceError('invalid-scope', 'Invalid plan scope');
      if (input.scope.recordIds !== undefined && (!Array.isArray(input.scope.recordIds) || input.scope.recordIds.some(id => typeof id !== 'string'))) throw new ServiceError('invalid-scope', 'Invalid record scope');
      if (!Array.isArray(input.optionEvidence)) throw new ServiceError('invalid-options', 'Invalid option evidence');
      const evidenceIds = new Set<string>();
      for (const item of input.optionEvidence) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ServiceError('invalid-options', 'Invalid option evidence');
        const section = semanticPage.sections.find(section => section.sectionId === item.sectionId);
        if (!validateOptionEvidence(item, input.snapshot).ok || !section?.template.fields.some(field => field.fieldId === item.templateFieldId)) throw new ServiceError('invalid-options', 'Option evidence does not belong to this page');
        const id = JSON.stringify([item.sectionId, item.viewId, item.templateFieldId]);
        if (evidenceIds.has(id)) throw new ServiceError('invalid-options', 'Conflicting option probes');
        evidenceIds.add(id);
      }
      const resume = await resumeClient.load({ principal: ctx.principal, signal: ctx.signal, deadlineAt: ctx.deadlineAt, expectedProfileVersion: input.expectedProfileVersion });
      if (!validateResumeContext(resume).ok) throw new ServiceError('resume-api-invalid', 'Invalid resume context', 502);
      if (input.expectedProfileVersion && input.expectedProfileVersion !== resume.profileVersion) throw new ServiceError('resume-version-changed', 'Resume changed; restart this run', 409);
      for (const evidence of input.optionEvidence) {
        if (evidence.recordId && !resume.records.some(record => record.id === evidence.recordId && variantsOf(semanticPage.sections.find(section => section.sectionId === evidence.sectionId)!).some(variant => variant.recordType === record.recordType) && (!input.scope.recordIds || input.scope.recordIds.includes(record.id)))) throw new ServiceError('invalid-options', 'Option evidence record is outside scope');
      }
      if (input.scope.recordIds && (!Array.isArray(input.scope.recordIds) || new Set(input.scope.recordIds).size !== input.scope.recordIds.length || input.scope.recordIds.some(id => !resume.records.some(record => record.id === id && semanticPage.sections.some(section => input.scope.sectionIds.includes(section.sectionId) && variantsOf(section).some(variant => variant.recordType === record.recordType)))))) throw new ServiceError('invalid-scope', 'Invalid source record scope');
      const plan: FillPlan = { runId: input.runId, documentId: input.snapshot.documentId, pageRevision: input.snapshot.pageRevision, profileVersion: resume.profileVersion, sections: [], warnings: [...semanticPage.warnings] };
      for (const section of semanticPage.sections.filter(section => input.scope.sectionIds.includes(section.sectionId))) {
        const variants = variantsOf(section);
        const repeated = variants.some(variant => variant.recordType !== undefined);
        // Destination ordinals are assigned to the complete ordered union before scope filtering.
        const allRecords = repeated ? variants.flatMap(variant => resume.records.filter(record => record.recordType === variant.recordType).sort((a,b) => a.index-b.index)).filter(record => {
          if (!section.recordFilter) return true;
          let include = false;
          try { include = route.kind === 'known' && route.supported && route.parser.includeRecord?.({filter:section.recordFilter,record}) === true; } catch { /* fail closed */ }
          if (!include) plan.warnings.push(`record-excluded:${section.sectionId}:${record.id}:${section.recordFilter}`);
          return include;
        }) : [null];
        const records = allRecords.map((record,targetIndex) => ({record,targetIndex:record ? targetIndex : null})).filter(({record}) => !record || !input.scope.recordIds || input.scope.recordIds.includes(record.id));
        const sectionPlan: FillPlan['sections'][number] = { sectionId: section.sectionId, ...(section.recordType ? { recordType: section.recordType } : {}), ...(section.recordVariants ? {recordTypes:section.recordVariants.map(variant => variant.recordType)} : {}), records: [] };
        for (const {record,targetIndex} of records) {
          const bindings = variants.find(variant => variant.recordType === record?.recordType)?.bindings ?? section.bindings;
          const assignments: FillAssignment[] = [];
          for (const fieldSnapshot of section.template.fields) {
            const binding = bindings.find(item => item.templateFieldId === fieldSnapshot.fieldId) ?? { templateFieldId: fieldSnapshot.fieldId, sourceKey: null, status: 'unresolved' as const, resolvedBy: null };
            checkDeadline(ctx);
            const base: FillAssignment = { ...(binding.derivation ? {derivation:binding.derivation} : {}), templateFieldId: binding.templateFieldId, sourceRef: null, value: null, transform: 'identity', status: binding.status === 'unsupported' ? 'unsupported' : 'unresolved', resolvedBy: binding.resolvedBy };
            if ((!binding.sourceKey && !binding.derivation) || binding.status !== 'resolved') { assignments.push({ ...base, ...(binding.reason ? { reason: binding.reason } : {}) }); continue; }
            const sourceRef: SourceRef | null = binding.sourceKey ? binding.sourceKey.scope === 'record' ? { ...binding.sourceKey, recordId: record!.id } : binding.sourceKey : null;
            if (sourceRef && !validateSourceRef(sourceRef, catalog, resume).ok) { assignments.push({ ...base, reason: 'Invalid source reference' }); continue; }
            base.sourceRef = sourceRef;
            const field = fieldSnapshot;
            let source: ReturnType<typeof readSourceValue>;
            if (binding.derivation) {
              base.sourceRefs = [];
              if (['alibaba-awards-summary', 'moka-highest-education-school'].includes(binding.derivation) && input.scope.recordIds) { assignments.push({...base,status:'unsupported',reason:'Derivation requires the complete unscoped source collection'}); continue; }
              if (route.kind !== 'known' || !route.supported || !route.parser.deriveValue) { assignments.push({...base,status:'unsupported',reason:'Derivation unavailable'}); continue; }
              let derived;
              try { derived = route.parser.deriveValue({derivation:binding.derivation,resume,record,field}); }
              catch { assignments.push({...base,status:'unresolved',reason:'Site derivation failed'}); continue; }
              base.sourceRefs = derived.sourceRefs; base.transform = derived.transform ?? 'identity';
              if (derived.reason) base.reason = derived.reason;
              if (derived.status !== 'ready') { assignments.push({...base,status:derived.status}); continue; }
              source = {status:'present',value:derived.value};
            } else source = readSourceValue(resume, sourceRef!);
            if (source.status !== 'present') { assignments.push({ ...base, status: source.status === 'missing' ? 'missing-source' : 'unsupported' }); continue; }
            if (binding.sourceKey?.path[0] === 'extra' && typeof source.value !== 'string') { assignments.push({...base,status:'unsupported',reason:'Extra source must be a string'}); continue; }
            if (!binding.derivation && binding.sourceKey && route.kind === 'known' && route.supported && route.parser.formatValue) {
              let formatted;
              try { formatted = route.parser.formatValue({ sourceKey: binding.sourceKey, sourceValue: source.value, field }); }
              catch { assignments.push({ ...base, status: 'unresolved', reason: 'Site value formatting failed' }); continue; }
              base.transform = formatted.transform;
              if (formatted.reason) base.reason = formatted.reason;
              if (formatted.status !== 'ready') { assignments.push({ ...base, status: formatted.status }); continue; }
              source = { status: 'present', value: formatted.value };
            }
            if (['select', 'radio', 'combobox'].includes(field.kind)) {
              // Evidence belongs to a concrete view. Only the first source record is bound to the template view.
              const evidence = input.optionEvidence.find(item => item.sectionId === section.sectionId && item.templateFieldId === field.fieldId && (record ? item.recordId === record.id : item.recordId === undefined && item.viewId === section.template.viewId));
              // The value is a query hint until a real option is proved, never a ready write.
              if (!evidence || evidence.status !== 'ready') { assignments.push({ ...base, value: source.value, status: 'needs-options' }); continue; }
              const options = evidence.options.filter(option => !option.disabled);
              let chosen: string[] = [];
              let preserveArray = false;
              let siteOptionFailed = false;
              if (route.kind === 'known' && route.supported && route.parser.resolveOption && binding.sourceKey) {
                try {
                  const resolved = route.parser.resolveOption?.({ sourceKey: binding.sourceKey, sourceValue: source.value, candidates: options, field });
                  const optionIds = typeof resolved === 'string' ? [resolved] : Array.isArray(resolved) ? resolved : [];
                  if (optionIds.length > 0 && optionIds.every(id => typeof id === 'string' && id.trim().length > 0) && new Set(optionIds).size === optionIds.length && optionIds.every(id => options.some(option => option.optionId === id))) { chosen = optionIds; preserveArray = Array.isArray(resolved); }
                } catch { siteOptionFailed = true; /* A site option-rule failure stays unresolved. */ }
              } else {
                const exact = options.filter(option => option.label.trim() === String(source.value).trim());
                if (exact.length === 1) chosen = [exact[0].optionId];
              }
              if (!chosen.length && !siteOptionFailed && route.kind === 'known' && route.supported && route.parser.allowCustomInput && binding.sourceKey && evidence.customInput === 'exact-text' && field.kind === 'combobox' && typeof source.value === 'string' && source.value.trim() && !evidence.options.some(option => option.label.trim() === (source.value as string).trim())) {
                let allowed = false;
                try { allowed = route.parser.allowCustomInput({ sourceKey: binding.sourceKey, sourceValue: source.value, field, evidence }) === true; }
                catch { /* A custom-input rule failure stays unresolved. */ }
                if (allowed) { assignments.push({ ...base, status: 'ready', value: source.value, transform: 'identity' }); continue; }
              }
              if (!chosen.length && route.kind === 'unknown' && aiResolver) {
                try {
                  const match = await aiResolver.resolveOptionMatches({ sourceValue: source.value as Exclude<Value, null>, candidates: options, fieldContext: { label: field.label, kind: field.kind, multiple: false } }, { ...ctx, runId: input.runId, aiPhase: 'options', siteId: null, siteVersion: null });
                  checkDeadline(ctx);
                  if (match.status === 'matched' && match.optionIds.length === 1 && options.some(option => option.optionId === match.optionIds[0])) chosen = match.optionIds;
                } catch { checkDeadline(ctx); }
              }
              assignments.push(chosen.length ? { ...base, status: 'ready', value: preserveArray || chosen.length > 1 ? chosen : chosen[0], transform: 'enum-option' } : { ...base, status: 'unresolved', reason: 'No unambiguous option match' });
            } else assignments.push({ ...base, value: source.value, status: field.kind === 'unknown' ? 'unsupported' : 'ready' });
          }
          sectionPlan.records.push({ recordId: record?.id ?? null, recordIndex: record?.index ?? null, recordType:record?.recordType ?? null,targetIndex, assignments });
        }
        plan.sections.push(sectionPlan);
      }
      checkDeadline(ctx);
      if (!validateFillPlan(plan, { snapshot: input.snapshot, semanticPage, catalog, resumeContext: resume }).ok) throw new ServiceError('invalid-generated-plan', 'Generated plan failed provenance validation', 502);
      return plan;
    },
  };
}
