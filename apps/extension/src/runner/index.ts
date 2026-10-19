import { PROTOCOL_VERSION, FIELD_CATALOG, validatePageSnapshot, validateSemanticPage, validateFillPlan } from '@job-assistant/autofill-contracts';
import type { FillAssignment, FillPlan, FillScope, MappingClient, OperationContext, OptionEvidence, PageSnapshot, RecordPlan, SemanticBinding, SourceRef, RunItem, RunReport, SectionPlan, SectionSnapshot, SemanticPage, Value } from '@job-assistant/autofill-contracts';
import type { AddedRecordProof, BoundRecord, PageSession } from '../page/index.js';
import type { ControlDriver, InspectionStage, InspectionStageTiming } from '../controls/index.js';
import { isReportComplete } from '../report/index.js';
import { scopeSectionToRecords } from './snapshot-scope.js';
import { requiresInternshipFilter } from './record-scope.js';
import { excessRecordIds } from './record-alignment.js';
export type RunnerPhase = 'idle' | 'analyzing' | 'probing' | 'planning' | 'executing' | 'verifying' | 'paused' | 'completed' | 'partial' | 'cancelled' | 'failed';
export type DiagnosticTrigger = 'initial' | 'resume' | 'record-rebind' | 'probe-revision-change' | 'option-refresh' | 'section-continuation';
export interface RunnerOperationDiagnostic {
  sequence: number; kind: 'analyze' | 'plan' | 'probe'; trigger: DiagnosticTrigger; durationMs: number;
  inputRevision: number; sectionIds: string[]; sectionCount: number; fieldId?: string;
  recordType?: RecordPlan['recordType']; sourceIndex?: number | null; targetIndex?: number | null;
  outcome: 'ok' | 'failed' | 'cancelled' | 'paused' | 'needs-user' | 'unsupported' | 'no-option-evidence' | 'missing-field-binding';
  optionEvidenceCount?: number; stageMs?: Partial<Record<InspectionStage, number>>; failureStage?: InspectionStage;
  pageRefreshes: number; pageRefreshMs: number;
}
type PagePerformance = ReturnType<PageSession['getPerformanceMetrics']>;
export interface RunnerDiagnostics { operations: RunnerOperationDiagnostic[]; droppedOperations: number; pagePerformance: { start: PagePerformance; current: PagePerformance } }
export interface RunnerTiming { startedAt: number; finishedAt?: number; elapsedMs: number; phaseMs: Partial<Record<RunnerPhase, number>>; diagnostics?: RunnerDiagnostics }
export interface RunnerState { phase: RunnerPhase; runId: string | null; report: RunReport | null; timing?: RunnerTiming }
export interface RunnerAdapter {
  /** Certifies that add opens a disposable editor, rather than persisting a blank record. */
  canProbeEmptySection?(section: SectionSnapshot): boolean;
  editorFor?(source: SectionSnapshot, snapshot: PageSnapshot): SectionSnapshot | undefined;
}
export function createDialogFlowAdapter({ canProbeEmptySection }: { canProbeEmptySection?: (section: SectionSnapshot) => boolean } = {}): RunnerAdapter {
  return { canProbeEmptySection, editorFor(source, snapshot) { const candidates = snapshot.sections.filter(section => section.mode === 'modal' && section.label === source.label && section.records.length === 1 && section.records[0]!.fields.length > 0 && section.actions.some(action => action.kind === 'save-record') && section.actions.some(action => action.kind === 'close-record')); return candidates.length === 1 ? candidates[0] : undefined; } };
}
export interface StartOptions { scope?: FillScope; overwriteExisting?: boolean; allowCollegeReset?: boolean; signal?: AbortSignal; deadlineAt?: number; actionTimeoutMs?: number; /** Explicit QA audit; ordinary filling already confirms each control write. */ auditFinalValues?: boolean }
export interface Runner { start(options?: StartOptions): Promise<RunReport>; pause(): void; resume(): Promise<RunReport>; cancel(): void; getState(): RunnerState; subscribe(listener: (state: RunnerState) => void): () => void; dispose(): void }
class Halt extends Error { constructor(readonly code: string, readonly paused = false) { super(code); } }
interface SectionWork { recordSemantics: Map<string, SemanticPage['sections'][number]>; plan: SectionPlan; semantic: SemanticPage['sections'][number]; source: SectionSnapshot; editor: SectionSnapshot; views: Map<string, string>; viewPositions: Map<string, number>; savedViews: Map<string, string>; expected: Map<string, FillAssignment>; blocked?: string; quarantined?: string; finalized: Set<string>; dateWrites: Map<string,number>; pendingDates: Map<string,{ assignment: FillAssignment; partnerKey: string; failedAt: number }>; dateRetried: Set<string>; overwriteOrder?: string[]; pendingAdd?: { key: string; beforeIds: Set<string> }; pendingSave?: { key: string; beforeIds: Set<string>; editorId: string } }
const recordKey = (record: RecordPlan) => JSON.stringify([record.recordType, record.recordId]);
const assignmentKey = (record: RecordPlan, assignment: FillAssignment) => JSON.stringify([recordKey(record), assignment.templateFieldId]);
const semanticTypes = (section: SemanticPage['sections'][number]) => section.recordVariants?.map(variant => variant.recordType) ?? (section.recordType ? [section.recordType] : []);
const planTypes = (section: SectionPlan) => section.recordTypes ?? (section.recordType ? [section.recordType] : []);
const sameTypes = (a: readonly string[], b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b);
const sameRecord = (a: RecordPlan, b: RecordPlan) => a.recordId === b.recordId && a.recordType === b.recordType && a.recordIndex === b.recordIndex && a.targetIndex === b.targetIndex;
const recordBindings = (section: SemanticPage['sections'][number], record: RecordPlan): SemanticBinding[] => {
  if (!section.recordVariants) return section.bindings;
  const variant = section.recordVariants.find(candidate => candidate.recordType === record.recordType);
  if (!variant) throw new Halt('record-variant-missing', true);
  return variant.bindings;
};
const mapBindings = (section: SemanticPage['sections'][number], map: (binding: SemanticBinding) => SemanticBinding): SemanticPage['sections'][number] => ({ ...section, bindings: section.bindings.map(map), ...(section.recordVariants ? { recordVariants: section.recordVariants.map(variant => ({ ...variant, bindings: variant.bindings.map(map) })) } : {}) });
const bindingIdentity = (binding: SemanticBinding) => { const key = binding.sourceKey; return JSON.stringify([key ? [key.scope, key.scope === 'record' ? key.recordType : null, key.path] : null, binding.derivation ?? null]); };
const sourceIdentity = (ref: SourceRef | null | undefined) => ref ? [ref.scope, ref.scope === 'record' ? ref.recordType : null, ref.scope === 'record' ? ref.recordId : null, ref.path] : null;
const assignmentProvenance = (assignment: FillAssignment | undefined) => JSON.stringify([sourceIdentity(assignment?.sourceRef), assignment?.sourceRefs?.map(sourceIdentity) ?? [], assignment?.derivation ?? null]);
interface LinkedDefaultProof {
  documentId: string; sectionId: string; viewId: string; groupId: string;
  parentTemplateId: string; parentFieldId: string; templateFieldId: string; fieldId: string;
  partRole: string; source: string; value: Value;
}

