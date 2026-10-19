export const PROTOCOL_VERSION = 'autofill.next.v2' as const;
export const RESUME_SCHEMA_VERSION = 'resume.autofill.v1' as const;
export type RecordType = 'education' | 'experience' | 'campus' | 'project' | 'award' | 'publication' | 'skill' | 'language' | 'certificate';
export type Value = string | number | boolean | string[] | null;
export interface ResumeRecord { id: string; recordType: RecordType; index: number; fields: Record<string, string | boolean | null>; extra?: Record<string, unknown>; }
export interface ResumeContext { schemaVersion: typeof RESUME_SCHEMA_VERSION; profileVersion: string; generatedAt: string; profile: Record<string, unknown>; preferences: Record<string, unknown>; records: ResumeRecord[]; }
export type SourceKey = { scope: 'profile' | 'preferences'; path: string[] } | { scope: 'record'; recordType: RecordType; path: string[] };
export type SourceRef = { scope: 'profile' | 'preferences'; path: string[] } | { scope: 'record'; recordType: RecordType; recordId: string; path: string[] };
export interface FieldDefinition { sourceKey: SourceKey; label: string; valueType: 'string' | 'boolean' | 'number' | 'string[]'; }
export type FieldCatalog = FieldDefinition[];
export interface ValidationIssue { path: string; code: string; message: string; }
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };
export interface OperationContext { signal?: AbortSignal; deadlineAt: number; }
export type StepResult<T> = { status: 'ok'; value: T } | { status: 'needs-user' | 'unsupported' | 'failed' | 'cancelled'; code: string; message: string };
export type FieldKind = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'combobox' | 'date' | 'contenteditable' | 'unknown';
export type Hints = Record<string, string | string[] | number | boolean | null>;
export interface OptionSnapshot { optionId: string; label: string; disabled: boolean; }
export interface FieldSnapshot { fieldId: string; label: string; kind: FieldKind; required: boolean; currentState: 'empty' | 'nonempty' | 'unknown'; hints: Hints; options?: OptionSnapshot[]; groupId?: string; partRole?: string; }
export type ActionKind = 'open-record' | 'add-record' | 'remove-record' | 'save-record' | 'close-record' | 'next-section';
export interface ActionDescriptor { actionId: string; kind: ActionKind; sectionId: string; viewId?: string; label: string; hints: Hints; }
export interface RecordSnapshot { viewId: string; fields: FieldSnapshot[]; }
export interface SectionSnapshot { sectionId: string; label: string; mode: 'inline' | 'modal' | 'multistep' | 'unknown'; repeatable: boolean; records: RecordSnapshot[]; actions: ActionDescriptor[]; }
export interface PageSnapshot { protocolVersion: typeof PROTOCOL_VERSION; documentId: string; pageRevision: number; page: { origin: string; path: string; title: string; hashRoute?: string }; sections: SectionSnapshot[]; }
export type Derivation = 'alibaba-awards-summary' | 'alibaba-paper-venue' | 'alibaba-paper-author' | 'moka-highest-education-school';
export interface SemanticBinding { derivation?: Derivation; templateFieldId: string; sourceKey: SourceKey | null; status: 'resolved' | 'unresolved' | 'unsupported'; resolvedBy: 'site' | 'ai' | null; reason?: string; }
export interface SemanticSection { recordVariants?: { recordType: RecordType; bindings: SemanticBinding[] }[]; recordFilter?: 'papers' | 'alibaba-papers' | 'internships' | 'employment'; sectionId: string; recordType?: RecordType; template: RecordSnapshot; bindings: SemanticBinding[]; }
export interface SemanticPage { documentId: string; pageRevision: number; sections: SemanticSection[]; warnings: string[]; }
export type PartialSemanticPage = { sections: SemanticSection[]; warnings?: string[] };
export interface OptionEvidence { documentId: string; pageRevision: number; probeId: string; sectionId: string; viewId: string; templateFieldId: string; recordId?: string; options: OptionSnapshot[]; status: 'ready' | 'unavailable' | 'failed'; customInput?: 'exact-text'; parentValues?: Record<string, Value>; }
export interface FillAssignment { derivation?: Derivation; sourceRefs?: SourceRef[]; templateFieldId: string; sourceRef: SourceRef | null; value: Value; transform: 'identity' | 'date-format' | 'enum-option' | 'split' | 'join'; status: 'ready' | 'needs-options' | 'missing-source' | 'unresolved' | 'unsupported'; resolvedBy: 'site' | 'ai' | null; reason?: string; }
export interface RecordPlan { recordType: RecordType | null; targetIndex: number | null; recordId: string | null; recordIndex: number | null; assignments: FillAssignment[]; }
export interface SectionPlan { recordTypes?: RecordType[]; sectionId: string; recordType?: RecordType; records: RecordPlan[]; }
export interface FillPlan { runId: string; documentId: string; pageRevision: number; profileVersion: string; sections: SectionPlan[]; warnings: string[]; }
export interface FillScope { sectionIds: string[]; recordIds?: string[]; }
export interface ReadinessRequest { protocolVersion: typeof PROTOCOL_VERSION; requestId: string; runId: string; deadlineAt: number; }
export interface ReadinessResult { profileVersion: string; }
export interface AnalyzeRequest { protocolVersion: typeof PROTOCOL_VERSION; requestId: string; runId: string; deadlineAt: number; snapshot: PageSnapshot; }
export interface PlanRequest extends AnalyzeRequest { semanticPage: SemanticPage; optionEvidence: OptionEvidence[]; scope: FillScope; expectedProfileVersion?: string; }
export interface MappingClient { analyzePage(input: AnalyzeRequest, ctx?: OperationContext): Promise<SemanticPage>; buildFillPlan(input: PlanRequest, ctx?: OperationContext): Promise<FillPlan>; }
export type ApiResult<T> = { ok: true; requestId: string; data: T } | { ok: false; requestId: string; error: { code: string; message: string; retryable: boolean } };
export interface RunItem { recordType?: RecordType | null; targetIndex?: number | null; sectionId: string; sectionLabel?: string; recordId: string | null; recordIndex?: number | null; templateFieldId: string; fieldLabel?: string; status: 'filled' | 'already-correct' | 'skipped' | 'needs-user' | 'failed' | 'cancelled'; reason?: string; verification: 'none' | 'readback' | 'saved'; }
export interface RunAction { sectionId: string; recordId?: string | null; kind: ActionKind; status: 'ok' | 'failed' | 'needs-user' | 'cancelled'; reason?: string; }
export interface RunReport { runId: string; documentId: string; profileVersion: string; status: 'completed' | 'partial' | 'paused' | 'cancelled' | 'failed'; items: RunItem[]; actions: RunAction[]; warnings: string[]; }
