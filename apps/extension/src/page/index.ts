import { PROTOCOL_VERSION } from '@job-assistant/autofill-contracts';
import { readHashRoute } from '@job-assistant/autofill-contracts';
import { createSitePageAdapter } from './adapters/sites.js';
import { ownsSectionNode } from './section-ownership.js';
import { leadingCaption, nearbyFieldCaption, titledFormSections } from './generic-structure.js';
import type { ActionKind, Hints, PageSnapshot, SectionSnapshot, RecordSnapshot, FieldSnapshot, StepResult } from '@job-assistant/autofill-contracts';

export interface OperationContext { signal?: AbortSignal; deadlineAt?: number }
export interface FieldHandle { documentId: string; pageRevision: number; sectionId: string; viewId: string; fieldId: string }
export interface ActionHandle { documentId: string; pageRevision: number; sectionId: string; viewId?: string; actionId: string }
export interface ControlTarget { element: HTMLElement; elements: HTMLElement[]; root: Document | ShadowRoot; kind: FieldSnapshot['kind'] }
export interface ActionTarget { element: HTMLElement; visible: boolean }
export interface BoundRecord { sectionId: string; viewId: string; pageRevision: number; fieldMap: Record<string, FieldHandle>; actionMap: Record<string, ActionHandle>; structureSignature: string }
export interface AdditionBaseline { probeId: string; documentId: string; sectionId: string; baselineViewIds: string[] }
export interface AddedRecordProof extends AdditionBaseline { viewId: string }
export interface SectionChange { sectionId: string; pageRevision: number; documentId: string }
export interface SiteAdapter {
  /** Verified structural adapter: reuse only until the next microtask or DOM mutation. */
  reuseStructureWithinTask?: boolean;
  /** Verified section boundaries allow mutation-scoped refresh across async steps. */
  incrementalSections?: boolean;
  /** Verified external option/calendar portals cannot change form structure. */
  isTransientMutation?(mutation: MutationRecord): boolean;
  includeUnscopedFields?: boolean;
  /** Adapter-provided fields explicitly partition nested semantic sections. */
  includeNestedSections?: boolean;
  /** A verified inline add creates an unsaved row with a scoped rollback. */
  canProbeAddition?(section: Element): boolean;
  rollbackAddedRecord?(record: Element): HTMLElement | undefined;
  sections?(document: Document): Element[];
  records?(section: Element): Element[];
  describeSection?(section: Element): { label?: string; mode?: SectionSnapshot['mode'] };
  describeField?(element: Element): { element?: HTMLElement; label?: string; kind?: FieldSnapshot['kind']; currentState?: FieldSnapshot['currentState']; required?: boolean; hints?: Hints; partRole?: string; groupElement?: Element; elements?: HTMLElement[]; skip?: boolean };
  fields?(section: Element): Element[];
  actions?(section: Element): Element[];
  allowAction?(element: Element, section: Element): boolean;
  describeAction?(element: Element): { kind: ActionKind; label: string } | undefined;
}
const ok = <T>(value: T): StepResult<T> => ({ status: 'ok', value });
const fail = (code: string, message: string): StepResult<never> => ({ status: 'needs-user', code, message });
const controls = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select,[contenteditable="true"],[role="combobox"],[role="textbox"],[role="checkbox"],[role="radio"]';
const hasStructure = (el: Element) => Array.from(el.querySelectorAll(controls)).some(control => !excluded(control)) || Array.from(el.querySelectorAll('button,[role="button"]')).some(button => !excluded(button) && /^(编辑|修改|添加|新增|edit|add)/i.test(clean(button.textContent)));
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
function excluded(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement ?? (node.getRootNode().nodeType === 11 ? (node.getRootNode() as ShadowRoot).host : null)) if (node.hasAttribute('data-autofill-exclude')) return true;
  return false;
}
function visible(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement ?? (node.getRootNode().nodeType === 11 ? (node.getRootNode() as ShadowRoot).host : null)) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(node);
    if (node.hasAttribute('data-autofill-exclude') || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return el.getClientRects().length > 0;
}
// This reader lives for one synchronous scan only; no computed style survives
// a DOM action, asynchronous continuation or subsequent scan.
function scanVisibility(): (element: Element) => boolean {
  const ancestors = new WeakMap<Element, boolean>();
  const shown = (element: Element): boolean => {
    const cached = ancestors.get(element);
    if (cached !== undefined) return cached;
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    const parent = element.parentElement ?? (element.getRootNode().nodeType === 11 ? (element.getRootNode() as ShadowRoot).host : null);
    const result = !element.hasAttribute('data-autofill-exclude') && !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden' && (!parent || shown(parent));
    ancestors.set(element, result);
    return result;
  };
  return element => shown(element) && element.getClientRects().length > 0;
}
function safeText(el: Element | null | undefined): string { if (!el) return ''; const copy = el.cloneNode(true) as Element; copy.querySelectorAll('input,textarea,select,[contenteditable],script,style,[data-autofill-exclude]').forEach(node => node.remove()); return clean(copy.textContent); }
function leverLocation(el: Element): boolean {
  return el.matches('input#location-input.location-input[data-qa="location-input"][name="location"][type="text"]') && Boolean(el.parentElement?.matches('.application-field') && el.parentElement.querySelector(':scope > input#selected-location[type="hidden"][name="selectedLocation"]') && el.parentElement.querySelector(':scope > .dropdown-container .dropdown-results'));
}
function label(el: Element): string {
  // The wrapping label also contains live results and loading text; only its
  // static caption names this field, so search responses cannot stale handles.
  if (leverLocation(el)) {
    const scope = el.parentElement?.parentElement;
    const captions = scope?.matches('label') ? scope.querySelectorAll(':scope > .application-label') : undefined;
    if (captions?.length === 1) return safeText(captions[0]);
  }
  const root = el.getRootNode() as Document | ShadowRoot;
  const refs = el.getAttribute('aria-labelledby')?.split(/\s+/).map(id => safeText(root.getElementById(id))).join(' ');
  const native = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []).map(l => safeText(l)).join(' ') : '';
  return clean(refs || el.getAttribute('aria-label') || native || safeText(el.closest('label')) || nearbyFieldCaption(el, safeText, controls) || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || safeText(el.parentElement?.querySelector(':scope > label,:scope > .label,:scope > .field-label')));
}
function kind(el: Element): FieldSnapshot['kind'] {
  const tag = el.tagName.toLowerCase(), role = el.getAttribute('role'), type = el.getAttribute('type');
  if (leverLocation(el)) return 'combobox';
  if (role === 'combobox') return 'combobox';
  if (role === 'checkbox' || role === 'radio') return role;
  if (el.getAttribute('contenteditable') === 'true') return 'contenteditable';
  if (tag === 'textarea' || tag === 'select') return tag;
  if (type === 'checkbox' || type === 'radio') return type;
  if (type === 'file') return 'unknown';
  if (type === 'date' || type === 'month') return 'date';
  return tag === 'input' || role === 'textbox' ? 'text' : 'unknown';
}
export class PageSession {
  private documentId = crypto.randomUUID();
  private revision = 0;
  private identity: string;
  private disposed = false;
  private ids = new WeakMap<Element, Map<string,string>>();
  private serial = 0;
  private stableRecords = new Map<string, string>();
  private snapshot?: PageSnapshot;
  private diagnostics: Array<{ code: string; message: string }> = [];
  private signature = '';
  private fields = new Map<string, { element: HTMLElement; elements: HTMLElement[]; section: Element; record: Element; handle: FieldHandle; descriptor: FieldSnapshot }>();
  private actions = new Map<string, { element: HTMLElement; section: Element; handle: ActionHandle }>();
  private sections = new Map<string, Element>();
  private observers = new Map<Node, MutationObserver>();
  private listeners = new Map<string, Set<(change: SectionChange) => void>>();
  private refreshing = false;
  private snapshotReusable = false;
  private changeNotificationPending = false;
  private sectionContexts = new Map<string, { root: Document | ShadowRoot; loose: Element[]; boundaries: Element[] }>();
  private dirtySections = new Set<string>();
  private fullRefreshNeeded = true;
  private incrementalReady = false;
  private performanceMetrics = { refreshes: 0, refreshMs: 0, looseControlsVisited: 0, cacheHits: 0, sectionRefreshes: 0, sectionRefreshMs: 0, sectionsScanned: 0 };
  getPerformanceMetrics() { return { ...this.performanceMetrics }; }
  private additions = new Map<string, { baseline: AdditionBaseline; proof?: AddedRecordProof; record?: HTMLElement; fingerprint?: string; saved?: boolean }>();
  private automaticAdapter: boolean;
  private invalidateLayout = () => {
    if (!this.adapter?.incrementalSections || this.disposed) return;
    this.fullRefreshNeeded = true;
    this.invalidateStructure();
  };
  private onResourceLoad = (event: Event) => {
    if ((event.target as Element | null)?.matches?.('link,style,iframe')) this.invalidateLayout();
  };
  constructor(private document: Document, private adapter?: SiteAdapter) {
    this.identity = this.pageIdentity();
    this.automaticAdapter = adapter === undefined;
    if (this.automaticAdapter) this.adapter = createSitePageAdapter(document);
    document.defaultView?.addEventListener('resize', this.invalidateLayout);
    document.addEventListener('load', this.onResourceLoad, true);
  }
  canProbeAddition(sectionId: string): boolean { this.refresh(); const section = this.sections.get(sectionId); return Boolean(section && this.adapter?.canProbeAddition?.(section)); }
  captureRecordAddition(sectionId: string, ctx: OperationContext = {}): StepResult<AdditionBaseline> {
    const error = this.check(ctx); if (error) return error;
    const section = this.refresh().sections.find(candidate => candidate.sectionId === sectionId);
    if (!section || section.mode !== 'inline' || !this.canProbeAddition(sectionId)) return fail('addition-probe-unsupported', 'This section has no verified unsaved addition flow');
    const baseline = { probeId: crypto.randomUUID(), documentId: this.documentId, sectionId, baselineViewIds: section.records.map(record => record.viewId) };
    this.additions.set(baseline.probeId, { baseline }); return ok(baseline);
  }
  observeRecordAddition(baseline: AdditionBaseline, ctx: OperationContext = {}): StepResult<{ record: RecordSnapshot; proof: AddedRecordProof }> {
    const error = this.check(ctx); if (error) return error;
    const registration = this.additions.get(baseline.probeId), snapshot = this.refresh();
    const section = snapshot.sections.find(candidate => candidate.sectionId === baseline.sectionId);
    if (!registration || registration.baseline !== baseline || baseline.documentId !== snapshot.documentId || !section || baseline.baselineViewIds.some((viewId, index) => section.records[index]?.viewId !== viewId)) return fail('addition-baseline-changed', 'Original record identities changed during addition');
    const added = section.records.filter(record => !baseline.baselineViewIds.includes(record.viewId));
    if (added.length !== 1 || !added[0]!.fields.length) return fail('addition-unconfirmed', 'Waiting for a unique added record with actual fields');
    const record = this.fields.get(added[0]!.fields[0]!.fieldId)?.record as HTMLElement | undefined;
    if (!record) return fail('addition-unconfirmed', 'Added record has no current DOM boundary');
    const proof = { ...baseline, viewId: added[0]!.viewId };
    registration.proof = proof; registration.record = record; registration.fingerprint = this.additionFingerprint(record);
    return ok({ record: added[0]!, proof });
  }
  private additionFingerprint(record: Element): string {
    return JSON.stringify(Array.from(record.querySelectorAll('input:not([type="hidden"]),textarea,select,[contenteditable="true"]')).map(element => [element.tagName, element.getAttribute('name'), 'value' in element ? (element as HTMLInputElement).value : element.textContent, (element as HTMLInputElement).checked, element.tagName === 'SELECT' ? Array.from((element as HTMLSelectElement).options).map(option => option.selected) : null]));
  }
  invalidateRecordAddition(viewId: string): void { for (const registration of this.additions.values()) if (registration.proof?.viewId === viewId) registration.saved = true; }
  resolveAddedRecordRollback(proof: AddedRecordProof): StepResult<{ element: HTMLElement; recordElement: HTMLElement; visible: boolean }> {
    const error = this.check(); if (error) return error;
    const registration = this.additions.get(proof.probeId), snapshot = this.refresh();
    const section = snapshot.sections.find(candidate => candidate.sectionId === proof.sectionId), record = registration?.record;
    if (!registration || registration.proof !== proof || proof.documentId !== snapshot.documentId || registration.saved || !section || !record?.isConnected || section.records.length !== proof.baselineViewIds.length + 1 || proof.baselineViewIds.some((viewId, index) => section.records[index]?.viewId !== viewId) || section.records.at(-1)?.viewId !== proof.viewId) return fail('addition-rollback-identity-unconfirmed', 'Only this run’s unsaved added record can be rolled back');
    const meaningfulText = Array.from(record.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]),textarea,[contenteditable="true"]')).some(element => ('value' in element ? (element as HTMLInputElement).value : element.textContent)?.trim());
    if (meaningfulText || registration.fingerprint !== this.additionFingerprint(record)) return fail('addition-rollback-nonempty', 'Added record was edited and cannot be removed');
    const element = this.adapter?.rollbackAddedRecord?.(record);
    if (!element || !record.contains(element) || !visible(element)) return fail('addition-rollback-unavailable', 'No verified rollback action exists inside the added record');
    return ok({ element, recordElement: record, visible: true });
  }
  verifyAddedRecordRollback(proof: AddedRecordProof): StepResult<{ removed: boolean }> {
    const error = this.check(); if (error) return error;
    const registration = this.additions.get(proof.probeId), snapshot = this.refresh(), section = snapshot.sections.find(candidate => candidate.sectionId === proof.sectionId);
    if (!registration || registration.proof !== proof || proof.documentId !== snapshot.documentId || !section || proof.baselineViewIds.some((viewId, index) => section.records[index]?.viewId !== viewId)) return fail('addition-rollback-baseline-changed', 'Original records must remain after rollback');
    const removed = section.records.length === proof.baselineViewIds.length && !section.records.some(record => record.viewId === proof.viewId) && !registration.record?.isConnected;
    return ok({ removed });
  }
  private pageMetadata(): PageSnapshot['page'] {
    const { origin, pathname, hash } = this.document.location;
    const hashRoute = readHashRoute(hash);
    return { origin, path: pathname, title: clean(this.document.title), ...(hashRoute === undefined ? {} : { hashRoute }) };
  }
  private pageIdentity() { const { origin, path, hashRoute } = this.pageMetadata(); return JSON.stringify([origin, path, hashRoute ?? null]); }
  private id(el: Element, prefix: string) { let ids = this.ids.get(el); if (!ids) { ids = new Map(); this.ids.set(el, ids); } let id = ids.get(prefix); if (!id) { id = `${prefix}-${++this.serial}`; ids.set(prefix, id); } return id; }
  private recordId(record: Element, sectionId: string, peers: Element[]): string {
    const evidence = record.getAttribute('data-record-id') || record.id;
    if (!evidence || peers.filter(peer => (peer.getAttribute('data-record-id') || peer.id) === evidence).length !== 1) return this.id(record, 'view');
    const key = JSON.stringify([sectionId, record.tagName, evidence]);
    let viewId = this.stableRecords.get(key);
    if (!viewId) { viewId = this.id(record, 'view'); this.stableRecords.set(key, viewId); }
    this.id(record, 'view'); this.ids.get(record)!.set('view', viewId);
    return viewId;
  }
  private check(ctx: OperationContext = {}): StepResult<never> | undefined {
    if (this.disposed) return fail('disposed', 'Page session is disposed');
    if (ctx.signal?.aborted) return { status: 'cancelled', code: 'aborted', message: 'Operation cancelled' };
    if (ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt) return fail('deadline', 'Operation deadline exceeded');
  }
  private roots(isVisible = visible): Array<Document | ShadowRoot> {
    const roots: Array<Document | ShadowRoot> = [];
    this.diagnostics = [];
    const visit = (root: Document | ShadowRoot) => { roots.push(root); for (const el of root.querySelectorAll('*')) { if (excluded(el)) continue; if (el.shadowRoot) visit(el.shadowRoot); else if (el.tagName.includes('-') && isVisible(el)) this.diagnostics.push({ code: 'opaque-custom-element', message: 'Custom element has no accessible shadow root; closed roots cannot be inspected' }); if (el.tagName === 'IFRAME' && isVisible(el)) { try { const doc = (el as HTMLIFrameElement).contentDocument; if (doc?.documentElement) visit(doc); else this.diagnostics.push({ code: 'inaccessible-frame', message: 'A visible iframe cannot be accessed' }); } catch { this.diagnostics.push({ code: 'inaccessible-frame', message: 'A visible iframe cannot be accessed' }); } } } };
    visit(this.document); return roots;
  }
  private relevantMutations(mutations: MutationRecord[]): boolean {
    return mutations.some(mutation => (mutation.type === 'attributes' && mutation.attributeName === 'data-autofill-exclude' || !(mutation.target.nodeType === 1 ? excluded(mutation.target as Element) : mutation.target.parentElement && excluded(mutation.target.parentElement))) && !this.adapter?.isTransientMutation?.(mutation));
  }
  private consumeMutations(mutations: MutationRecord[]): void {
    const relevant = mutations.filter(mutation => this.relevantMutations([mutation]));
    if (!relevant.length) return;
    if (this.adapter?.incrementalSections) {
      for (const mutation of relevant) {
        const target = mutation.target.nodeType === 1 ? mutation.target as Element : mutation.target.parentElement;
        // Styles, accessible roots, section boundaries and outside portals can
        // affect multiple sections. Do not guess their ownership.
        const special = (node: Node): boolean => node.nodeType === 1 && ((node as Element).matches('style,link,iframe') || Boolean((node as Element).shadowRoot) || Boolean((node as Element).querySelector('style,link,iframe')) || Array.from((node as Element).querySelectorAll('*')).some(element => element.shadowRoot));
        const owner = target && Array.from(this.sections).find(([, section]) => section !== this.document.body && section.contains(target));
        if (!owner || mutation.type === 'attributes' && target === owner[1] || target?.closest('style,link') || Array.from(mutation.addedNodes).some(special) || Array.from(mutation.removedNodes).some(special)) this.fullRefreshNeeded = true;
        else this.dirtySections.add(owner[0]);
      }
    }
    this.invalidateStructure();
  }
  private invalidateStructure(): void {
    this.snapshotReusable = false;
    // takeRecords() can consume changes before observer delivery. Keep section
    // listeners notified even when a synchronous control gate saw them first.
    if (this.disposed || !Array.from(this.listeners.values()).some(listeners => listeners.size > 0) || this.changeNotificationPending) return;
    this.changeNotificationPending = true;
    queueMicrotask(() => {
      this.changeNotificationPending = false;
      if (this.disposed) return;
      this.refresh();
      for (const [sectionId, listeners] of this.listeners) for (const listener of listeners) listener({ sectionId, documentId: this.documentId, pageRevision: this.revision });
    });
  }
  private observe(root: Document | ShadowRoot) {
    if (this.observers.has(root)) return;
    const Observer = root.ownerDocument?.defaultView?.MutationObserver ?? this.document.defaultView!.MutationObserver;
    const observer = new Observer(mutations => {
      if (!this.relevantMutations(mutations) || this.disposed || this.refreshing) return;
      if (this.adapter?.reuseStructureWithinTask || this.adapter?.incrementalSections) this.consumeMutations(mutations);
      else {
        this.refresh();
        for (const [sectionId, listeners] of this.listeners) for (const listener of listeners) listener({ sectionId, documentId: this.documentId, pageRevision: this.revision });
      }
    });
    // The opt-in path drains all mutations before reuse, including labels and
    // attributes such as readonly/required that adapters use for structure.
    observer.observe(root, this.adapter?.reuseStructureWithinTask || this.adapter?.incrementalSections
      ? { subtree: true, childList: true, attributes: true, characterData: true }
      : { subtree: true, childList: true, attributes: true, attributeFilter: ['id','name','type','role','hidden','style','class','aria-hidden','aria-label','aria-labelledby','disabled','data-autofill-exclude'] });
    this.observers.set(root, observer);
  }
  private scanSectionElement(section: Element, root: Document | ShadowRoot, loose: Element[], boundaries: Element[], isVisible: (element: Element) => boolean): SectionSnapshot {
    this.performanceMetrics.sectionsScanned++;
    const labels = new WeakMap<Element, string>();
    const fieldLabel = (element: Element) => { let value = labels.get(element); if (value === undefined) { value = label(element); labels.set(element, value); } return value; };
    const sectionId = this.id(section, 'section'); this.sections.set(sectionId, section);
    const scoped = Array.from(this.adapter?.fields?.(section) ?? (section === (root as Document).body || section === (root as ShadowRoot).host ? root.querySelectorAll(controls) : section.querySelectorAll(controls))).filter(el => isVisible(el) && !el.closest('[role="listbox"],[role="menu"]') && (loose.length === 0 || section !== (root as Document).body && section !== (root as ShadowRoot).host || loose.includes(el)));
    const adaptedRecords = this.adapter?.records?.(section);
    const explicit = (adaptedRecords ?? Array.from(section.querySelectorAll('[data-record-id],[data-record],article,[role="group"],.record,.education-item,.experience-item'))).filter(el => ownsSectionNode(section, el, boundaries) && isVisible(el) && hasStructure(el));
    // An adapter's empty list is authoritative: do not borrow nested groups.
    if (adaptedRecords === undefined && !explicit.length) {
      for (const parent of [section, ...Array.from(section.querySelectorAll('div,ul,ol'))]) {
        const children = Array.from(parent.children).filter(child => ownsSectionNode(section, child, boundaries) && isVisible(child) && child.querySelectorAll(controls).length >= 2);
        if (children.length < 2) continue;
        const shape = (child: Element) => Array.from(child.querySelectorAll(controls)).map(control => [fieldLabel(control),kind(control)]);
        if (children.every(child => JSON.stringify(shape(child)) === JSON.stringify(shape(children[0]!)))) { explicit.push(...children); break; }
      }
    }
    const recordContainers = explicit.filter(el => !explicit.some(other => other !== el && other.contains(el)));
    // Generic section-level controls (for example “no experience”) are not an
    // extra experience. The fallback pass retains them as singleton fields.
    if (this.adapter && recordContainers.length && scoped.some(el => !recordContainers.some(record => record.contains(el)))) recordContainers.push(section);
    const records: RecordSnapshot[] = [];
    const registeredTargets = new Set<Element>();
    for (const record of recordContainers.length ? recordContainers : [section]) {
      const viewId = this.recordId(record, sectionId, recordContainers.length ? recordContainers : [section]); const fields: FieldSnapshot[] = [];
      for (const el of scoped.filter(el => (record.contains(el) || record === (root as ShadowRoot).host) && (record !== section || !recordContainers.some(other => other !== section && other.contains(el))))) {
        if (el.parentElement?.closest(controls) || el.tagName === 'INPUT' && el.parentElement?.closest('[role="combobox"]')) continue;
        const adaptation = this.adapter?.describeField?.(el); if (adaptation?.skip) continue; const target = adaptation?.element ?? el as HTMLElement;
        if (excluded(target) || registeredTargets.has(target)) continue; registeredTargets.add(target);
        const fieldId = this.id(target, 'field'); const k = adaptation?.kind ?? kind(el);
        const peers = adaptation?.elements ?? (k === 'radio' && el.getAttribute('name') ? scoped.filter(peer => kind(peer) === 'radio' && peer.getAttribute('name') === el.getAttribute('name') && record.contains(peer) && peer.getRootNode() === el.getRootNode()) : [el]);
        if (peers[0] !== el && !adaptation?.elements) continue;
        const groupLabel = peers.length > 1 ? clean(el.closest('[role="radiogroup"]')?.getAttribute('aria-label') || safeText(el.closest('fieldset')?.querySelector(':scope > legend')) || el.getAttribute('name')) : ''; 
        const value = 'value' in el ? (el as HTMLInputElement).value : el.textContent;
        const state = k === 'checkbox' || k === 'radio' ? (peers.some(peer => (peer as HTMLInputElement).checked || peer.getAttribute('aria-checked') === 'true') ? 'nonempty' : 'empty') : leverLocation(el) ? ((el.parentElement?.querySelector<HTMLInputElement>(':scope > input#selected-location')?.value) ? 'nonempty' : value ? 'unknown' : 'empty') : value ? 'nonempty' : 'empty';
        const descriptor = { fieldId, label: adaptation?.label || groupLabel || fieldLabel(el), kind: k, required: adaptation?.required ?? (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true'), currentState: adaptation?.currentState ?? state, ...(adaptation?.partRole ? { partRole: adaptation.partRole } : {}), ...(adaptation?.groupElement ? { groupId: this.id(adaptation.groupElement, 'group') } : {}), hints: { tag: target.tagName.toLowerCase(), name: el.getAttribute('name') ?? '', role: el.getAttribute('role') ?? '', inputType: el.getAttribute('type') ?? '', disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true', ...adaptation?.hints, ...(peers.length > 1 ? { memberIds: peers.map(peer => this.id(peer, 'radio')) } : {}) }, ...(k === 'radio' && peers.length > 1 ? { groupId: fieldId, options: peers.map((peer, index) => ({ optionId: `${fieldId}-radio-${index}`, label: fieldLabel(peer), disabled: peer.hasAttribute('disabled') })) } : {}), ...(k === 'select' ? { options: Array.from((el as HTMLSelectElement).options).map((o, i) => ({ optionId: `${fieldId}-option-${i}`, label: clean(o.textContent), disabled: o.disabled })) } : {}) } as FieldSnapshot;
        fields.push(descriptor); this.fields.set(fieldId, { element: target, elements: adaptation?.elements ?? (adaptation?.element ? [target] : peers) as HTMLElement[], section, record, descriptor, handle: { documentId: this.documentId, pageRevision: this.revision, sectionId, viewId, fieldId } });
      }
      if (fields.length || record !== section && hasStructure(record)) records.push({ viewId, fields });
    }
    const actions: SectionSnapshot['actions'] = [];
    for (const el of new Set([...section.querySelectorAll('button,a,[role="button"],input[type="button"]'), ...this.adapter?.actions?.(section) ?? []])) {
      if (!ownsSectionNode(section, el, boundaries) || !isVisible(el) || this.adapter?.allowAction?.(el, section) === false || Array.from(registeredTargets).some(target => target.contains(el))) continue; const text = clean(el.getAttribute('aria-label') || el.textContent || el.getAttribute('value') || el.getAttribute('title'));
      const adaptedAction = this.adapter?.describeAction?.(el);
      const actionKind = adaptedAction?.kind ?? (/^(添加|新增|增加|add)(\s|教育|工作|经历|记录|项目|$)/i.test(text) ? 'add-record' : /^(保存|save)$/i.test(text) ? 'save-record' : /^(编辑|修改|edit)(\s|教育|工作|经历|记录|项目|$)/i.test(text) ? 'open-record' : /^(取消|关闭|cancel|close)$/i.test(text) ? 'close-record' : /^(下一步|下一节|next)$/i.test(text) ? 'next-section' : undefined);
      if (!actionKind || /投递|提交申请|apply|submit/i.test(text)) continue;
      const actionId = this.id(el, 'action'); const record = actionKind === 'add-record' ? undefined : recordContainers.find(r => r.contains(el)); const viewId = record ? this.recordId(record, sectionId, recordContainers) : undefined;
      actions.push({ actionId, kind: actionKind, sectionId, ...(viewId ? { viewId } : {}), label: adaptedAction?.label ?? text, hints: { tag: el.tagName.toLowerCase(), disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' } });
      this.actions.set(actionId, { element: el as HTMLElement, section, handle: { documentId: this.documentId, pageRevision: this.revision, sectionId, viewId, actionId } });
    }
    const sectionInfo = this.adapter?.describeSection?.(section);
    return { sectionId, label: sectionInfo?.label ?? (clean(section.getAttribute('aria-label') || safeText(section.querySelector('legend,h1,h2,h3,h4'))) || leadingCaption(section, safeText) || 'Form'), mode: sectionInfo?.mode ?? (section.matches('[role="dialog"],dialog') ? 'modal' : actions.some(action => action.kind === 'next-section') ? 'multistep' : 'inline'), repeatable: records.length > 1 || actions.some(a => a.kind === 'add-record'), records, actions };
  }
  private publish(sections: SectionSnapshot[]): PageSnapshot {
    const signature = JSON.stringify(sections.map(s => [s.sectionId, s.label, s.records.map(r => [r.viewId, r.fields.map(f => [f.fieldId,f.label,f.kind,f.required,f.groupId,f.partRole, Object.fromEntries(Object.entries(f.hints).filter(([key]) => key !== 'disabled'))])]), s.actions.map(a => [a.actionId,a.kind,a.viewId,a.label])] ));
    if (signature !== this.signature) { this.signature = signature; this.revision++; }
    for (const entry of this.fields.values()) entry.handle.pageRevision = this.revision;
    for (const entry of this.actions.values()) entry.handle.pageRevision = this.revision;
    this.snapshot = { protocolVersion: PROTOCOL_VERSION, documentId: this.documentId, pageRevision: this.revision, page: this.pageMetadata(), sections };
    
    return this.snapshot!;
  }
  private refreshChangedSections(): PageSnapshot | undefined {
    if (!this.snapshot || !this.incrementalReady || this.fullRefreshNeeded) return;
    if (!this.dirtySections.size) { this.performanceMetrics.cacheHits++; return this.snapshot; }
    const isVisible = scanVisibility();
    // Cheap boundary discovery catches newly nested sections or loss of the
    // last record. It does not enumerate fields in unaffected sections.
    const candidates = this.adapter!.sections!(this.document).filter(section => isVisible(section) && (hasStructure(section) || this.adapter?.actions?.(section).some(isVisible)));
    const known = Array.from(this.sections).filter(([id, section]) => this.sectionContexts.get(id)?.root === this.document && section !== this.document.body).map(([, section]) => section);
    if (candidates.length !== known.length || candidates.some((section, index) => section !== known[index])) return;
    const started = performance.now();
    try {
      const sections = this.snapshot.sections.map(previous => {
        if (!this.dirtySections.has(previous.sectionId)) return previous;
        const section = this.sections.get(previous.sectionId)!, context = this.sectionContexts.get(previous.sectionId)!;
        for (const [id, entry] of this.fields) if (entry.handle.sectionId === previous.sectionId) this.fields.delete(id);
        for (const [id, entry] of this.actions) if (entry.handle.sectionId === previous.sectionId) this.actions.delete(id);
        this.performanceMetrics.sectionRefreshes++;
        return this.scanSectionElement(section, context.root, context.loose, context.boundaries, isVisible);
      });
      this.dirtySections.clear();
      return this.publish(sections);
    } finally { this.performanceMetrics.sectionRefreshMs += performance.now() - started; }
  }
  private refreshSection(sectionId: string): PageSnapshot {
    if (this.adapter?.incrementalSections && this.sections.has(sectionId) && this.sections.get(sectionId) !== this.document.body) {
      this.dirtySections.add(sectionId);
      return this.refresh();
    }
    return this.refresh(true);
  }
  private refresh(force = false): PageSnapshot {
    const identity = this.pageIdentity();
    if (this.adapter?.reuseStructureWithinTask || this.adapter?.incrementalSections) {
      for (const observer of this.observers.values()) this.consumeMutations(observer.takeRecords());
      if (!force && this.adapter?.incrementalSections && identity === this.identity) {
        const updated = this.refreshChangedSections();
        if (updated) return updated;
      }
      if (!this.adapter?.incrementalSections && !force && this.snapshotReusable && this.snapshot && identity === this.identity) {
        this.performanceMetrics.cacheHits++;
        return this.snapshot;
      }
    }
    this.snapshotReusable = false;
    const isVisible = scanVisibility();
    const started = performance.now(); this.performanceMetrics.refreshes++;
    this.refreshing = true;
    try {
      if (identity !== this.identity) {
        this.identity = identity; this.documentId = crypto.randomUUID(); this.signature = '';
        for (const observer of this.observers.values()) observer.disconnect();
        this.observers.clear();
        // Content scripts can start on a SPA job-detail route before the form
        // exists. Re-select only automatically chosen adapters on navigation.
        if (this.automaticAdapter) this.adapter = createSitePageAdapter(this.document);
      }
      const sections: SectionSnapshot[] = []; this.fields.clear(); this.actions.clear(); this.sections.clear(); this.sectionContexts.clear();
      const roots = this.roots(isVisible);
      for (const root of roots) {
        this.observe(root);
        const candidates = (root.nodeType === 9 ? this.adapter?.sections?.(root as Document) : undefined) ?? (this.adapter?.includeUnscopedFields === false ? [] : Array.from(root.querySelectorAll('fieldset,section,[role="region"],[role="dialog"],dialog,form')));
        if (!this.adapter) for (const parent of [...candidates]) candidates.push(...titledFormSections(parent, { readText: safeText, hasStructure, visible: isVisible, controls }));
        const containers = candidates.filter(el => isVisible(el) && (hasStructure(el) || this.adapter?.actions?.(el).some(action => isVisible(action))) && (this.adapter?.includeNestedSections || !candidates.some(other => other !== el && el.contains(other) && hasStructure(other))));
        const looseCandidates = this.adapter?.includeUnscopedFields === false ? [] : Array.from(root.querySelectorAll(controls)); this.performanceMetrics.looseControlsVisited += looseCandidates.length;
        const loose = looseCandidates.filter(el => isVisible(el) && !el.closest('[role="listbox"],[role="menu"]') && !containers.some(section => section.contains(el)));
        const fallback = root.nodeType === 9 ? (root as Document).body : (root as ShadowRoot).host;
        const declaredFallback = containers.includes(fallback);
        if (this.adapter?.includeUnscopedFields !== false) containers.push(fallback);
        const boundaries = [...new Set(containers)];
        for (const section of boundaries.filter(section => section !== fallback || declaredFallback)) {
          this.sectionContexts.set(this.id(section, 'section'), { root, loose, boundaries });
          sections.push(this.scanSectionElement(section, root, loose, boundaries, isVisible));
        }
        if (!this.adapter) {
          const registered = new Set(Array.from(this.fields.values()).flatMap(field => field.elements));
          for (const element of looseCandidates) if (!registered.has(element as HTMLElement) && !loose.includes(element) && !element.parentElement?.closest(controls) && isVisible(element) && !element.closest('[role="listbox"],[role="menu"]')) loose.push(element);
        }
        if (!declaredFallback && loose.length && this.adapter?.includeUnscopedFields !== false) {
          this.sectionContexts.set(this.id(fallback, 'section'), { root, loose, boundaries });
          sections.push(this.scanSectionElement(fallback, root, loose, boundaries, isVisible));
        }
      }
      this.publish(sections);
      this.dirtySections.clear(); this.fullRefreshNeeded = false;
      const boundaries = Array.from(this.sections).filter(([id, section]) => this.sectionContexts.get(id)?.root === this.document && section !== this.document.body).map(([, section]) => section);
      // Other extensions can add observed shadow roots. They remain registered
      // and observed; mutations there fall back globally, but their presence
      // alone must not disable incremental updates to the main form.
      this.incrementalReady = Boolean(this.adapter?.incrementalSections && this.adapter.sections && boundaries.length && !boundaries.some(section => boundaries.some(other => section !== other && section.contains(other))));
      if (this.adapter?.reuseStructureWithinTask) {
        this.snapshotReusable = true;
        queueMicrotask(() => { this.snapshotReusable = false; });
      }
      return this.snapshot!;
    } finally { this.refreshing = false; this.performanceMetrics.refreshMs += performance.now() - started; }
  }
  async scanPage(ctx: OperationContext = {}): Promise<StepResult<PageSnapshot>> { return this.check(ctx) ?? ok(this.refresh(!this.adapter?.incrementalSections)); }
  async scanSection(sectionId: string, ctx: OperationContext = {}): Promise<StepResult<SectionSnapshot>> { const error = this.check(ctx); if (error) return error; const section = this.refreshSection(sectionId).sections.find(s => s.sectionId === sectionId); return section ? ok(section) : fail('missing-section', 'Section no longer exists'); }
  getDiagnostics(): Array<{ code: string; message: string }> { if (this.disposed) return []; this.refresh(); return this.diagnostics.map(item => ({ ...item })); }
  getIdentity(): { documentId: string; pageRevision: number } { if (!this.disposed) this.refresh(); return { documentId: this.documentId, pageRevision: this.revision }; }
  getFieldHandle(fieldId: string): FieldHandle | undefined { if (this.disposed) return undefined; this.refresh(); const h = this.fields.get(fieldId)?.handle; return h ? { ...h } : undefined; }
  getActionHandle(actionId: string): ActionHandle | undefined { if (this.disposed) return undefined; this.refresh(); const h = this.actions.get(actionId)?.handle; return h ? { ...h } : undefined; }
  async bindRecord({ sectionId, viewId, template }: { sectionId: string; viewId: string; template: RecordSnapshot }, ctx: OperationContext = {}): Promise<StepResult<BoundRecord>> {
    const error = this.check(ctx); if (error) return error;
    const section = this.refreshSection(sectionId).sections.find(s => s.sectionId === sectionId); const record = section?.records.find(r => r.viewId === viewId);
    if (!record) return fail('ambiguous-record', 'Current record identity cannot be proved');
    const fieldMap: Record<string, FieldHandle> = {}; const used = new Set<string>();
    for (const field of template.fields) {
      const matches = record.fields.filter(current => current.kind === field.kind && current.label === field.label && current.partRole === field.partRole && (current.fieldId === field.fieldId || ['tag','name','role','inputType','component','placeholder'].every(key => current.hints[key] === field.hints[key])));
      const exact = matches.find(current => current.fieldId === field.fieldId); const candidates = exact ? [exact] : matches;
      if (candidates.length !== 1 || used.has(candidates[0]!.fieldId)) return fail('incompatible-template', 'Field structure is missing or ambiguous');
      const current = candidates[0]!; used.add(current.fieldId); fieldMap[field.fieldId] = { ...this.fields.get(current.fieldId)!.handle };
    }
    if (used.size !== record.fields.length) return fail('incompatible-template', 'Record field structure changed');
    const actionMap: Record<string, ActionHandle> = {}; for (const action of section!.actions) if (!action.viewId || action.viewId === viewId) actionMap[action.actionId] = { ...this.actions.get(action.actionId)!.handle };
    return ok({ sectionId, viewId, pageRevision: this.revision, fieldMap, actionMap, structureSignature: JSON.stringify(record.fields.map(f => [f.label,f.kind,f.hints])) });
  }
  resolveField(handle: FieldHandle): StepResult<ControlTarget> {
    const error = this.check(); if (error) return error; this.refresh(); const entry = this.fields.get(handle.fieldId);
    if (handle.documentId !== this.documentId || handle.pageRevision !== this.revision || !entry || entry.handle.sectionId !== handle.sectionId || entry.handle.viewId !== handle.viewId || !entry.element.isConnected || !visible(entry.element)) return fail('stale-handle', 'Field binding changed; rescan and bind again');
    return ok({ element: entry.element, elements: entry.elements, root: entry.element.getRootNode() as Document | ShadowRoot, kind: entry.descriptor.kind });
  }
  resolveAction(handle: ActionHandle): StepResult<ActionTarget> {
    const error = this.check(); if (error) return error; this.refresh(); const entry = this.actions.get(handle.actionId);
    if (handle.documentId !== this.documentId || handle.pageRevision !== this.revision || !entry || entry.handle.sectionId !== handle.sectionId || entry.handle.viewId !== handle.viewId || !entry.element.isConnected) return fail('stale-handle', 'Action binding changed; rescan again');
    return ok({ element: entry.element, visible: visible(entry.element) });
  }
  observeSection(sectionId: string, listener: (change: SectionChange) => void): () => void { if (this.disposed) return () => {}; this.refresh(); let listeners = this.listeners.get(sectionId); if (!listeners) { listeners = new Set(); this.listeners.set(sectionId, listeners); } listeners.add(listener); return () => { listeners!.delete(listener); }; }
  dispose() { if (this.disposed) return; this.disposed = true; this.document.defaultView?.removeEventListener('resize', this.invalidateLayout); this.document.removeEventListener('load', this.onResourceLoad, true); for (const observer of this.observers.values()) observer.disconnect(); this.observers.clear(); this.listeners.clear(); this.fields.clear(); this.actions.clear(); this.sections.clear(); this.sectionContexts.clear(); this.dirtySections.clear(); this.snapshot = undefined; this.stableRecords.clear(); this.additions.clear(); }
}
export const createPageSession = ({ document, siteAdapter }: { document: Document; siteAdapter?: SiteAdapter }) => new PageSession(document, siteAdapter);
export { createMeituanPageAdapter } from './adapters/meituan.js';
export { createTencentPageAdapter } from './adapters/tencent.js';
export { createAlibabaPageAdapter } from './adapters/alibaba.js';
export { createSitePageAdapter } from './adapters/sites.js';