export function createRunner({ page, controls, mappingClient, onProgress, adapters = [createDialogFlowAdapter()] }: { page: PageSession; controls: ControlDriver; mappingClient: MappingClient; onProgress?: (state: RunnerState) => void; adapters?: RunnerAdapter[] }): Runner {
  let state: RunnerState = { phase: 'idle', runId: null, report: null };
  let options: StartOptions = {}, controller = new AbortController(), requested: 'pause' | 'cancel' | null = null, disposed = false, running = false;
  let report: RunReport | null = null, plan: FillPlan | null = null, documentId = '', work: SectionWork[] = [];
  let deadlineAt = 0, initialized = false, writeSequence = 0;
  let pendingProbes: AddedRecordProof[] = [];
  const transientDeadlineWarnings = new Set<number>();
  const quarantinedSections = new Set<string>();
  let continuationCheckRequired = false;
  const continuationValidatedSections = new Set<string>();
  let expectedSiteParser: string | null | undefined;
  const isParserStamp = (warning: string) => /^site-parser:[^@\s]+@[^@\s]+$/.test(warning);
  const checkSiteParser = (warnings: string[]) => { const stamps = warnings.filter(isParserStamp); if (stamps.length > 1) throw new Halt('site-parser-changed', true); const current = stamps[0] ?? null; if (expectedSiteParser === undefined) expectedSiteParser = current; else if (current !== expectedSiteParser) throw new Halt('site-parser-changed', true); };
  const listeners = new Set<(state: RunnerState) => void>();
  let timing: RunnerTiming | undefined; let phaseStartedAt = 0;
  const publicState = (): RunnerState => { const now = timing?.finishedAt ?? Date.now(); return structuredClone({ ...state, ...(timing ? { timing: { ...timing, elapsedMs: now - timing.startedAt, phaseMs: { ...timing.phaseMs, [state.phase]: (timing.phaseMs[state.phase] ?? 0) + Math.max(0, now - phaseStartedAt) }, ...(timing.diagnostics ? { diagnostics: { ...timing.diagnostics, pagePerformance: { ...timing.diagnostics.pagePerformance, current: page.getPerformanceMetrics() } } } : {}) } } : {}) }); };
  const diagnosticScope = (snapshot: Pick<PageSnapshot, 'pageRevision' | 'sections'>, trigger: DiagnosticTrigger, record?: RecordPlan, fieldId?: string) => ({
    trigger, inputRevision: snapshot.pageRevision,
    // Only page-generated identifiers are diagnostic data; never source IDs or DOM labels.
    sectionIds: snapshot.sections.map(section => section.sectionId).filter(id => /^section-\d+$/.test(id)).slice(0, 16), sectionCount: snapshot.sections.length,
    ...(fieldId && /^field-\d+$/.test(fieldId) ? { fieldId } : {}),
    ...(record ? { recordType: record.recordType, sourceIndex: record.recordIndex, targetIndex: record.targetIndex } : {}),
  });
  const beginDiagnostic = (kind: RunnerOperationDiagnostic['kind'], scope: ReturnType<typeof diagnosticScope>, optionEvidenceCount?: number) => {
    const startedAt = performance.now(), before = page.getPerformanceMetrics(); let finished = false;
    return (outcome: RunnerOperationDiagnostic['outcome'], stages?: Pick<RunnerOperationDiagnostic, 'stageMs' | 'failureStage'>) => {
      if (finished) return; finished = true;
      const diagnostics = timing?.diagnostics; if (!diagnostics) return;
      if (diagnostics.operations.length >= 128) { diagnostics.droppedOperations++; return; }
      const after = page.getPerformanceMetrics();
      diagnostics.operations.push({ sequence: diagnostics.operations.length + diagnostics.droppedOperations + 1, kind, ...scope, durationMs: Math.max(0, performance.now() - startedAt), outcome, ...(optionEvidenceCount !== undefined ? { optionEvidenceCount } : {}), ...stages, pageRefreshes: Math.max(0, after.refreshes - before.refreshes), pageRefreshMs: Math.max(0, after.refreshMs - before.refreshMs) });
    };
  };
  const diagnosticOutcome = (error: unknown): RunnerOperationDiagnostic['outcome'] => error instanceof Halt ? error.code === 'cancelled' ? 'cancelled' : error.paused ? 'paused' : 'failed' : 'failed';
  const measured = async <T>(kind: 'analyze' | 'plan', scope: ReturnType<typeof diagnosticScope>, operation: () => Promise<T>, optionEvidenceCount?: number): Promise<T> => {
    const finish = beginDiagnostic(kind, scope, optionEvidenceCount);
    try { const result = await operation(); finish('ok'); return result; }
    catch (error) { finish(diagnosticOutcome(error)); throw error; }
  };
  const emit = (phase: RunnerPhase) => { const now = Date.now(); if (timing) { timing.phaseMs[state.phase] = (timing.phaseMs[state.phase] ?? 0) + Math.max(0, now - phaseStartedAt); phaseStartedAt = now; if (['completed','partial','failed','cancelled'].includes(phase)) timing.finishedAt ??= now; } state = { phase, runId: report?.runId ?? null, report: report ? structuredClone(report) : null }; const snapshot = publicState(); onProgress?.(snapshot); for (const listener of listeners) listener(snapshot); };
  const check = () => { if (disposed || requested === 'cancel' || options.signal?.aborted) throw new Halt('cancelled'); if (requested === 'pause') throw new Halt('paused', true); if (Date.now() >= deadlineAt) throw new Halt('deadline-exceeded', true); if (documentId && page.getIdentity().documentId !== documentId) throw new Halt('page-identity-changed', true); };
  const context = (): OperationContext => ({ signal: controller.signal, deadlineAt });
  const cctx = (bound: BoundRecord) => ({ ...context(), sectionId: bound.sectionId, viewId: bound.viewId, overwrite: options.overwriteExisting ? 'replace' as const : 'preserve' as const, allowCollegeReset: options.overwriteExisting === true && options.allowCollegeReset === true });
  const unwrap = <T>(result: { status: 'ok'; value: T } | { status: string; code: string; message: string }): T => { check(); if (result.status !== 'ok') throw new Halt('code' in result ? result.code : 'operation-failed'); return (result as { value: T }).value; };
  const scan = async () => { check(); const snapshot = unwrap(await page.scanPage(context())); const valid = validatePageSnapshot(snapshot); if (!valid.ok) throw new Halt('invalid-page-snapshot', true); return valid.value; };
  const delay = () => new Promise<void>((resolve, reject) => { check(); const onAbort = () => { clearTimeout(timer); reject(new Halt(requested === 'pause' ? 'paused' : 'cancelled', requested === 'pause')); }; const timer = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, 35); controller.signal.addEventListener('abort', onAbort, { once: true }); });
  const waitFor = async (predicate: (snapshot: PageSnapshot) => SectionSnapshot | undefined, timeout = 4000) => { const until = Math.min(deadlineAt, Date.now() + timeout); while (true) { const snapshot = await scan(); const found = predicate(snapshot); if (found) return found; if (Date.now() >= until) throw new Halt('action-completion-unconfirmed'); await delay(); } };
  const sourceCurrent = (entry: SectionWork, snapshot: PageSnapshot) => snapshot.sections.find(section => section.sectionId === entry.source.sectionId);
  const editorFor = (source: SectionSnapshot, snapshot: PageSnapshot) => adapters.map(adapter => adapter.editorFor?.(source, snapshot)).find(Boolean) ?? snapshot.sections.find(section => section.sectionId === source.sectionId && section.records.some(record => record.fields.length));
  const action = async (section: SectionSnapshot, kind: 'add-record' | 'remove-record' | 'open-record' | 'save-record' | 'close-record', viewId?: string) => {
    check(); if (kind === 'save-record' && viewId) page.invalidateRecordAddition(viewId); const descriptor = section.actions.find(candidate => candidate.kind === kind && (viewId === undefined ? !candidate.viewId : candidate.viewId === viewId));
    if (!descriptor) throw new Halt(`missing-${kind}`);
    const handle = page.getActionHandle(descriptor.actionId); if (!handle) throw new Halt('stale-action');
    const unsubscribe = page.observeSection(section.sectionId, () => {});
    try {
      const result = await controls.performAction(handle, { kind, sectionId: section.sectionId, ...(viewId ? { viewId } : {}) }, { ...context(), overwrite: options.overwriteExisting ? 'replace' : 'preserve', ...(kind === 'remove-record' ? { expectedRecordOrder: section.records.map(record => record.viewId) } : {}), deadlineAt: Math.min(deadlineAt, Date.now() + (options.actionTimeoutMs ?? 8000)), sectionId: section.sectionId, ...(viewId ? { viewId } : {}) });
      report!.actions.push({ sectionId: section.sectionId, kind, status: result.status === 'ok' ? 'ok' : result.status === 'cancelled' ? 'cancelled' : result.status === 'needs-user' ? 'needs-user' : 'failed', ...(result.status !== 'ok' ? { reason: result.code } : {}) });
      if (result.status !== 'ok') {
        await scan();
        if (kind === 'remove-record' && result.code === 'overwrite-record-order-changed') throw new Halt(result.code, true);
      }
      unwrap(result);
    } finally { unsubscribe(); }
  };
  const probe = async (bound: BoundRecord, record: RecordPlan) => {
    emit('probing'); const evidence: OptionEvidence[] = [], failures = new Map<string,string>();
    for (const assignment of record.assignments) {
      if (assignment.status !== 'needs-options' || !assignment.sourceRef || assignment.value === null) continue;
      check(); const handle = bound.fieldMap[assignment.templateFieldId];
      const finish = beginDiagnostic('probe', diagnosticScope({ pageRevision: bound.pageRevision, sections: [{ sectionId: bound.sectionId } as SectionSnapshot] }, 'option-refresh', record, handle?.fieldId ?? assignment.templateFieldId));
      if (!handle) { finish('missing-field-binding'); failures.set(assignment.templateFieldId, 'missing-field-binding'); continue; }
      const query = typeof assignment.value === 'string' ? assignment.value : undefined;
      const stageMs: Partial<Record<InspectionStage, number>> = {}; let failureStage: InspectionStage | undefined;
      const onInspectionStage = (event: InspectionStageTiming) => { stageMs[event.stage] = (stageMs[event.stage] ?? 0) + event.durationMs; if (event.outcome === 'failed') failureStage = event.stage; };
      try {
        const inspected = await controls.inspectControl(handle, { ...cctx(bound), cleanupDeadlineAt: deadlineAt, deadlineAt: Math.min(deadlineAt, Date.now() + Math.min(2500, options.actionTimeoutMs ?? 2500)), ...(query !== undefined ? { query } : {}), onInspectionStage });
        finish(inspected.status === 'ok' ? inspected.value.optionEvidence ? 'ok' : 'no-option-evidence' : inspected.status, { stageMs, ...(failureStage ? { failureStage } : {}) });
        check();
        if (inspected.status === 'ok' && inspected.value.optionEvidence) evidence.push({ ...inspected.value.optionEvidence, templateFieldId: handle.fieldId, ...(record.recordId ? { recordId: record.recordId } : {}) });
        else failures.set(assignment.templateFieldId, inspected.status === 'ok' ? 'no-option-evidence' : inspected.code);
      } catch (error) { finish(diagnosticOutcome(error), { stageMs, ...(failureStage ? { failureStage } : {}) }); throw error; }
    }
    return { evidence, failures };
  };
  const analyze = async (snapshot: PageSnapshot, trigger: DiagnosticTrigger = 'initial', record?: RecordPlan): Promise<SemanticPage> => measured('analyze', diagnosticScope(snapshot, trigger, record), async () => { emit('analyzing'); const semantic = await mappingClient.analyzePage({ protocolVersion: PROTOCOL_VERSION, requestId: crypto.randomUUID(), runId: report!.runId, deadlineAt, snapshot }, context()); check(); const valid = validateSemanticPage(semantic, snapshot, FIELD_CATALOG); if (!valid.ok) throw new Halt('invalid-semantic-page', true); if (semantic.documentId !== snapshot.documentId || semantic.pageRevision !== snapshot.pageRevision || page.getIdentity().pageRevision !== snapshot.pageRevision) throw new Halt('analysis-page-changed', true); checkSiteParser(semantic.warnings); return semantic; });
  const buildPlan = async (snapshot: PageSnapshot, semanticPage: SemanticPage, optionEvidence: OptionEvidence[], expectedProfileVersion?: string, recordIds?: string[], trigger: DiagnosticTrigger = 'initial', record?: RecordPlan) => measured('plan', diagnosticScope(snapshot, trigger, record), async () => {
    emit('planning'); const value = await mappingClient.buildFillPlan({ protocolVersion: PROTOCOL_VERSION, requestId: crypto.randomUUID(), runId: report!.runId, deadlineAt, snapshot, semanticPage, optionEvidence, scope: { sectionIds: semanticPage.sections.map(section => section.sectionId), ...((recordIds ?? options.scope?.recordIds) ? { recordIds: recordIds ?? options.scope?.recordIds } : {}) }, ...(expectedProfileVersion ? { expectedProfileVersion } : {}) }, context()).catch(error => { if (error instanceof Error && ['resume-version-changed','site-parser-changed'].includes(error.message)) throw new Halt(error.message, true); throw error; });
    check(); const validated = validateFillPlan(value, { snapshot, semanticPage, catalog: FIELD_CATALOG, runId: report!.runId, ...(expectedProfileVersion ? { profileVersion: expectedProfileVersion } : {}) }); if (!validated.ok) throw new Halt('invalid-fill-plan', true);
    for (const section of value.sections) { const semanticSection = semanticPage.sections.find(candidate => candidate.sectionId === section.sectionId); if (!semanticSection || !sameTypes(planTypes(section), semanticTypes(semanticSection))) throw new Halt('invalid-plan-section-type', true); for (const record of section.records) { if (recordIds && record.recordId && !recordIds.includes(record.recordId)) throw new Halt('unexpected-record-plan', true); if (record.assignments.length !== semanticSection.template.fields.length || semanticSection.template.fields.some(field => !record.assignments.some(assignment => assignment.templateFieldId === field.fieldId))) throw new Halt('incomplete-field-plan', true); } }
    if (semanticPage.sections.some(section => !value.sections.some(candidate => candidate.sectionId === section.sectionId))) throw new Halt('missing-section-plan', true);
    if (value.documentId !== documentId || value.pageRevision !== snapshot.pageRevision || page.getIdentity().pageRevision !== snapshot.pageRevision) throw new Halt('plan-page-changed', true);
    if (expectedProfileVersion && value.profileVersion !== expectedProfileVersion) throw new Halt('resume-version-changed', true);
    checkSiteParser(value.warnings); return value;
  }, optionEvidence.length);
  const rollbackProbe = async (proof: AddedRecordProof, cleanup = false) => {
    if (quarantinedSections.has(proof.sectionId)) {
      const warning = `addition-probe-residual:${proof.sectionId}:${proof.viewId}:section-identity-unconfirmed`;
      if (!report!.warnings.includes(warning)) report!.warnings.push(warning);
      return; // Skipping an uncertain section must never delete its rows later.
    }
    const result = controls.rollbackAddedRecord ? await controls.rollbackAddedRecord(proof, { signal: cleanup ? new AbortController().signal : controller.signal, deadlineAt: cleanup ? Date.now() + 2500 : Math.min(deadlineAt, Date.now() + (options.actionTimeoutMs ?? 8000)), sectionId: proof.sectionId, viewId: proof.viewId, overwrite: 'preserve' }) : { status: 'unsupported' as const, code: 'addition-rollback-unsupported', message: 'No scoped rollback driver' };
    if (result.status !== 'ok' || !result.value.removed) {
      report!.warnings.push(`addition-probe-residual:${proof.sectionId}:${proof.viewId}:${result.status === 'ok' ? 'removal-unconfirmed' : result.code}`);
      if (!cleanup) throw new Halt('addition-probe-rollback-failed', true);
      return;
    }
    pendingProbes = pendingProbes.filter(candidate => candidate !== proof);
    for (const entry of work) for (const [key, viewId] of entry.views) if (viewId === proof.viewId) { entry.views.delete(key); entry.viewPositions.delete(key); }
  };
  const probeAddition = async (source: SectionSnapshot) => {
    const baseline = unwrap(page.captureRecordAddition(source.sectionId, context()));
    try {
      emit('probing'); await action(source, 'add-record');
      const until = Math.min(deadlineAt, Date.now() + (options.actionTimeoutMs ?? 8000)); let revision = -1, stableSince = Date.now();
      while (true) {
        check(); const observed = page.observeRecordAddition(baseline, context());
        if (observed.status === 'ok') {
          const currentRevision = page.getIdentity().pageRevision;
          if (currentRevision !== revision) { revision = currentRevision; stableSince = Date.now(); }
          if (Date.now() - stableSince >= 100) { pendingProbes.push(observed.value.proof); return observed.value; }
        } else if (observed.code !== 'addition-unconfirmed') throw new Halt(observed.code, true);
        if (Date.now() >= until) throw new Halt('addition-probe-unconfirmed', true);
        await delay();
      }
    } catch (error) {
      const observed = page.observeRecordAddition(baseline);
      if (observed.status === 'ok') { pendingProbes.push(observed.value.proof); await rollbackProbe(observed.value.proof, true); }
      else report!.warnings.push(`addition-probe-residual-unconfirmed:${source.sectionId}:${observed.code}`);
      throw error;
    }
  };
  const initialize = async () => {
    let snapshot = await scan(); documentId = snapshot.documentId; report!.documentId = documentId;
    const sources = snapshot.sections.filter(section => !options.scope || options.scope.sectionIds.includes(section.sectionId)); const selected: Array<{ source: SectionSnapshot; editor: SectionSnapshot; savedViewId?: string; addition?: { record: SectionSnapshot['records'][number]; proof: AddedRecordProof } }> = [];
    for (const source of sources) {
      // Existing controls already provide a real template. Probe only empty
      // collections; later conditional differences still go through rebind.
      check(); const addition = !source.records.some(record => record.fields.length) && source.mode === 'inline' && controls.rollbackAddedRecord && page.canProbeAddition(source.sectionId) && source.actions.some(candidate => candidate.kind === 'add-record') ? await probeAddition(source) : undefined;
      if (addition) snapshot = await scan();
      let savedViewId: string | undefined; let editor = addition ? snapshot.sections.find(candidate => candidate.sectionId === source.sectionId) : source.records.some(record => record.fields.length) ? source : editorFor(source, snapshot);
      if (!editor) {
        const existing = source.records.find(record => source.actions.some(action => action.kind === 'open-record' && action.viewId === record.viewId));
        if (existing) { savedViewId = existing.viewId; await action(source, 'open-record', existing.viewId); }
        else if (source.actions.some(action => action.kind === 'add-record') && adapters.some(adapter => adapter.canProbeEmptySection?.(source))) await action(source, 'add-record');
        else { report!.warnings.push(`请先打开「${source.label}」的编辑界面，再开始填写。`); continue; }
        editor = await waitFor(current => editorFor(source, current));
      }
      if (addition) editor = unwrap(await page.scanSection(editor.sectionId, context()));
      selected.push({ source, editor, savedViewId, addition });
    }
    snapshot = await scan(); const chosen = { ...snapshot, sections: selected.map(entry => { const section = snapshot.sections.find(section => section.sectionId === entry.editor.sectionId); return section && entry.addition ? scopeSectionToRecords(section, [entry.addition.record]) : section; }).filter((section): section is SectionSnapshot => Boolean(section)) };
    if (!chosen.sections.length) throw new Halt('no-editable-scope', true);
    const semantic = await analyze(chosen);
    plan = await buildPlan(chosen, semantic, []); report!.profileVersion = plan.profileVersion; report!.warnings.push(...plan.warnings);
    work = plan.sections.map(sectionPlan => { const semanticSection = semantic.sections.find(section => section.sectionId === sectionPlan.sectionId); const entry = selected.find(candidate => candidate.editor.sectionId === sectionPlan.sectionId); if (!semanticSection || !entry) throw new Halt('missing-section-template'); const overwriteOrder = options.overwriteExisting && planTypes(sectionPlan).length ? entry.source.records.map(record => record.viewId) : undefined;
      const views = new Map<string,string>(), viewPositions = new Map<string,number>(), savedViews = new Map<string,string>();
      if (overwriteOrder) for (const record of sectionPlan.records) {
        const target = entry.source.records[record.targetIndex!]; if (!target) continue;
        if (entry.source.sectionId === entry.editor.sectionId && target.fields.length) { views.set(recordKey(record), target.viewId); viewPositions.set(recordKey(record), record.targetIndex!); }
        else { savedViews.set(recordKey(record), target.viewId); if (entry.savedViewId === target.viewId) views.set(recordKey(record), entry.editor.records[0]!.viewId); }
      }
      else if (entry.savedViewId && sectionPlan.records[0]) savedViews.set(recordKey(sectionPlan.records[0]), entry.savedViewId);
      return { recordSemantics: new Map(), plan: sectionPlan, semantic: semanticSection, source: entry.source, editor: entry.editor, views, viewPositions, expected: new Map(), finalized: new Set(), savedViews, overwriteOrder, dateWrites: new Map(), pendingDates: new Map(), dateRetried: new Set() }; });
    for (const entry of work) for (const record of entry.plan.records) for (const assignment of record.assignments) report!.items.push({ sectionId: entry.plan.sectionId, sectionLabel: entry.source.label, fieldLabel: entry.semantic.template.fields.find(field => field.fieldId === assignment.templateFieldId)?.label, recordIndex: record.recordIndex, recordType: record.recordType, targetIndex: record.targetIndex, recordId: record.recordId, templateFieldId: assignment.templateFieldId, status: 'needs-user', reason: 'pending', verification: 'none' });
    // A scoped run cannot append a late source into an earlier physical row.
    // Without durable cross-run bindings, that would duplicate it on the next run
    // and let a later full run assign a different source to the same row.
    if (options.scope?.recordIds) for (const entry of work) {
      if (!planTypes(entry.plan).length) continue;
      let nextPosition = entry.source.records.length;
      for (const record of entry.plan.records) {
        if (record.targetIndex === null || record.targetIndex < nextPosition) continue;
        if (record.targetIndex !== nextPosition) throw new Halt('scoped-record-order-gap', true);
        nextPosition++;
      }
    }
    for (const selectedEntry of selected) if (selectedEntry.addition) {
      const entry = work.find(candidate => candidate.plan.sectionId === selectedEntry.editor.sectionId);
      const unusedSource = entry?.plan.records.find(record => record.targetIndex !== null && record.targetIndex >= selectedEntry.addition!.proof.baselineViewIds.length);
      if (entry && unusedSource) { entry.views.set(recordKey(unusedSource), selectedEntry.addition.proof.viewId); entry.viewPositions.set(recordKey(unusedSource), selectedEntry.addition.proof.baselineViewIds.length); }
      else await rollbackProbe(selectedEntry.addition.proof);
    }
    for (const entry of work) {
      if (!options.overwriteExisting || options.scope || !expectedSiteParser || !entry.editor.actions.some(action => action.kind === 'remove-record')) continue;
      let current = unwrap(await page.scanSection(entry.editor.sectionId, context()));
      const removals = excessRecordIds({ section: current, semantic: entry.semantic, plan: entry.plan, overwrite: options.overwriteExisting === true, scoped: Boolean(options.scope), knownSite: Boolean(expectedSiteParser) });
      if (removals.length && JSON.stringify(current.records.map(record => record.viewId)) !== JSON.stringify(entry.editor.records.map(record => record.viewId))) throw new Halt('overwrite-record-order-changed', true);
      for (const viewId of removals) {
        check(); const expected = current.records.filter(record => record.viewId !== viewId).map(record => record.viewId);
        // Only a registered removal for the exact trailing row can be executed.
        if (current.records.at(-1)?.viewId !== viewId || !current.actions.some(action => action.kind === 'remove-record' && action.viewId === viewId)) throw new Halt('record-removal-unavailable', true);
        emit('executing'); await action(current, 'remove-record', viewId);
        current = await waitFor(snapshot => { const section = snapshot.sections.find(section => section.sectionId === current.sectionId); return section && JSON.stringify(section.records.map(record => record.viewId)) === JSON.stringify(expected) ? section : undefined; });
        entry.source = current; entry.editor = current; entry.overwriteOrder = expected;
      }
    }
    initialized = true;
  };
  const item = (entry: SectionWork, record: RecordPlan, assignment: FillAssignment) => report!.items.find(candidate => candidate.sectionId === entry.plan.sectionId && candidate.recordId === record.recordId && candidate.templateFieldId === assignment.templateFieldId)!;
  const checkOverwriteOrder = (entry: SectionWork, snapshot: PageSnapshot) => {
    if (!entry.overwriteOrder) return;
    const source = sourceCurrent(entry, snapshot);
    if (!source || entry.overwriteOrder.some((viewId, index) => source.records[index]?.viewId !== viewId)) throw new Halt('overwrite-record-order-changed', true);
    if (source.sectionId === entry.editor.sectionId) for (const record of entry.plan.records) { const viewId = entry.views.get(recordKey(record)); if (viewId && source.records[entry.viewPositions.get(recordKey(record)) ?? -1]?.viewId !== viewId) throw new Halt('overwrite-record-order-changed', true); }
  };
  const rememberView = (entry: SectionWork, key: string, viewId: string, section: SectionSnapshot) => {
    entry.views.set(key, viewId);
    if (section.sectionId === entry.source.sectionId) {
      const position = section.records.findIndex(candidate => candidate.viewId === viewId);
      if (position < 0) throw new Halt('current-record-identity-unconfirmed', true);
      entry.viewPositions.set(key, position);
    }
  };
  const currentPlan = (entry: SectionWork, record: RecordPlan) => entry.plan.records.find(candidate => candidate.recordId === record.recordId) ?? record;
  const semanticFor = (entry: SectionWork, record?: RecordPlan) => record ? entry.recordSemantics.get(recordKey(record)) ?? entry.semantic : entry.semantic;
  const replanRecord = async (entry: SectionWork, record: RecordPlan, sectionId: string, viewId: string, trigger: DiagnosticTrigger = 'record-rebind') => {
    const snapshot = await scan(); checkOverwriteOrder(entry, snapshot);
    const section = snapshot.sections.find(candidate => candidate.sectionId === sectionId);
    const relevant = section?.records.find(candidate => candidate.viewId === viewId);
    if (!section || !relevant || entry.views.get(recordKey(record)) !== viewId) throw new Halt('current-record-identity-unconfirmed', true);
    const scoped = { ...snapshot, sections: [scopeSectionToRecords(section, [relevant])] };
    const semantic = await analyze(scoped, trigger, record);
    const freshSemantic = semantic.sections.find(candidate => candidate.sectionId === sectionId);
    if (!freshSemantic || !sameTypes(semanticTypes(freshSemantic), planTypes(entry.plan))) throw new Halt('replan-record-type-changed', true);
    const additional = await buildPlan(scoped, semantic, [], report!.profileVersion, record.recordId ? [record.recordId] : undefined, trigger, record);
    const updated = additional.sections.flatMap(candidate => candidate.records).find(candidate => candidate.recordId === record.recordId);
    if (!updated || !sameRecord(updated, record)) throw new Halt('missing-record-replan', true);
    const previousSemantic = semanticFor(entry, record), previous = currentPlan(entry, record);
    // Report identities survive a redraw only when fresh analysis proves the same
    // unique source field. The new DOM still has to pass normal template binding.
    const ids = new Map<string,string>();
    const previousBindings = recordBindings(previousSemantic, record);
    const priorBindings = [...new Map([...recordBindings(entry.semantic, record),...previousBindings].map(binding => [binding.templateFieldId,binding])).values()];
    for (const binding of recordBindings(freshSemantic, record)) {
      const matching = binding.sourceKey || binding.derivation ? priorBindings.filter(candidate => bindingIdentity(candidate) === bindingIdentity(binding)) : previousBindings.filter(candidate => candidate.templateFieldId === binding.templateFieldId);
      ids.set(binding.templateFieldId, matching.length === 1 ? matching[0]!.templateFieldId : binding.templateFieldId);
    }
    const template = { ...freshSemantic.template, fields: freshSemantic.template.fields.map(field => ({ ...field, fieldId: ids.get(field.fieldId)! })) };
    const reboundSemantic = mapBindings({ ...freshSemantic, template }, binding => ({ ...binding, templateFieldId: ids.get(binding.templateFieldId)! }));
    const assignments = updated.assignments.map(assignment => ({ ...assignment, templateFieldId: ids.get(assignment.templateFieldId)! }));
    if (new Set(assignments.map(assignment => assignment.templateFieldId)).size !== assignments.length) throw new Halt('ambiguous-replanned-fields', true);
    for (const assignment of previous.assignments) if (!assignments.some(candidate => candidate.templateFieldId === assignment.templateFieldId)) {
      const resultItem = item(entry, previous, assignment); resultItem.status = 'skipped'; resultItem.reason = 'conditional-field-hidden'; resultItem.verification = 'none'; entry.expected.delete(assignmentKey(record, assignment));
    }
    for (const assignment of assignments) {
      const existingItem = report!.items.find(candidate => candidate.sectionId === entry.plan.sectionId && candidate.recordId === record.recordId && candidate.templateFieldId === assignment.templateFieldId);
      const prior = previous.assignments.find(candidate => candidate.templateFieldId === assignment.templateFieldId);
      if (existingItem && ['filled','already-correct'].includes(existingItem.status) && assignmentProvenance(prior) !== assignmentProvenance(assignment)) throw new Halt('replan-source-changed', true);
      if (existingItem?.status === 'skipped' && assignment.status === 'ready' && assignment.value !== null) { existingItem.status = 'needs-user'; existingItem.reason = 'pending'; existingItem.verification = 'none'; }
      if (!existingItem) report!.items.push({ sectionId: entry.plan.sectionId, sectionLabel: entry.source.label, fieldLabel: template.fields.find(field => field.fieldId === assignment.templateFieldId)?.label, recordIndex: record.recordIndex, recordType: record.recordType, targetIndex: record.targetIndex, recordId: record.recordId, templateFieldId: assignment.templateFieldId, status: 'needs-user', reason: 'pending', verification: 'none' });
    }
    entry.recordSemantics.set(recordKey(record), reboundSemantic);
    const refreshed = { ...updated, assignments };
    entry.plan.records = entry.plan.records.map(candidate => candidate.recordId === record.recordId ? refreshed : candidate);
    entry.editor = section;
    return refreshed;
  };
  const bind = async (entry: SectionWork, editor: SectionSnapshot, viewId: string, record?: RecordPlan): Promise<BoundRecord> => {
    checkOverwriteOrder(entry, await scan());
    let result = await page.bindRecord({ sectionId: editor.sectionId, viewId, template: semanticFor(entry, record).template }, context());
    if (result.status !== 'ok' && result.code === 'incompatible-template' && record && entry.views.get(recordKey(record)) === viewId) {
      await replanRecord(entry, record, editor.sectionId, viewId);
      result = await page.bindRecord({ sectionId: editor.sectionId, viewId, template: semanticFor(entry, record).template }, context());
    }
    return unwrap(result);
  };
  const addedRecordEditor = (entry: SectionWork, snapshot: PageSnapshot, beforeIds: Set<string>): SectionSnapshot | undefined => {
    const candidate = editorFor(entry.source, snapshot);
    if (!candidate) return undefined;
    if (candidate.mode === 'modal') return candidate;
    // A replacement node is not an added record. Keep every previous row's proved
    // identity before accepting a larger inline collection and a unique new view.
    if (candidate.records.length <= beforeIds.size) return undefined;
    if ([...beforeIds].some(viewId => !candidate.records.some(record => record.viewId === viewId))) throw new Halt('existing-record-identity-lost-after-add', true);
    return candidate.records.some(record => !beforeIds.has(record.viewId) && record.fields.length) ? candidate : undefined;
  };
  const ensureRecord = async (entry: SectionWork, record: RecordPlan): Promise<BoundRecord> => {
    if (entry.blocked) throw new Halt(entry.blocked);
    let snapshot = await scan(); checkOverwriteOrder(entry, snapshot); let source = sourceCurrent(entry, snapshot); let editor = editorFor(entry.source, snapshot); const key = recordKey(record); const known = entry.views.get(key);
    if (entry.pendingAdd?.key === key) {
      const prior = entry.pendingAdd.beforeIds;
      const appeared = await waitFor(current => addedRecordEditor(entry, current, prior));
      const candidates = appeared.records.filter(view => view.fields.length && (appeared.mode === 'modal' || !prior.has(view.viewId)));
      if (candidates.length !== 1) throw new Halt('ambiguous-interrupted-add', true);
      entry.pendingAdd = undefined; rememberView(entry, key, candidates[0]!.viewId, appeared); entry.editor = appeared; return bind(entry, appeared, candidates[0]!.viewId, record);
    }
    if (entry.pendingSave?.key === key && source && !snapshot.sections.some(section => section.sectionId === entry.pendingSave!.editorId)) { const added = source.records.filter(candidate => !entry.pendingSave!.beforeIds.has(candidate.viewId)); if (added.length === 1) entry.savedViews.set(key, added[0]!.viewId); else if (!entry.savedViews.has(key)) throw new Halt('interrupted-save-identity-unconfirmed', true); entry.pendingSave = undefined; }
    if (known && editor?.records.some(candidate => candidate.viewId === known)) return bind(entry, editor, known, record);
    if (!planTypes(entry.plan).length && editor?.records.length === 1 && editor.records[0]!.fields.length) { rememberView(entry, key, editor.records[0]!.viewId, editor); return bind(entry, editor, editor.records[0]!.viewId, record); }
    const saved = entry.savedViews.get(key);
    if (saved && source?.records.some(candidate => candidate.viewId === saved)) { if (options.overwriteExisting && editor?.mode === 'modal') { await action(editor, 'close-record'); await waitFor(current => sourceCurrent(entry, current)); source = sourceCurrent(entry, await scan()); if (!source) throw new Halt('section-identity-lost', true); } await action(source, 'open-record', saved); editor = await waitFor(current => editorFor(entry.source, current)); rememberView(entry, key, editor.records[0]!.viewId, editor); entry.editor = editor; return bind(entry, editor, editor.records[0]!.viewId, record); }
    const claimed = new Set([...entry.views.values(), ...(entry.overwriteOrder ?? [])]); const empty = editor?.records.find(candidate => candidate.fields.length && !claimed.has(candidate.viewId) && candidate.fields.every(field => field.currentState === 'empty'));
    if (empty) { rememberView(entry, key, empty.viewId, editor!); entry.editor = editor!; return bind(entry, editor!, empty.viewId, record); }
    if (options.overwriteExisting && entry.overwriteOrder && record.targetIndex! >= entry.overwriteOrder.length && editor?.mode === 'modal') { await action(editor, 'close-record'); await waitFor(current => sourceCurrent(entry, current)); snapshot = await scan(); checkOverwriteOrder(entry, snapshot); source = sourceCurrent(entry, snapshot); editor = undefined; }
    if (editor) {
      const remaining = editor.records.filter(candidate => candidate.fields.length && !claimed.has(candidate.viewId));
      for (const candidate of remaining) {
        let candidateBound: BoundRecord;
        try { candidateBound = await bind(entry, editor, candidate.viewId); }
        catch (error) {
          // An unclaimed row may expose a different conditional field set. It
          // cannot match this template, but must not hide a later exact match.
          // All identity, cancellation and other failures remain fatal.
          if (error instanceof Halt && error.code === 'incompatible-template') continue;
          throw error;
        }
        const identifying = record.assignments.filter(assignment => assignment.status === 'ready' && assignment.value !== null);
        if (!identifying.length) continue;
        let matches = true;
        for (const assignment of identifying) {
          const verified = await controls.verifyControl(candidateBound.fieldMap[assignment.templateFieldId]!, assignment, cctx(candidateBound));
          if (verified.status !== 'ok' || !verified.value.matches) { matches = false; break; }
        }
        if (matches) { rememberView(entry, key, candidate.viewId, editor); return candidateBound; }
      }
      // Page-owned evidence may identify a non-identifying site default. Only
      // ignore it for identity when this exact source field is missing, and keep
      // the value untouched. Existing exact matches always take precedence.
      const placeholders = remaining.filter(candidate => candidate.fields.every(field => {
        if (field.currentState === 'empty') return true;
        if (field.hints.preserveDefaultWhenSourceMissing !== true) return false;
        const templateFields = semanticFor(entry, record).template.fields.filter(template => template.label === field.label && template.kind === field.kind && template.hints.component === field.hints.component);
        return templateFields.length === 1 && record.assignments.some(assignment => assignment.templateFieldId === templateFields[0]!.fieldId && assignment.status === 'missing-source');
      }));
      if (placeholders.length === 1) { const target = placeholders[0]!; rememberView(entry, key, target.viewId, editor); entry.editor = editor; return bind(entry, editor, target.viewId, record); }
      if (placeholders.length > 1) throw new Halt('ambiguous-placeholder-record', true);
      if (remaining.some(candidate => candidate.fields.some(field => field.currentState === 'nonempty'))) throw new Halt('existing-record-identity-ambiguous', true);
    }
    if (!source) throw new Halt('section-identity-lost', true);
    const before = new Set(source.records.map(candidate => candidate.viewId));
    entry.pendingAdd = { key, beforeIds: before };
    try { await action(source, 'add-record'); } catch (error) { if (requested || options.signal?.aborted) throw error; entry.blocked = 'record-add-unconfirmed'; throw error; }
    editor = await waitFor(current => addedRecordEditor(entry, current, before));
    const candidates = editor.mode === 'modal' ? editor.records.filter(candidate => candidate.fields.length) : editor.records.filter(candidate => !before.has(candidate.viewId) && candidate.fields.length);
    if (candidates.length !== 1) throw new Halt('ambiguous-created-record', true);
    entry.pendingAdd = undefined; rememberView(entry, key, candidates[0]!.viewId, editor); entry.editor = editor;
    return bind(entry, editor, candidates[0]!.viewId, record);
  };
  const refreshRecordPlan = async (entry: SectionWork, record: RecordPlan, bound: BoundRecord): Promise<{ record: RecordPlan; bound: BoundRecord }> => {
    if (!record.assignments.some(assignment => assignment.status === 'needs-options' && assignment.sourceRef && assignment.value !== null)) return { record, bound };
    const current = unwrap(await page.scanSection(bound.sectionId, context()));
    const relevant = current.records.find(candidate => candidate.viewId === bound.viewId); if (!relevant) throw new Halt('current-record-missing', true);
    const snapshot = await scan(); const scoped = { ...snapshot, sections: [scopeSectionToRecords(current, [relevant])] };
    // bindRecord has already proved this template's structure. Reuse its source mappings,
    // while changing only the current field identities and page revision.
    const semantic: SemanticPage = { documentId: snapshot.documentId, pageRevision: snapshot.pageRevision, warnings: expectedSiteParser ? [expectedSiteParser] : [], sections: [mapBindings({ ...semanticFor(entry, record), sectionId: current.sectionId, template: relevant }, binding => {
      const handle = bound.fieldMap[binding.templateFieldId]; if (!handle) throw new Halt('incompatible-template', true); return { ...binding, templateFieldId: handle.fieldId };
    })] };
    if (!validateSemanticPage(semantic, scoped, FIELD_CATALOG).ok) throw new Halt('invalid-rebound-semantic', true);
    const { evidence, failures } = await probe(bound, record);
    if (page.getIdentity().pageRevision !== snapshot.pageRevision) { await replanRecord(entry, record, bound.sectionId, bound.viewId, 'probe-revision-change'); const fresh = currentPlan(entry, record); return { record: fresh, bound: await bind(entry, unwrap(await page.scanSection(bound.sectionId, context())), bound.viewId, fresh) }; }
    const additional = await buildPlan(scoped, semantic, evidence, report!.profileVersion, record.recordId ? [record.recordId] : undefined, 'option-refresh', record);
    const updated = additional.sections.flatMap(candidate => candidate.records).find(candidate => candidate.recordId === record.recordId); if (!updated || !sameRecord(updated, record)) throw new Halt('missing-record-replan', true);
    const replacements = record.assignments.map(original => {
      const failed = failures.get(original.templateFieldId); if (failed) return { ...original, status: 'unresolved' as const, reason: `option-probe-${failed}` };
      const fresh = updated.assignments.find(candidate => candidate.templateFieldId === bound.fieldMap[original.templateFieldId]?.fieldId);
      if (fresh && assignmentProvenance(original) !== assignmentProvenance(fresh)) throw new Halt('replan-source-changed', true);
      return fresh ? { ...fresh, templateFieldId: original.templateFieldId } : original;
    });
    const refreshed = { ...record, assignments: replacements }; entry.plan.records = entry.plan.records.map(candidate => candidate.recordId === record.recordId ? refreshed : candidate); return { record: refreshed, bound };
  };
  const linkedDefaultBefore = async (entry: SectionWork, record: RecordPlan, assignment: FillAssignment, bound: BoundRecord): Promise<LinkedDefaultProof | undefined> => {
    if (options.overwriteExisting || !assignment.sourceRef || assignment.derivation) return;
    if (typeof semanticFor(entry, record).template.fields.find(field => field.fieldId === assignment.templateFieldId)?.hints.linkedDefaultPart !== 'string') return;
    const section = unwrap(await page.scanSection(bound.sectionId, context()));
    const fields = section.records.find(candidate => candidate.viewId === bound.viewId)?.fields;
    const parentHandle = bound.fieldMap[assignment.templateFieldId];
    const parent = fields?.find(field => field.fieldId === parentHandle?.fieldId);
    const role = parent?.hints.linkedDefaultPart, value = parent?.hints.linkedDefaultValue;
    if (!parent?.groupId || typeof role !== 'string' || !['string', 'number', 'boolean'].includes(typeof value)) return;
    const children = fields!.filter(field => field.groupId === parent.groupId && field.partRole === role && field.kind === 'combobox');
    if (children.length !== 1 || children[0]!.currentState !== 'empty') return;
    const child = children[0]!;
    const matches = record.assignments.filter(candidate => candidate.status === 'ready' && candidate.value !== null && bound.fieldMap[candidate.templateFieldId]?.fieldId === child.fieldId && assignmentProvenance(candidate) === assignmentProvenance(assignment));
    if (matches.length !== 1) return;
    const childAssignment = matches[0]!, childHandle = bound.fieldMap[childAssignment.templateFieldId]!;
    const read = await controls.readControl(childHandle, cctx(bound)); check();
    if (read.status !== 'ok' || read.value.value !== '') return;
    return { documentId: childHandle.documentId, sectionId: bound.sectionId, viewId: bound.viewId, groupId: parent.groupId, parentTemplateId: assignment.templateFieldId, parentFieldId: parent.fieldId, templateFieldId: childAssignment.templateFieldId, fieldId: child.fieldId, partRole: role, source: assignmentProvenance(assignment), value: value as Value };
  };
  const linkedDefaultCurrent = async (proof: LinkedDefaultProof, record: RecordPlan, bound: BoundRecord): Promise<boolean> => {
    const child = record.assignments.find(candidate => candidate.templateFieldId === proof.templateFieldId);
    const parent = record.assignments.find(candidate => candidate.templateFieldId === proof.parentTemplateId);
    const handle = bound.fieldMap[proof.templateFieldId], parentHandle = bound.fieldMap[proof.parentTemplateId];
    if (!child || !parent || assignmentProvenance(child) !== proof.source || assignmentProvenance(parent) !== proof.source || handle?.documentId !== proof.documentId || parentHandle?.documentId !== proof.documentId || handle.fieldId !== proof.fieldId || parentHandle.fieldId !== proof.parentFieldId || bound.sectionId !== proof.sectionId || bound.viewId !== proof.viewId) return false;
    const section = unwrap(await page.scanSection(bound.sectionId, context()));
    const fields = section.records.find(candidate => candidate.viewId === bound.viewId)?.fields;
    const current = fields?.find(field => field.fieldId === proof.fieldId), currentParent = fields?.find(field => field.fieldId === proof.parentFieldId);
    if (current?.groupId !== proof.groupId || current.partRole !== proof.partRole || currentParent?.groupId !== proof.groupId || currentParent.hints.linkedDefaultPart !== proof.partRole || currentParent.hints.linkedDefaultValue !== proof.value) return false;
    const read = await controls.readControl(handle, cctx(bound)); check();
    return read.status === 'ok' && read.value.value === proof.value;
  };
  const verifySaved = async (entry: SectionWork, record: RecordPlan, bound: BoundRecord) => {
    const editor = unwrap(await page.scanSection(bound.sectionId, context())); if (!editor.actions.some(candidate => candidate.kind === 'save-record')) return;
    if (record.assignments.some(assignment => ['failed','needs-user'].includes(item(entry, record, assignment).status))) throw new Halt('incomplete-record-save-blocked', true);
    emit('verifying'); const before = await scan(); const sourceBefore = sourceCurrent(entry, before); const previousIds = new Set(sourceBefore?.records.map(candidate => candidate.viewId));
    entry.pendingSave = { key: recordKey(record), beforeIds: previousIds, editorId: editor.sectionId };
    await action(editor, 'save-record');
    const sourceAfter = await waitFor(snapshot => { const source = sourceCurrent(entry, snapshot); return !snapshot.sections.some(candidate => candidate.sectionId === editor.sectionId) && source ? source : undefined; });
    let summary = entry.savedViews.get(recordKey(record));
    if (!summary) { const added = sourceAfter.records.filter(candidate => !previousIds.has(candidate.viewId)); if (added.length !== 1) throw new Halt('saved-record-identity-unconfirmed', true); summary = added[0]!.viewId; entry.savedViews.set(recordKey(record), summary); }
    entry.pendingSave = undefined;
    await action(sourceAfter, 'open-record', summary); const reopened = await waitFor(snapshot => editorFor(entry.source, snapshot)); const rebound = await bind(entry, reopened, reopened.records[0]!.viewId, record); rememberView(entry, recordKey(record), rebound.viewId, reopened); entry.editor = reopened;
    for (const assignment of record.assignments) { const resultItem = item(entry, record, assignment); if (!['filled','already-correct'].includes(resultItem.status)) continue; const verified = await controls.verifyControl(rebound.fieldMap[assignment.templateFieldId]!, entry.expected.get(assignmentKey(record, assignment)) ?? assignment, cctx(rebound)); if (verified.status !== 'ok' || !verified.value.matches) { resultItem.status = 'failed'; resultItem.reason = 'saved-readback-mismatch'; resultItem.verification = 'none'; } else resultItem.verification = 'saved'; }
    if (reopened.actions.some(candidate => candidate.kind === 'close-record')) { await action(reopened, 'close-record'); await waitFor(snapshot => sourceCurrent(entry, snapshot)); }
  };
  const pairedDate = (record: RecordPlan, assignment: FillAssignment) => {
    const ref = assignment.sourceRef;
    if (ref?.scope !== 'record' || ref.recordId !== record.recordId || ref.path.length !== 2 || ref.path[0] !== 'fields' || !['startDate','endDate'].includes(ref.path[1]!)) return undefined;
    const other = ref.path[1] === 'startDate' ? 'endDate' : 'startDate';
    return record.assignments.find(candidate => candidate.status === 'ready' && candidate.value !== null && candidate.sourceRef?.scope === 'record' && candidate.sourceRef.recordId === ref.recordId && candidate.sourceRef.recordType === ref.recordType && candidate.sourceRef.path.length === 2 && candidate.sourceRef.path[0] === 'fields' && candidate.sourceRef.path[1] === other);
  };
  const retryChangedDate = async (entry: SectionWork, record: RecordPlan, bound: BoundRecord) => {
    for (const assignment of record.assignments) {
      const key = assignmentKey(record, assignment), pending = entry.pendingDates.get(key);
      if (!pending || entry.dateRetried.has(key) || (entry.dateWrites.get(pending.partnerKey) ?? 0) <= pending.failedAt) continue;
      check(); entry.dateRetried.add(key); entry.pendingDates.delete(key);
      bound = await bind(entry, unwrap(await page.scanSection(bound.sectionId, context())), bound.viewId, record);
      const resultItem = item(entry, record, assignment), handle = bound.fieldMap[assignment.templateFieldId];
      if (!handle) { resultItem.status = 'failed'; resultItem.reason = 'missing-field-binding'; continue; }
      const existing = await controls.verifyControl(handle, pending.assignment, { ...cctx(bound), verification: 'existing' }); check();
      if (existing.status === 'ok' && existing.value.matches) { resultItem.status = 'already-correct'; resultItem.reason = undefined; resultItem.verification = 'readback'; entry.expected.set(key, { ...pending.assignment, value: existing.value.actual }); continue; }
      const wrote = await controls.writeControl(handle, pending.assignment, cctx(bound)); check();
      if (wrote.status !== 'ok') { resultItem.status = wrote.status === 'needs-user' || wrote.status === 'unsupported' ? 'needs-user' : 'failed'; resultItem.reason = wrote.code; continue; }
      bound = await bind(entry, unwrap(await page.scanSection(bound.sectionId, context())), bound.viewId, record);
      const verified = await controls.verifyControl(bound.fieldMap[assignment.templateFieldId]!, pending.assignment, { ...cctx(bound), verification: 'after-write' }); check();
      resultItem.status = verified.status === 'ok' && verified.value.matches ? 'filled' : 'failed'; resultItem.reason = resultItem.status === 'filled' ? undefined : verified.status === 'ok' ? 'readback-mismatch' : verified.code; resultItem.verification = resultItem.status === 'filled' ? 'readback' : 'none';
      if (verified.status === 'ok' && verified.value.matches) entry.expected.set(key, { ...pending.assignment, value: verified.value.actual });
      emit('executing');
    }
    return bound;
  };
  const physicalIds = (entry: SectionWork) => [entry.source.sectionId, entry.editor.sectionId, entry.plan.sectionId];
  const quarantineSection = (entry: SectionWork, record: RecordPlan, error: unknown): boolean => {
    // Only this locally proved, pre-write ambiguity is recoverable for now.
    // Backend errors, unknown failures and all other paused invariants propagate.
    if (!(error instanceof Halt) || error.code !== 'existing-record-identity-ambiguous') return false;
    const ids = new Set(physicalIds(entry));
    let group: SectionWork[] = [];
    for (let previous = -1; previous !== ids.size;) {
      previous = ids.size;
      group = work.filter(candidate => physicalIds(candidate).some(id => ids.has(id)));
      for (const candidate of group) for (const id of physicalIds(candidate)) ids.add(id);
    }
    if (group.some(candidate => candidate.source.mode !== 'inline' || candidate.editor.mode !== 'inline' || candidate.pendingAdd || candidate.pendingSave)) return false;
    for (const id of ids) quarantinedSections.add(id);
    for (const candidate of group) {
      candidate.quarantined = error.code; candidate.expected.clear(); candidate.pendingDates.clear();
      for (const resultItem of report!.items.filter(result => result.sectionId === candidate.plan.sectionId)) {
        resultItem.status = resultItem.verification !== 'none' || resultItem.status !== 'skipped' && !['pending', 'paused'].includes(resultItem.reason ?? '') ? 'needs-user' : 'skipped';
        resultItem.reason = 'section-identity-unconfirmed'; resultItem.verification = 'none';
      }
    }
    report!.warnings.push(`section-quarantined:${entry.plan.sectionId}:${record.recordType ?? 'singleton'}:${record.recordIndex ?? 'none'}:${record.targetIndex ?? 'none'}:${error.code}`);
    continuationCheckRequired = true; continuationValidatedSections.clear();
    emit('executing');
    return true;
  };
  const validateContinuation = async (entry: SectionWork) => {
    // No action may occur between quarantine and a fresh authenticated source /
    // exact section-identity check. Do not create a row to discover a template.
    const snapshot = await scan();
    if (work.some(candidate => candidate.pendingAdd || candidate.pendingSave) || snapshot.sections.some(section => section.mode === 'modal')) throw new Halt('continuation-editor-unconfirmed', true);
    const source = snapshot.sections.find(section => section.sectionId === entry.source.sectionId);
    const editor = snapshot.sections.find(section => section.sectionId === entry.editor.sectionId);
    if (!source || !editor || source.mode !== 'inline' || editor.mode !== 'inline' || !editor.records.some(record => record.fields.length) || physicalIds(entry).some(id => quarantinedSections.has(id))) throw new Halt('continuation-section-unconfirmed', true);
    checkOverwriteOrder(entry, snapshot);
    const scoped = { ...snapshot, sections: [editor] };
    const semantic = await analyze(scoped, 'section-continuation');
    const refreshed = await buildPlan(scoped, semantic, [], report!.profileVersion, undefined, 'section-continuation');
    const fresh = refreshed.sections.find(section => section.sectionId === entry.plan.sectionId);
    if (!fresh || !sameTypes(planTypes(fresh), planTypes(entry.plan)) || fresh.records.length !== entry.plan.records.length || entry.plan.records.some(record => !fresh.records.some(candidate => sameRecord(candidate, record)))) throw new Halt('resume-record-identity-changed', true);
    // The normal bind path still proves each destination before any write. The
    // existing plan retains its option evidence; this check does not replace it.
  };
  const execute = async () => {
    for (const entry of work) for (const original of entry.plan.records) {
      check(); if (entry.quarantined || entry.finalized.has(recordKey(original))) continue;
      // A discarded probe for an unmapped section must not be opened again by
      // ensureRecord. Without applicable source data there is nothing to write.
      if (!original.assignments.some(assignment => assignment.value !== null && ['ready','needs-options'].includes(assignment.status))) {
        for (const assignment of original.assignments) { const resultItem = item(entry, original, assignment); resultItem.status = 'skipped'; resultItem.reason = assignment.reason ?? assignment.status; }
        entry.finalized.add(recordKey(original)); continue;
      }
      if (expectedSiteParser === null && requiresInternshipFilter(entry.source.label, entry.semantic)) {
        entry.quarantined = 'record-subtype-unconfirmed';
        for (const resultItem of report!.items.filter(item => item.sectionId === entry.plan.sectionId)) { resultItem.status = 'needs-user'; resultItem.reason = 'record-subtype-unconfirmed'; resultItem.verification = 'none'; }
        report!.warnings.push('record-subtype-unconfirmed'); emit('executing'); continue;
      }
      try {
        if (continuationCheckRequired && !continuationValidatedSections.has(entry.plan.sectionId)) { await validateContinuation(entry); continuationValidatedSections.add(entry.plan.sectionId); }
        emit('executing'); let bound = await ensureRecord(entry, original); let record = currentPlan(entry, original);
        const claimedProbe = pendingProbes.find(proof => proof.sectionId === bound.sectionId && proof.viewId === bound.viewId);
        if (claimedProbe) { pendingProbes = pendingProbes.filter(proof => proof !== claimedProbe); page.invalidateRecordAddition(bound.viewId); }
        ({ record, bound } = await refreshRecordPlan(entry, record, bound));
        const attempted = new Set<string>(), attemptedRanges = new Set<string>();
        // Local to this uninterrupted record execution: never carry permission
        // across pause/resume, another run, a record rebind, or source changes.
        const linkedDefaults = new Map<string, LinkedDefaultProof>();
        while (true) {
          record = currentPlan(entry, record);
          bound = await bind(entry, unwrap(await page.scanSection(bound.sectionId, context())), bound.viewId, record);
          record = currentPlan(entry, record);
          if (record.assignments.some(assignment => assignment.status === 'needs-options' && !attempted.has(assignment.templateFieldId))) ({ record, bound } = await refreshRecordPlan(entry, record, bound));
          const pending = record.assignments.filter(candidate => !attempted.has(candidate.templateFieldId));
          const assignment = pending.find(candidate => candidate.status === 'ready' && candidate.sourceRef?.scope === 'record' && candidate.sourceRef.path.length === 2 && candidate.sourceRef.path[0] === 'fields' && candidate.sourceRef.path[1] === 'current' && typeof candidate.value === 'boolean') ?? pending[0];
          if (!assignment) break; attempted.add(assignment.templateFieldId);
          check(); const resultItem = item(entry, original, assignment); if (resultItem.reason !== 'pending' && resultItem.reason !== 'paused') continue;
          if (assignment.status !== 'ready' || assignment.value === null) { resultItem.status = assignment.reason?.startsWith('option-probe-') ? 'needs-user' : 'skipped'; resultItem.reason = assignment.reason ?? assignment.status; continue; }
          bound = await bind(entry, unwrap(await page.scanSection(bound.sectionId, context())), bound.viewId, record);
          const handle = bound.fieldMap[assignment.templateFieldId]; if (!handle) { resultItem.status = 'failed'; resultItem.reason = 'missing-field-binding'; continue; }
          const partner = pairedDate(record, assignment);
          const datePair = partner && [assignment, partner].sort((left, right) => left.sourceRef!.path[1] === 'startDate' ? -1 : right.sourceRef!.path[1] === 'startDate' ? 1 : 0);
          const rangeKey = datePair?.map(candidate => candidate.templateFieldId).join(':');
          if (controls.writeDateRange && datePair && rangeKey && !attemptedRanges.has(rangeKey) && datePair.every(candidate => typeof candidate.value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(candidate.value) && semanticFor(entry, record).template.fields.find(field => field.fieldId === candidate.templateFieldId)?.kind === 'date' && ['pending','paused'].includes(item(entry, record, candidate).reason ?? ''))) {
            attemptedRanges.add(rangeKey);
            const [start, end] = datePair as [FillAssignment, FillAssignment];
            const startHandle = bound.fieldMap[start.templateFieldId], endHandle = bound.fieldMap[end.templateFieldId];
            if (startHandle && endHandle) {
              const grouped = await controls.writeDateRange(startHandle, start, endHandle, end, cctx(bound)); check();
              if (grouped.status === 'ok' || grouped.code !== 'date-range-unsupported') {
                for (const candidate of datePair) attempted.add(candidate.templateFieldId);
                if (grouped.status === 'ok') bound = await bind(entry, unwrap(await page.scanSection(bound.sectionId, context())), bound.viewId, record);
                for (const [index, candidate] of datePair.entries()) {
                  const targetItem = item(entry, record, candidate);
                  if (grouped.status !== 'ok') { targetItem.status = grouped.status === 'needs-user' || grouped.status === 'unsupported' ? 'needs-user' : 'failed'; targetItem.reason = grouped.code; targetItem.verification = 'none'; continue; }
                  const verified = await controls.verifyControl(bound.fieldMap[candidate.templateFieldId]!, candidate, cctx(bound)); check();
                  const receipt = index === 0 ? grouped.value.start : grouped.value.end;
                  const matches = verified.status === 'ok' && verified.value.matches;
                  targetItem.status = matches ? receipt.attempted ? 'filled' : 'already-correct' : 'failed'; targetItem.reason = matches ? undefined : verified.status === 'ok' ? 'readback-mismatch' : verified.code; targetItem.verification = matches ? 'readback' : 'none';
                  if (verified.status === 'ok' && verified.value.matches) entry.expected.set(assignmentKey(record, candidate), { ...candidate, value: verified.value.actual });
                }
                emit('executing'); continue;
              }
            }
          }
          const existing = await controls.verifyControl(handle, assignment, { ...cctx(bound), verification: 'existing' });
          if (existing.status === 'ok' && existing.value.matches) { resultItem.status = 'already-correct'; resultItem.reason = undefined; resultItem.verification = 'readback'; entry.expected.set(assignmentKey(record, assignment), { ...assignment, value: existing.value.actual }); emit('executing'); continue; }
          const linkedBefore = await linkedDefaultBefore(entry, record, assignment, bound);
          const dependentProof = linkedDefaults.get(assignment.templateFieldId);
          linkedDefaults.delete(assignment.templateFieldId);
          const replaceIfValue = dependentProof && await linkedDefaultCurrent(dependentProof, record, bound) ? { value: dependentProof.value } : undefined;
          const wrote = await controls.writeControl(handle, assignment, { ...cctx(bound), ...(replaceIfValue ? { replaceIfValue } : {}) }); check();
          if (wrote.status !== 'ok') {
            if (wrote.code === 'stale-handle' && page.getIdentity().pageRevision !== bound.pageRevision) {
              bound = await bind(entry, unwrap(await page.scanSection(bound.sectionId, context())), bound.viewId, record);
              const freshHandle = bound.fieldMap[assignment.templateFieldId];
              const recovered = freshHandle ? await controls.verifyControl(freshHandle, assignment, cctx(bound)) : undefined; check();
              if (recovered?.status === 'ok' && recovered.value.matches) { resultItem.status = 'already-correct'; resultItem.reason = undefined; resultItem.verification = 'readback'; entry.expected.set(assignmentKey(record, assignment), { ...assignment, value: recovered.value.actual }); emit('executing'); continue; }
            }
            resultItem.status = wrote.status === 'needs-user' || wrote.status === 'unsupported' ? 'needs-user' : 'failed'; resultItem.reason = wrote.code;
            const partner = wrote.code === 'date-choice-disabled' ? pairedDate(record, assignment) : undefined;
            if (partner && !entry.dateRetried.has(assignmentKey(record, assignment))) entry.pendingDates.set(assignmentKey(record, assignment), { assignment, partnerKey: assignmentKey(record, partner), failedAt: writeSequence });
            continue;
          }
          bound = await bind(entry, unwrap(await page.scanSection(bound.sectionId, context())), bound.viewId, record);
          const verified = await controls.verifyControl(bound.fieldMap[assignment.templateFieldId]!, assignment, { ...cctx(bound), verification: 'after-write' }); check();
          if (linkedBefore && wrote.value.attempted && verified.status === 'ok' && verified.value.matches && await linkedDefaultCurrent(linkedBefore, record, bound)) linkedDefaults.set(linkedBefore.templateFieldId, linkedBefore);
          if (verified.status === 'ok' && verified.value.matches) { entry.expected.set(assignmentKey(record, assignment), { ...assignment, value: verified.value.actual }); if (pairedDate(record, assignment)) entry.dateWrites.set(assignmentKey(record, assignment), ++writeSequence); }
          resultItem.status = verified.status === 'ok' && verified.value.matches ? 'filled' : 'failed'; resultItem.reason = resultItem.status === 'filled' ? undefined : verified.status === 'ok' ? 'readback-mismatch' : verified.code; resultItem.verification = resultItem.status === 'filled' ? 'readback' : 'none'; emit('executing');
        }
        bound = await retryChangedDate(entry, record, bound);
        try { await verifySaved(entry, record, bound); } catch (error) { if (requested || options.signal?.aborted) throw error; for (const assignment of currentPlan(entry, original).assignments) { const resultItem = item(entry, original, assignment); if (['filled','already-correct'].includes(resultItem.status)) { resultItem.status = 'needs-user'; resultItem.reason = 'save-unverified'; resultItem.verification = 'readback'; } } report!.warnings.push(`Save unverified for ${original.recordId ?? 'profile'}`); throw error; }
        entry.finalized.add(recordKey(original));
      } catch (error) {
        check();
        if (quarantineSection(entry, original, error)) continue;
        // Returned field-level control failures already continue above. Thrown
        // auth/source/protocol/unknown errors are global, never generic skips.
        const code = error instanceof Error ? error.message : 'record-execution-failed';
        report!.warnings.push(`record-execution-stopped:${entry.plan.sectionId}:${original.recordType ?? 'singleton'}:${original.recordIndex ?? 'none'}:${original.targetIndex ?? 'none'}:${code}`);
        // Preserve specific already-classified safety stops (identity, version,
        // navigation, etc.) rather than masking them with the pending fallback.
        if (error instanceof Halt && error.paused) throw error;
        if (entry.pendingAdd || entry.pendingSave) throw new Halt('pending-record-mutation-unconfirmed', true);
        throw error;
      }
    }
  };
  const run = async () => {
    if (running) throw new Error('A run is already active'); running = true;
    const abort = () => { requested = 'cancel'; controller.abort(); }; options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (!initialized) await initialize();
      else {
        const snapshot = await scan(); const editable = snapshot.sections.filter(section => work.some(entry => section.sectionId === entry.editor.sectionId || section.sectionId === entry.source.sectionId));
        if (editable.some(section => section.records.some(record => record.fields.length))) {
          const semantic = await analyze({ ...snapshot, sections: editable }, 'resume');
          const resumed = await buildPlan({ ...snapshot, sections: editable }, semantic, [], report!.profileVersion, undefined, 'resume');
          for (const entry of work) {
            const fresh = resumed.sections.find(section => section.sectionId === entry.editor.sectionId || section.sectionId === entry.plan.sectionId);
            if (!fresh) continue; // Closed modal records are revalidated when reopened.
            if (!sameTypes(planTypes(fresh), planTypes(entry.plan)) || fresh.records.length !== entry.plan.records.length || entry.plan.records.some(record => !fresh.records.some(candidate => sameRecord(candidate, record)))) throw new Halt('resume-record-identity-changed', true);
          }
        }
      }
      await execute();
      if (options.auditFinalValues === true) {
        emit('verifying');
        for (const entry of work) for (const record of entry.plan.records) {
          if (entry.quarantined || entry.savedViews.has(recordKey(record))) continue;
          const viewId = entry.views.get(recordKey(record)); if (!viewId) continue;
          const snapshot = await scan(); const current = snapshot.sections.find(section => section.sectionId === entry.editor.sectionId);
          try { if (!current) throw new Halt('final-section-missing'); const bound = await bind(entry, current, viewId, record);
            // Verification is read-only. Overlap each field's unchanged stability
            // window within this one bound record; never overlap writes or records.
            const assignments = record.assignments.filter(assignment => ['filled','already-correct'].includes(item(entry, record, assignment).status));
            const results = await Promise.all(assignments.map(assignment => controls.verifyControl(bound.fieldMap[assignment.templateFieldId]!, entry.expected.get(assignmentKey(record, assignment)) ?? assignment, cctx(bound))));
            check();
            const after = await scan(); checkOverwriteOrder(entry, after);
            if (after.pageRevision !== bound.pageRevision) throw new Halt('final-binding-changed', true);
            for (const [index, assignment] of assignments.entries()) { const resultItem = item(entry, record, assignment), verified = results[index]!; if (verified.status !== 'ok' || !verified.value.matches) { resultItem.status = 'failed'; resultItem.reason = 'final-readback-mismatch'; resultItem.verification = 'none'; } }
          } catch (error) { check(); for (const assignment of record.assignments) { const resultItem = item(entry, record, assignment); if (['filled','already-correct'].includes(resultItem.status)) { resultItem.status = 'needs-user'; resultItem.reason = 'final-binding-unverified'; resultItem.verification = 'none'; } } throw error; }
        }
      } else {
        // Preserve identity/order checks without rereading every filled value.
        // Independent full-value auditing belongs to explicit QA runs.
        const after = await scan();
        for (const entry of work) checkOverwriteOrder(entry, after);
      }
      for (const proof of [...pendingProbes]) await rollbackProbe(proof);
      // Only our own interrupted-attempt warnings become historical after all
      // resumed execution, requested audit and cleanup have succeeded.
      // Equal strings supplied by another warning source are not removed.
      if (transientDeadlineWarnings.size) { report!.warnings = report!.warnings.filter((_, index) => !transientDeadlineWarnings.has(index)); transientDeadlineWarnings.clear(); }
      report!.status = isReportComplete(report!) ? 'completed' : 'partial'; emit(report!.status);
    } catch (error) {
      for (const proof of [...pendingProbes]) await rollbackProbe(proof, true);
      const paused = requested === 'pause' || error instanceof Halt && error.paused; const cancelled = requested === 'cancel' || options.signal?.aborted;
      report!.status = cancelled ? 'cancelled' : paused ? 'paused' : 'failed';
      for (const item of report!.items) if (item.reason === 'pending' || item.reason === 'paused') { item.status = cancelled ? 'cancelled' : 'needs-user'; item.reason = paused ? 'paused' : error instanceof Error ? error.message : 'run-failed'; }
      if (error instanceof Error && !['paused','cancelled'].includes(error.message)) { const index = report!.warnings.length; report!.warnings.push(error.message); if (error instanceof Halt && error.paused && error.code === 'deadline-exceeded') transientDeadlineWarnings.add(index); } emit(report!.status);
    } finally { running = false; options.signal?.removeEventListener('abort', abort); }
    return structuredClone(report!);
  };
  return {
    async start(input = {}) { if (disposed) throw new Error('Runner is disposed'); if (running || state.phase === 'paused') throw new Error('Run already active; resume or cancel it'); options = input; controller = new AbortController(); requested = null; deadlineAt = input.deadlineAt ?? Date.now() + 120000; initialized = false; writeSequence = 0; pendingProbes = []; transientDeadlineWarnings.clear(); quarantinedSections.clear(); continuationValidatedSections.clear(); continuationCheckRequired = false; expectedSiteParser = undefined; plan = null; work = []; documentId = ''; phaseStartedAt = Date.now(); timing = { startedAt: phaseStartedAt, elapsedMs: 0, phaseMs: {}, diagnostics: { operations: [], droppedOperations: 0, pagePerformance: { start: page.getPerformanceMetrics(), current: page.getPerformanceMetrics() } } }; state = { phase: 'idle', runId: null, report: null }; report = { runId: crypto.randomUUID(), documentId: '', profileVersion: '', status: 'partial', items: [], actions: [], warnings: [] }; return run(); },
    pause() { if (running) { requested = 'pause'; controller.abort(); } },
    async resume() { if (disposed || running || state.phase !== 'paused') throw new Error('No paused run to resume'); requested = null; controller = new AbortController(); deadlineAt = options.deadlineAt ?? Date.now() + 120000; return run(); },
    cancel() { requested = 'cancel'; controller.abort(); if (!running && report) { report.status = 'cancelled'; for (const item of report.items) if (item.reason === 'paused') { item.status = 'cancelled'; item.reason = 'cancelled'; } emit('cancelled'); } },
    getState: publicState,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { if (disposed) return; disposed = true; requested = 'cancel'; controller.abort(); listeners.clear(); },
  };
}
