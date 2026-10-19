import type { ActionKind, FillAssignment, OperationContext, OptionEvidence, OptionSnapshot, StepResult, Value } from '@job-assistant/autofill-contracts';
import type { ActionHandle, AddedRecordProof, ControlTarget, FieldHandle, PageSession } from '../page/index.js';
import { isStaticDismissal } from './static-dismissal.js';

export type InspectionStage = 'open' | 'query' | 'options' | 'cleanup';
export interface InspectionStageTiming { stage: InspectionStage; durationMs: number; outcome: 'ok' | 'failed' }
export interface ControlContext extends OperationContext { sectionId: string; viewId?: string; overwrite?: 'preserve' | 'replace'; replaceIfValue?: { value: Value }; allowCollegeReset?: boolean; query?: string; cleanupDeadlineAt?: number; onInspectionStage?: (timing: InspectionStageTiming) => void; verification?: 'existing' | 'after-write' }
export interface ControlValue { value: Value }
export interface ControlInspection { supported: boolean; kind: ControlTarget['kind']; optionEvidence?: OptionEvidence }
export interface WriteReceipt { attempted: boolean; value: Value }
export interface Verification { matches: boolean; actual: Value }
export interface ActionIntent { kind: ActionKind; sectionId: string; viewId?: string }
export interface ActionReceipt { actionId: string; kind: ActionKind; attempted: boolean; observed: boolean }
/** Adapter callbacks supply scope evidence; all clicks still pass the driver gate. */
export interface ControlAdapter {
  approveAction?(element: HTMLElement, intent: ActionIntent, handle: ActionHandle): boolean;
  datePanel?(element: HTMLElement): DatePanel | undefined;
  combo?(element: HTMLElement): ComboControl | undefined;
  allowDecorativeClick?(control: HTMLElement, target: HTMLElement): boolean;
  ownsDatePanel?(element: HTMLElement, panel: HTMLElement): boolean;
  beforeDateOpen?(element: HTMLElement): void;
  dateOpenTarget?(element: HTMLElement): HTMLElement | undefined;
  dateOpenActivation?(element: HTMLElement): 'pointer' | undefined;
  readValue?(element: HTMLElement): Value | undefined;
  approveDismissal?(control: HTMLElement, target: { element: HTMLElement; scope: HTMLElement }): boolean;
  dateRange?(start: HTMLElement, end: HTMLElement): DateRangeControl | undefined;
  addedRecordRollback?(record: HTMLElement, opener: HTMLElement): AddedRecordRollbackControl | undefined;
}
export interface ComboControl {
  beforeOpen(): void;
  focusTarget?(): HTMLElement;
  unsupportedReason?: string;
  panel(): HTMLElement | undefined;
  openTarget(): HTMLElement;
  closeTarget(): HTMLElement;
  dismiss?(): { element: HTMLElement; scope: HTMLElement } | null;
  readValue(): Value;
  options(panel: HTMLElement): HTMLElement[];
  optionLabel?(node: HTMLElement): string;
  optionDisabled?(node: HTMLElement): boolean;
  writeBlockedReason?(label: string, context: ControlContext): string | undefined;
  searchInput(): HTMLInputElement | HTMLTextAreaElement | null;
  loading?(panel: HTMLElement): boolean;
  empty?(panel: HTMLElement): boolean;
  beforeQuery?(): void;
  queryKeydown?: 'Backspace';
  optionActivation?: 'mousedown' | 'pointer';
  restoreQueryAfterClose?: boolean;
  restoreQuerySilently?: boolean;
  blurToClose?: boolean;
  isOpen?(): boolean;
  beforeSelection?(label: string): void;
  selectionConfirmed?(label: string): boolean;
  dismissAfterSelection?: boolean;
  customInput?(): { openTarget(): HTMLElement | null; input(): HTMLInputElement | null; commitTarget(): HTMLElement | null } | undefined;
  multiple?: {
    choiceTarget(node: HTMLElement): HTMLElement | undefined;
    choiceSelected(node: HTMLElement): boolean;
  };
}
export interface AddedRecordRollbackControl {
  deleteTarget(): { element: HTMLElement; scope: HTMLElement } | undefined;
  beforeDelete(): void;
  confirmationTarget(): { element: HTMLElement; scope: HTMLElement } | undefined;
}
export interface YearPicker {
  openTarget(): HTMLElement | null;
  readRange(): { first: number; last: number } | undefined;
  previous(): HTMLElement | null;
  next(): HTMLElement | null;
  choice(year: number): HTMLElement | null;
  choiceDisabled(year: number): boolean;
}
export interface DateRangeControl {
  root: HTMLElement;
  beforeOpen(): void;
  openTarget(): HTMLElement;
  panel(): HTMLElement | undefined;
  part(index: 0 | 1): DatePanel | undefined;
  confirm(): HTMLElement | null;
  escapeTarget(): HTMLElement | null;
  dismiss?(): { element: HTMLElement; scope: HTMLElement } | null;
}
export interface DatePanel {
  panel: HTMLElement;
  precision: 'day' | 'month' | 'year';
  activation?: 'pointer';
  navigationUnit?: 'month' | 'year';
  yearPicker?(): YearPicker;
  yearStep?(direction: 'previous' | 'next'): HTMLElement | null;
  isOpen?(): boolean;
  readMonth(): { year: number; month: number };
  previous(): HTMLElement | null;
  next(): HTMLElement | null;
  choice(value: string): HTMLElement | null;
  choiceOpenTarget?(): HTMLElement | null;
  choiceDisabled?(value: string): boolean;
  close(): HTMLElement | null;
  dismiss?(): { element: HTMLElement; scope: HTMLElement } | null;
}
export interface ControlDriver {
  inspectControl(handle: FieldHandle, ctx: ControlContext): Promise<StepResult<ControlInspection>>;
  writeControl(handle: FieldHandle, assignment: FillAssignment, ctx: ControlContext): Promise<StepResult<WriteReceipt>>;
  writeDateRange?(startHandle: FieldHandle, startAssignment: FillAssignment, endHandle: FieldHandle, endAssignment: FillAssignment, ctx: ControlContext): Promise<StepResult<{ start: WriteReceipt; end: WriteReceipt }>>;
  readControl(handle: FieldHandle, ctx: ControlContext): Promise<StepResult<ControlValue>>;
  verifyControl(handle: FieldHandle, assignment: FillAssignment, ctx: ControlContext): Promise<StepResult<Verification>>;
  performAction(handle: ActionHandle, intent: ActionIntent, ctx: ControlContext): Promise<StepResult<ActionReceipt>>;
  rollbackAddedRecord?(proof: AddedRecordProof, ctx: ControlContext): Promise<StepResult<{ removed: boolean }>>;
  dispose(): void;
}
const ok = <T>(value: T): StepResult<T> => ({ status: 'ok', value });
class ControlError extends Error { constructor(readonly code: string, readonly status: 'needs-user' | 'unsupported' | 'failed' | 'cancelled' = 'needs-user') { super(code); } }
const text = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const norm = (value: Value) => Array.isArray(value) ? JSON.stringify([...value].sort()) : typeof value === 'string' ? text(value) : value;
function visible(element: HTMLElement): boolean { return visibleForClick(element, false); }
function visibleForClick(element: HTMLElement, ignoreOwnAriaHidden: boolean): boolean {
  if (!element.isConnected || !element.getClientRects().length) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' && !(ignoreOwnAriaHidden && node === element) || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
function inputOf(target: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  return target.matches('input,textarea') ? target as HTMLInputElement | HTMLTextAreaElement : target.querySelector('input,textarea');
}
function radioLabel(node: HTMLElement): string {
  const aria = text(node.getAttribute('aria-label'));
  if (aria) return aria;
  const label = (node as HTMLInputElement).labels?.[0];
  const source = label ?? (node.getAttribute('role') === 'radio' ? node : undefined);
  if (!source) return '';
  const copy = source.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('input,textarea,select,script,style,[hidden],[aria-hidden="true"]').forEach(element => element.remove());
  return text(copy.textContent);
}
function readValue(target: ControlTarget): Value {
  const element = target.element;
  if (target.kind === 'radio') { const selected = target.elements.find(node => node.matches('input') ? (node as HTMLInputElement).checked : node.getAttribute('aria-checked') === 'true'); return selected ? radioLabel(selected) : ''; }
  if (target.kind === 'checkbox') return element.matches('input') ? (element as HTMLInputElement).checked : element.getAttribute('aria-checked') === 'true';
  if (target.kind === 'select') { const select = element as HTMLSelectElement; const labels = Array.from(select.selectedOptions).map(option => option.value === '' ? '' : text(option.label)); return select.multiple ? labels : labels[0] ?? ''; }
  if (target.kind === 'contenteditable') return text(element.textContent);
  const input = inputOf(element);
  if (input) return input.value;
  if (target.kind === 'combobox') return text(element.getAttribute('aria-valuetext') ?? element.textContent);
  throw new ControlError('unreadable-control', 'unsupported');
}
function setInput(element: HTMLInputElement | HTMLTextAreaElement, value: string, emitEvents = true) {
  if (element.readOnly || element.disabled) throw new ControlError('not-writable');
  const win = element.ownerDocument.defaultView!;
  const prototype = element.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new ControlError('missing-native-setter', 'unsupported');
  setter.call(element, value);
  if (!emitEvents) return;
  element.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  element.dispatchEvent(new win.Event('change', { bubbles: true }));
}

/** Scope proof for a local record editor with explicit Save and Cancel controls. */
export const dialogSaveAdapter: ControlAdapter = {
  approveAction(element, intent) {
    if (intent.kind !== 'save-record' || element.matches('input[type="submit"],button[type="submit"]') || element.tagName === 'BUTTON' && !element.hasAttribute('type') && Boolean(element.closest('form'))) return false;
    const dialog = element.closest('dialog[open],[role="dialog"][aria-modal="true"]');
    if (!dialog || !/^(保存|save)$/i.test(text(element.getAttribute('aria-label') || element.textContent))) return false;
    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button,[role="button"],input[type="button"],input[type="submit"]')).filter(visible);
    if (buttons.some(button => /投递|提交|删除|delete|submit|apply/i.test(text(button.getAttribute('aria-label') || button.textContent)))) return false;
    return buttons.some(button => /^(取消|关闭|cancel|close)$/i.test(text(button.getAttribute('aria-label') || button.textContent))) && Boolean(dialog.querySelector('input,textarea,select,[contenteditable="true"]'));
  },
};

export function createControlDriver({ page, adapters = [] }: { page: PageSession; adapters?: ControlAdapter[] }): ControlDriver {
  let disposed = false;
  const lifetime = new AbortController();
  const probes = new Map<string, { probeId: string; nodes: Map<string, HTMLElement>; labels: Map<string, string>; parentState: string; query?: string; customInput?: 'exact-text' }>();
  const settledWrites = new WeakMap<HTMLElement, { documentId: string; pageRevision: number; fieldId: string; value: Value; at: number }>();
  // Diagnostic observers receive enums and durations only. They are never an
  // authority for control behavior, and their exceptions cannot escape.
  const inspectionClock = (ctx: ControlContext) => {
    let stage: InspectionStage | undefined, startedAt = 0;
    const finish = (outcome: InspectionStageTiming['outcome']) => {
      if (!stage) return;
      const timing = { stage, durationMs: Math.max(0, performance.now() - startedAt), outcome };
      stage = undefined;
      try { ctx.onInspectionStage?.(timing); } catch { /* Diagnostics are observational. */ }
    };
    return { start(next: InspectionStage) { finish('ok'); stage = next; startedAt = performance.now(); }, finish };
  };
  let sequence = 0;
  const check = (ctx: ControlContext) => {
    if (disposed) throw new ControlError('disposed', 'cancelled');
    if (ctx.signal?.aborted) throw new ControlError('aborted', 'cancelled');
    if (!Number.isFinite(ctx.deadlineAt) || Date.now() >= ctx.deadlineAt) throw new ControlError('deadline-exceeded', 'failed');
  };
  const sleep = (ctx: ControlContext, duration = 30) => new Promise<void>((resolve, reject) => {
    check(ctx);
    const finish = () => { clearTimeout(timer); ctx.signal?.removeEventListener('abort', abort); lifetime.signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new ControlError('aborted', 'cancelled')); };
    const timer = setTimeout(() => { finish(); try { check(ctx); resolve(); } catch (error) { reject(error); } }, Math.min(duration, Math.max(1, ctx.deadlineAt - Date.now())));
    ctx.signal?.addEventListener('abort', abort, { once: true }); lifetime.signal.addEventListener('abort', abort, { once: true });
  });
  const boundary = async <T>(operation: () => Promise<T>): Promise<StepResult<T>> => {
    try { return ok(await operation()); }
    catch (error) { return error instanceof ControlError ? { status: error.status, code: error.code, message: error.message } : { status: 'failed', code: 'control-error', message: 'Control operation failed' }; }
  };
  const field = (handle: FieldHandle, ctx: ControlContext): ControlTarget => {
    check(ctx);
    if (ctx.sectionId !== handle.sectionId || ctx.viewId !== undefined && ctx.viewId !== handle.viewId) throw new ControlError('scope-mismatch');
    const result = page.resolveField(handle);
    if (result.status !== 'ok') throw new ControlError(result.code, result.status);
    return result.value;
  };
  const writable = (element: HTMLElement, ignoreOwnAriaHidden = false) => {
    if (!visibleForClick(element, ignoreOwnAriaHidden) || element.matches(':disabled,[aria-disabled="true"]')) throw new ControlError('not-writable');
  };
  const comboAdapter = (element: HTMLElement) => adapters.map(adapter => adapter.combo?.(element)).find(Boolean);
  const searchInputFor = (element: HTMLElement) => { const adapted = comboAdapter(element); return adapted ? adapted.searchInput() : inputOf(element); };
  const optionText = (node: HTMLElement, control: HTMLElement) => comboAdapter(control)?.optionLabel?.(node) ?? text(node.getAttribute('aria-label') || (node as HTMLInputElement).labels?.[0]?.textContent || node.textContent);
  const optionDisabled = (node: HTMLElement, control: HTMLElement) => node.getAttribute('aria-disabled') === 'true' || node.matches(':disabled') || comboAdapter(control)?.optionDisabled?.(node) === true;
  const readTarget = (target: ControlTarget): Value => {
    const adapted = comboAdapter(target.element);
    if (adapted) return adapted.readValue();
    const value = adapters.map(adapter => adapter.readValue?.(target.element)).find(value => value !== undefined);
    return value !== undefined ? value : readValue(target);
  };
  const prepareFieldFocus = (element: HTMLElement, handle: FieldHandle, ctx: ControlContext) => {
    const resolved = field(handle, ctx);
    if (element !== resolved.element && !resolved.element.contains(element)) throw new ControlError('unproven-action-target');
    resolved.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    writable(element); element.focus({ preventScroll: true });
  };
  const linkedPanel = (element: HTMLElement): HTMLElement | undefined => {
    const adapted = comboAdapter(element);
    if (adapted) return adapted.panel();
    const ids = text(element.getAttribute('aria-controls') || element.getAttribute('aria-owns')).split(' ').filter(Boolean);
    const root = element.getRootNode() as Document | ShadowRoot;
    const panels = ids.map(id => root.getElementById(id)).filter((panel): panel is HTMLElement => panel instanceof element.ownerDocument.defaultView!.HTMLElement && visible(panel));
    if (panels.length !== 1) return undefined;
    return panels[0];
  };
  /** Gate used by every click, including popup choices and calendar navigation. */
  const gateAction = (element: HTMLElement, handle: FieldHandle | ActionHandle | AddedRecordProof, ctx: ControlContext, scope?: HTMLElement, approvedSubmit = false, rollbackPhase?: 'delete' | 'confirm') => {
    check(ctx);
    const rollback = 'probeId' in handle;
    const removal = !rollback && 'actionId' in handle && ctx.overwrite === 'replace' && page.canRemoveRecordAction?.(handle) === true;
    if (rollback && (ctx.sectionId !== handle.sectionId || ctx.viewId !== undefined && ctx.viewId !== handle.viewId)) throw new ControlError('scope-mismatch');
    const resolved = rollback ? page.resolveAddedRecordRollback(handle) : 'fieldId' in handle ? page.resolveField(handle) : page.resolveAction(handle);
    if (resolved.status !== 'ok') throw new ControlError(resolved.code, resolved.status);
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const decorativeClick = 'fieldId' in handle && resolved.value.element.contains(element) && element.getAttribute('aria-hidden') === 'true' && adapters.some(adapter => adapter.combo?.(resolved.value.element) && adapter.allowDecorativeClick?.(resolved.value.element, element) === true);
    writable(element, decorativeClick);
    const label = text(element.getAttribute('aria-label') || element.textContent || (element as HTMLInputElement).value);
    if ((!approvedSubmit || rollback) && element.matches('input,button') && (element as HTMLButtonElement | HTMLInputElement).type === 'submit' || /提交申请|提交简历|立即投递|submit application|apply now|send application/i.test(label) || !rollback && !removal && /删除|delete/i.test(label)) throw new ControlError('forbidden-action');
    if (rollback) {
      if (!('recordElement' in resolved.value) || !(resolved.value.recordElement instanceof element.ownerDocument.defaultView!.HTMLElement) || !scope || !scope.contains(element)) throw new ControlError('unproven-record-rollback');
      if (rollbackPhase) {
        const targetRecord = resolved.value.recordElement;
        const targetOpener = resolved.value.element;
        const adapted = adapters.map(adapter => adapter.addedRecordRollback?.(targetRecord, targetOpener)).find(Boolean);
        const expected = rollbackPhase === 'delete' ? adapted?.deleteTarget() : adapted?.confirmationTarget();
        if (!expected || expected.element !== element || expected.scope !== scope) throw new ControlError('unproven-record-rollback');
      } else if (resolved.value.element !== element || scope !== resolved.value.recordElement) throw new ControlError('unproven-record-rollback');
    }
    if (element.closest('.mtd-month-panel-list.disabled,.mtd-month-panel-list.disabled-month,.mtd-month-panel-list-disabled,.mtd-month-panel-list[disabled],.mtd-month-panel-list[aria-disabled="true"],.mtd-year-panel-list.disabled-year,.mtd-year-panel-list[disabled],.mtd-year-panel-list[aria-disabled="true"]')) throw new ControlError('date-choice-disabled');
    if (element.closest('.mtd-select-disabled,.mtd-select-item-disabled,.mtd-datepicker-disabled,.mtd-date-picker-disabled') || element.getAttribute('disabled') !== null) throw new ControlError('not-writable');
    if (scope && !scope.contains(element)) throw new ControlError('popup-scope-mismatch');
    if (!scope && element !== resolved.value.element && !resolved.value.element.contains(element) && !('elements' in resolved.value && resolved.value.elements.includes(element))) throw new ControlError('unproven-action-target');
  };
  const click = (element: HTMLElement, handle: FieldHandle | ActionHandle | AddedRecordProof, ctx: ControlContext, scope?: HTMLElement, approvedSubmit = false, rollbackPhase?: 'delete' | 'confirm') => { gateAction(element, handle, ctx, scope, approvedSubmit, rollbackPhase); element.click(); };
  const pointerClick = (element: HTMLElement, handle: FieldHandle, ctx: ControlContext, scope: HTMLElement) => {
    gateAction(element, handle, ctx, scope);
    const win = element.ownerDocument.defaultView!;
    // Used only after the central gate, for proven dismissal or adapter-declared option activation.
    element.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
    element.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
    element.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, buttons: 0 }));
    element.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
    element.click();
  };
  const escape = (element: HTMLElement, handle: FieldHandle, ctx: ControlContext, scope: HTMLElement) => { gateAction(element, handle, ctx, scope); const win = element.ownerDocument.defaultView!; element.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); };
  const setComboQuery = (input: HTMLInputElement | HTMLTextAreaElement, value: string, control: HTMLElement, handle: FieldHandle, ctx: ControlContext) => {
    const adapted = comboAdapter(control);
    adapted?.beforeQuery?.();
    setInput(input, value);
    if (adapted?.queryKeydown) {
      gateAction(input, handle, ctx);
      const win = input.ownerDocument.defaultView!;
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true }));
    }
  };
  const loading = (panel: HTMLElement, control: HTMLElement) => panel.getAttribute('aria-busy') === 'true' || control.getAttribute('aria-busy') === 'true' || Array.from(panel.querySelectorAll<HTMLElement>('[role="progressbar"],[aria-busy="true"]')).some(visible);
  const optionNodes = (panel: HTMLElement, control: HTMLElement) => comboAdapter(control)?.options(panel).filter(visible) ?? Array.from(panel.querySelectorAll<HTMLElement>('[role="option"]')).filter(visible);
  const awaitOptions = async (handle: FieldHandle, ctx: ControlContext, control: HTMLElement) => {
    let lastSignature = ''; let stableSince = Date.now();
    while (true) {
      field(handle, ctx);
      const panel = linkedPanel(control);
      if (panel) {
        const nodes = optionNodes(panel, control);
        const customInput = comboAdapter(control)?.customInput?.();
        const signature = JSON.stringify([nodes.map(node => [node.id, optionText(node, control), node.getAttribute('aria-disabled')]), Boolean(customInput)]);
        if (signature !== lastSignature) { lastSignature = signature; stableSince = Date.now(); }
        if (!loading(panel, control) && !comboAdapter(control)?.loading?.(panel) && (nodes.length || customInput || comboAdapter(control)?.empty?.(panel)) && Date.now() - stableSince >= 100) return { panel, nodes };
      }
      await sleep(ctx);
    }
  };
  const openCombo = async (handle: FieldHandle, ctx: ControlContext, control: HTMLElement, wait = true) => {
    const adapted = comboAdapter(control);
    if (adapted) { if (adapted.unsupportedReason) throw new ControlError(adapted.unsupportedReason, 'unsupported'); if (!adapted.panel()) { adapted.beforeOpen(); prepareFieldFocus(adapted.focusTarget?.() ?? adapted.openTarget(), handle, ctx); if (!adapted.panel()) click(adapted.openTarget(), handle, ctx); } return wait ? await awaitOptions(handle, ctx, control) : undefined; }
    if (!control.hasAttribute('aria-expanded') || !text(control.getAttribute('aria-controls') || control.getAttribute('aria-owns'))) throw new ControlError('unproven-popup-ownership');
    if (control.getAttribute('aria-expanded') !== 'true' || !linkedPanel(control)) click(control, handle, ctx);
    return wait ? await awaitOptions(handle, ctx, control) : undefined;
  };
  const closeCombo = async (handle: FieldHandle, ctx: ControlContext, control: HTMLElement) => {
    const adapted = comboAdapter(control);
    if (!(adapted?.isOpen?.() ?? Boolean(linkedPanel(control)))) return;
    if (adapted) {
      if (adapted.blurToClose !== undefined) {
        if (!adapted.blurToClose) throw new ControlError('combo-close-would-clear-selection');
        const target = adapted.focusTarget?.() ?? control;
        if (target !== field(handle, ctx).element) throw new ControlError('unproven-combo-blur-target');
        gateAction(target, handle, ctx);
        target.blur();
        while (adapted.isOpen?.() ?? Boolean(linkedPanel(control))) await sleep(ctx);
        return;
      }
      const dismiss = adapted.dismiss?.();
      if (dismiss) {
        const resolved = field(handle, ctx).element;
        // Only a static direct sibling label near this exact control can dismiss a popup.
        const componentApproved = adapters.some(adapter => adapter.approveDismissal?.(resolved, dismiss) === true);
        const local = [resolved.parentElement, resolved.parentElement?.parentElement].includes(dismiss.scope) || componentApproved;
        if (!dismiss.scope.contains(resolved) || !local || dismiss.scope.matches('body,html') || dismiss.element.parentElement !== dismiss.scope || !isStaticDismissal(dismiss.element, componentApproved)) throw new ControlError('unproven-combo-dismissal');
        pointerClick(dismiss.element, handle, ctx, dismiss.scope);
      } else click(adapted.closeTarget(), handle, ctx);
      while (adapted.isOpen?.() ?? Boolean(linkedPanel(control))) await sleep(ctx);
      return;
    }
    const win = control.ownerDocument.defaultView!;
    control.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(ctx);
    if (linkedPanel(control)) {
      if (control.getAttribute('aria-expanded') !== 'true') throw new ControlError('popup-close-unconfirmed');
      click(control, handle, ctx);
      await sleep(ctx);
      if (linkedPanel(control)) throw new ControlError('popup-close-unconfirmed');
    }
  };
  const parentState = (element: HTMLElement) => {
    // Scope to controls explicitly declared as dependencies, never unrelated form values.
    const root = element.getRootNode() as Document | ShadowRoot;
    return JSON.stringify(text(element.getAttribute('data-depends-on')).split(' ').filter(Boolean).map(id => { const parent = root.getElementById(id); return [id, parent && 'value' in parent ? (parent as HTMLInputElement).value : parent?.getAttribute('aria-valuetext')]; }));
  };
  const evidence = (handle: FieldHandle, options: OptionSnapshot[], nodes: Map<string, HTMLElement>, control: HTMLElement, query?: string): OptionEvidence => {
    const probeId = `probe-${++sequence}`;
    const customInput = comboAdapter(control)?.customInput?.() ? 'exact-text' as const : undefined;
    probes.set(handle.fieldId, { probeId, nodes, labels: new Map(options.map(option => [option.optionId, option.label])), parentState: parentState(control), ...(query !== undefined ? { query } : {}), ...(customInput ? { customInput } : {}) });
    return { documentId: handle.documentId, pageRevision: handle.pageRevision, probeId, sectionId: handle.sectionId, viewId: handle.viewId, templateFieldId: handle.fieldId, options, status: 'ready', ...(customInput ? { customInput } : {}) };
  };
  const nativeOptions = (handle: FieldHandle, select: HTMLSelectElement) => Array.from(select.options).map((option, index) => ({ optionId: `${handle.fieldId}-option-${index}`, label: text(option.label), disabled: option.disabled || (option.parentElement?.tagName === 'OPTGROUP' && (option.parentElement as HTMLOptGroupElement).disabled) }));
  const stableRead = async (handle: FieldHandle, ctx: ControlContext) => {
    let previous: Value = readTarget(field(handle, ctx)); let since = Date.now();
    while (true) {
      await sleep(ctx);
      const target = field(handle, ctx);
      const value = readTarget(target);
      if (norm(value) !== norm(previous)) { previous = value; since = Date.now(); }
      if (Date.now() - since >= 120 && !loading(target.element, target.element)) return value;
    }
  };
  const dateAdapter = (element: HTMLElement) => adapters.map(adapter => adapter.datePanel?.(element)).find(Boolean);
  const calendarClick = (node: HTMLElement, descriptor: DatePanel, handle: FieldHandle, ctx: ControlContext) => descriptor.activation === 'pointer' ? pointerClick(node, handle, ctx, descriptor.panel) : click(node, handle, ctx, descriptor.panel);
  const selectYear = async (descriptor: DatePanel, year: number, refresh: () => DatePanel | undefined, handle: FieldHandle, ctx: ControlContext) => {
    const picker = descriptor.yearPicker?.();
    if (!picker) return descriptor;
    const wait = async <T>(read: () => T | undefined, code: string): Promise<T> => {
      const until = Math.min(ctx.deadlineAt, Date.now() + 1500);
      while (true) { field(handle, ctx); const result = read(); if (result !== undefined) return result; if (Date.now() >= until) throw new ControlError(code); await sleep(ctx); }
    };
    if (!picker.readRange()) { const opener = picker.openTarget(); if (!opener) throw new ControlError('date-year-picker-unavailable'); calendarClick(opener, descriptor, handle, ctx); }
    let range = await wait(() => picker.readRange(), 'date-year-picker-unconfirmed');
    while (year < range.first || year > range.last) {
      const button = year < range.first ? picker.previous() : picker.next();
      if (!button) throw new ControlError('date-navigation-unavailable');
      calendarClick(button, descriptor, handle, ctx);
      const before = range;
      range = await wait(() => { const next = picker.readRange(); return next && (next.first !== before.first || next.last !== before.last) ? next : undefined; }, 'date-navigation-unconfirmed');
      if (year < before.first && range.first >= before.first || year > before.last && range.last <= before.last) throw new ControlError('date-navigation-unconfirmed');
    }
    let last: HTMLElement | undefined, since = Date.now();
    const choice = await wait(() => {
      if (picker.choiceDisabled(year)) throw new ControlError('date-choice-disabled');
      const next = picker.choice(year);
      if (!next || !visible(next) || loading(descriptor.panel, field(handle, ctx).element)) { last = undefined; since = Date.now(); return; }
      if (last !== next) { last = next; since = Date.now(); }
      return Date.now() - since >= 90 ? next : undefined;
    }, 'date-year-choice-unavailable');
    calendarClick(choice, descriptor, handle, ctx);
    return wait(() => { const next = refresh(); return next?.readMonth().year === year ? next : undefined; }, 'date-year-selection-unconfirmed');
  };
  const chooseDate = async (handle: FieldHandle, ctx: ControlContext, target: ControlTarget, value: string) => {
    const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value);
    const precision = match?.[3] ? 'day' : match?.[2] ? 'month' : 'year';
    const year = Number(match?.[1]), month = Number(match?.[2] ?? 1);
    if (!match || month < 1 || month > 12 || match[3] && (Number(match[3]) < 1 || Number(match[3]) > new Date(year, month, 0).getDate())) throw new ControlError('invalid-date');
    const currentPanel = () => {
      const element = field(handle, ctx).element;
      const found = dateAdapter(element);
      return found && visible(found.panel) && (linkedPanel(element) === found.panel || adapters.some(adapter => adapter.ownsDatePanel?.(element, found.panel))) ? found : undefined;
    };
    const waitUntil = async <T>(read: () => T | undefined, code: string, maxMs: number): Promise<T> => {
      const until = Math.min(ctx.deadlineAt, Date.now() + maxMs);
      while (true) {
        field(handle, ctx);
        const result = read();
        if (result !== undefined) return result;
        if (Date.now() >= until) throw new ControlError(code);
        await sleep(ctx);
      }
    };
    let descriptor: DatePanel | undefined;
    try {
    adapters.forEach(adapter => adapter.beforeDateOpen?.(target.element));
    const trigger = adapters.map(adapter => adapter.dateOpenTarget?.(target.element)).find(Boolean) ?? target.element;
    prepareFieldFocus(trigger, handle, ctx);
    if (!currentPanel()) {
      const activation = adapters.map(adapter => adapter.dateOpenActivation?.(target.element)).find(Boolean);
      if (activation === 'pointer') pointerClick(trigger, handle, ctx, target.element);
      else click(trigger, handle, ctx);
    }
    descriptor = await waitUntil(currentPanel, 'date-open-unconfirmed', 1500);
    if (precision !== descriptor.precision) throw new ControlError('date-precision-mismatch');
    let current = descriptor.readMonth();
    if (current.year !== year && descriptor.yearPicker) { descriptor = await selectYear(descriptor, year, currentPanel, handle, ctx); current = descriptor.readMonth(); }
    let yearSteps = 0;
    while (current.year !== year && descriptor.yearStep) {
      if (!Number.isInteger(current.year) || current.year < 1 || ++yearSteps > 120) throw new ControlError('date-year-navigation-unavailable');
      const direction = year < current.year ? 'previous' : 'next';
      const button = descriptor.yearStep(direction);
      if (!button) throw new ControlError('date-year-navigation-unavailable');
      calendarClick(button, descriptor, handle, ctx);
      const oldYear = current.year;
      descriptor = await waitUntil(() => { const next = currentPanel(); if (!next) return; const shown = next.readMonth(); return Number.isInteger(shown.year) && shown.year === oldYear + (direction === 'previous' ? -1 : 1) ? next : undefined; }, 'date-year-navigation-unconfirmed', 1500);
      current = descriptor.readMonth();
    }
    while (current.year !== year || descriptor.navigationUnit !== 'year' && current.month !== month) {
      const delta = descriptor.navigationUnit === 'year' ? year - current.year : (year - current.year) * 12 + month - current.month;
      const button = delta < 0 ? descriptor.previous() : descriptor.next();
      if (!button) throw new ControlError('date-navigation-unavailable');
      calendarClick(button, descriptor, handle, ctx);
      const old = `${current.year}-${current.month}`;
      descriptor = await waitUntil(() => {
        const refreshed = currentPanel();
        if (!refreshed) return;
        const next = refreshed.readMonth();
        return Number.isInteger(next.year) && next.year > 0 && Number.isInteger(next.month) && next.month >= 1 && next.month <= 12 && `${next.year}-${next.month}` !== old ? refreshed : undefined;
      }, 'date-navigation-unconfirmed', 1500);
      current = descriptor.readMonth();
    }
    const choiceOpener = descriptor.choiceOpenTarget?.();
    if (choiceOpener) calendarClick(choiceOpener, descriptor, handle, ctx);
    // Header text can change before the corresponding month nodes finish redrawing.
    let lastChoice: HTMLElement | undefined, stableSince = Date.now();
    const ready = await waitUntil(() => {
      const refreshed = currentPanel(); if (!refreshed) return;
      const shown = refreshed.readMonth();
      if (shown.year !== year || refreshed.navigationUnit !== 'year' && shown.month !== month) return;
      if (refreshed.choiceDisabled?.(value)) throw new ControlError('date-choice-disabled');
      const choice = refreshed.choice(value);
      if (!choice || !visible(choice) || loading(refreshed.panel, target.element)) { lastChoice = undefined; stableSince = Date.now(); return; }
      if (lastChoice !== choice) { lastChoice = choice; stableSince = Date.now(); }
      return Date.now() - stableSince >= 90 ? { descriptor: refreshed, choice } : undefined;
    }, 'date-choice-unavailable', 1500);
    descriptor = ready.descriptor;
    calendarClick(ready.choice, descriptor, handle, ctx);
    // Click once, then observe both the component's committed value and owned popup closure.
    let stableValueSince: number | null = null, closeAttempted = false;
    await waitUntil(() => {
      const actual = readTarget(field(handle, ctx));
      const selected = norm(actual) === norm(value);
      const opened = descriptor!.isOpen?.() ?? visible(descriptor!.panel);
      if (selected && !opened) {
        stableValueSince ??= Date.now();
        if (Date.now() - stableValueSince >= 90) return true;
      } else stableValueSince = null;
      if (selected && opened && !closeAttempted) {
        const close = descriptor!.close();
        if (close) { closeAttempted = true; calendarClick(close, descriptor!, handle, ctx); }
      }
      return undefined;
    }, 'date-selection-unconfirmed', 2000);
    } catch (error) {
      if (descriptor && !ctx.signal?.aborted && !disposed && (descriptor.isOpen?.() ?? visible(descriptor.panel))) {
        const cleanupCtx = { ...ctx, deadlineAt: Math.min(ctx.cleanupDeadlineAt ?? ctx.deadlineAt, Date.now() + 500) };
        if (Date.now() >= cleanupCtx.deadlineAt) throw new ControlError('date-close-unconfirmed');
        const close = descriptor.close();
        if (close) calendarClick(close, descriptor, handle, cleanupCtx);
        else {
          const dismiss = descriptor.dismiss?.();
          if (!dismiss) throw new ControlError('date-close-unconfirmed');
          const resolved = field(handle, cleanupCtx).element;
          const mtd = dismiss.scope.matches('.mtd-form-item-body') && dismiss.element.matches('div.label');
          const tencent = resolved.ownerDocument.location.origin === 'https://careers.tencent.com' && resolved.ownerDocument.location.pathname === '/resume.html' && dismiss.scope.matches('.resume-module-left,.resume-module-right') && dismiss.element.matches('p.text') && resolved.closest('.resume-module-left,.resume-module-right') === dismiss.scope;
          const adapted = adapters.some(adapter => adapter.approveDismissal?.(resolved, dismiss) === true);
          if (!(mtd || tencent || adapted) || dismiss.scope.matches('body,html') || !dismiss.scope.contains(resolved) || dismiss.element.parentElement !== dismiss.scope || !dismiss.element.matches('p,div,span') || dismiss.element.matches('[role],[tabindex],[contenteditable],[onclick]') || dismiss.element.querySelector('input,textarea,select,button,a,label,[role],[tabindex],[contenteditable],[onclick]')) throw new ControlError('unproven-date-dismissal');
          pointerClick(dismiss.element, handle, cleanupCtx, dismiss.scope);
        }
        while (descriptor.isOpen?.() ?? visible(descriptor.panel)) {
          if (Date.now() >= cleanupCtx.deadlineAt) throw new ControlError('date-close-unconfirmed');
          try { await sleep(cleanupCtx); } catch (cleanupError) { if (cleanupError instanceof ControlError && cleanupError.code === 'deadline-exceeded') throw new ControlError('date-close-unconfirmed'); throw cleanupError; }
        }
      }
      throw error;
    }
  };
  return {
    inspectControl(handle, ctx) { return boundary(async () => {
      const target = field(handle, ctx);
      const clock = inspectionClock(ctx);
      if (target.kind === 'radio') {
        clock.start('options');
        try {
        const nodes = new Map<string, HTMLElement>();
        const options = target.elements.map((node, index) => { const optionId = `${handle.fieldId}-radio-${index}`; nodes.set(optionId, node); return { optionId, label: radioLabel(node), disabled: node.matches(':disabled,[aria-disabled="true"]') }; });
        const result = { supported: true, kind: target.kind, optionEvidence: evidence(handle, options, nodes, target.element) };
        clock.finish('ok'); return result;
        } catch (error) { clock.finish('failed'); throw error; }
      }
      if (target.kind === 'select') {
        clock.start('options');
        try { const result = { supported: true, kind: target.kind, optionEvidence: evidence(handle, nativeOptions(handle, target.element as HTMLSelectElement), new Map(), target.element) }; clock.finish('ok'); return result; }
        catch (error) { clock.finish('failed'); throw error; }
      }
      if (target.kind === 'combobox') {
        const before = readTarget(target); let opened = false;
        let queryInput = searchInputFor(target.element);
        const originalQuery = queryInput?.value;
        let queryChanged = false;
        try {
          clock.start('open');
          await openCombo(handle, ctx, target.element, false); opened = true;
          clock.start('query');
          queryInput = searchInputFor(field(handle, ctx).element);
          if (ctx.query !== undefined && queryInput && !queryInput.readOnly && queryInput.value !== ctx.query) { queryChanged = true; setComboQuery(queryInput, ctx.query, target.element, handle, ctx); }
          clock.start('options');
          const { nodes } = await awaitOptions(handle, ctx, target.element);
          const nodeMap = new Map<string, HTMLElement>();
          const options = nodes.map((node, index) => { const optionId = `${handle.fieldId}-probe-${sequence + 1}-option-${index}`; nodeMap.set(optionId, node); return { optionId, label: optionText(node, target.element), disabled: optionDisabled(node, target.element) }; });
          const result = { supported: true, kind: target.kind, optionEvidence: evidence(handle, options, nodeMap, target.element, ctx.query) };
          clock.finish('ok'); return result;
        } catch (error) { clock.finish('failed'); throw error; } finally {
          const cleanupCtx = ctx.cleanupDeadlineAt && !ctx.signal?.aborted ? { ...ctx, deadlineAt: Math.min(ctx.cleanupDeadlineAt, Date.now() + 500) } : ctx;
          if (!ctx.signal?.aborted && !disposed && Date.now() < cleanupCtx.deadlineAt) {
            clock.start('cleanup');
            try {
            field(handle, cleanupCtx);
            queryInput = searchInputFor(field(handle, cleanupCtx).element);
            const restoreAfterClose = comboAdapter(target.element)?.restoreQueryAfterClose;
            if (!restoreAfterClose && queryChanged && queryInput?.isConnected && originalQuery !== undefined) { setInput(queryInput, originalQuery); }
            if (opened || linkedPanel(target.element)) await closeCombo(handle, cleanupCtx, target.element);
            if (restoreAfterClose && queryChanged && queryInput?.isConnected && originalQuery !== undefined) setInput(queryInput, originalQuery, !comboAdapter(target.element)?.restoreQuerySilently);
            if (norm(readTarget(field(handle, cleanupCtx))) !== norm(before)) throw new ControlError('probe-changed-value');
            clock.finish('ok');
            } catch (error) { clock.finish('failed'); throw error; }
          }
        }
      }
      return { supported: target.kind !== 'unknown', kind: target.kind };
    }); },
    readControl(handle, ctx) { return boundary(async () => ({ value: readTarget(field(handle, ctx)) })); },
    verifyControl(handle, assignment, ctx) { return boundary(async () => {
      const inspected = field(handle, ctx);
      if (inspected.kind === 'combobox' && Array.isArray(assignment.value) && !comboAdapter(inspected.element)?.multiple) throw new ControlError('multiple-not-supported', 'unsupported');
      const probe = probes.get(handle.fieldId);
      const expected = typeof assignment.value === 'string' ? probe?.labels.get(assignment.value) ?? assignment.value : Array.isArray(assignment.value) ? assignment.value.map(value => probe?.labels.get(value) ?? value) : assignment.value;
      const target = field(handle, ctx);
      const native = target.kind === 'select' ? nativeOptions(handle, target.element as HTMLSelectElement) : target.kind === 'radio' ? target.elements.map((node, index) => ({ optionId: `${handle.fieldId}-radio-${index}`, label: radioLabel(node) })) : [];
      const expectedNative = typeof expected === 'string' ? native.find(option => option.optionId === expected)?.label ?? expected : Array.isArray(expected) ? expected.map(value => native.find(option => option.optionId === value)?.label ?? value) : expected;
      const current = readTarget(target);
      // A mismatch already proves that a write is needed. Waiting cannot make
      // an unrelated old value better evidence for an idempotency check.
      if (ctx.verification === 'existing' && norm(current) !== norm(expectedNative)) return { matches: false, actual: current };
      const settled = settledWrites.get(target.element);
      // writeControl already waited for stability. Reuse that observation only
      // for this exact binding and unchanged value, immediately after the write.
      // The independent final pass still uses the normal stable read.
      const reuse = ctx.verification === 'after-write' && settled && settled.documentId === handle.documentId && settled.pageRevision === handle.pageRevision && settled.fieldId === handle.fieldId && Date.now() - settled.at < 500 && norm(current) === norm(settled.value);
      const actual = reuse ? current : await stableRead(handle, ctx);
      const adapted = comboAdapter(target.element);
      return { matches: norm(actual) === norm(expectedNative) && !(adapted?.multiple && (adapted.isOpen?.() ?? Boolean(linkedPanel(target.element)))), actual };
    }); },
    writeDateRange(startHandle, startAssignment, endHandle, endAssignment, ctx) { return boundary(async () => {
      const start = field(startHandle, ctx), end = field(endHandle, ctx);
      const range = adapters.map(adapter => adapter.dateRange?.(start.element, end.element)).find(Boolean);
      if (!range || start.kind !== 'date' || end.kind !== 'date' || startHandle.sectionId !== endHandle.sectionId || startHandle.viewId !== endHandle.viewId || !range.root.contains(start.element) || !range.root.contains(end.element) || start.element === end.element) throw new ControlError('date-range-unsupported', 'unsupported');
      const assignments = [startAssignment, endAssignment], handles = [startHandle, endHandle] as const;
      const values = assignments.map(assignment => {
        if (assignment.status !== 'ready' || typeof assignment.value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(assignment.value)) throw new ControlError('date-range-assignment-required', 'unsupported');
        return assignment.value;
      });
      if (values[0]! > values[1]!) throw new ControlError('date-range-order-invalid');
      const before = [readTarget(start), readTarget(end)];
      if (before.every((value, index) => norm(value) === norm(values[index]!))) return { start: { attempted: false, value: before[0]! }, end: { attempted: false, value: before[1]! } };
      if (ctx.overwrite !== 'replace' && before.some((value, index) => value !== '' && norm(value) !== norm(values[index]!))) throw new ControlError('preserve-existing-value');
      ctx = { ...ctx, cleanupDeadlineAt: ctx.cleanupDeadlineAt ?? ctx.deadlineAt, deadlineAt: Math.min(ctx.deadlineAt, Date.now() + 16000) };
      const wait = async <T>(read: () => T | undefined, code: string, maxMs = 1500): Promise<T> => {
        const until = Math.min(ctx.deadlineAt, Date.now() + maxMs);
        while (true) { field(startHandle, ctx); field(endHandle, ctx); const result = read(); if (result !== undefined) return result; if (Date.now() >= until) throw new ControlError(code); await sleep(ctx); }
      };
      let opened = false;
      try {
        range.beforeOpen();
        prepareFieldFocus(range.openTarget(), startHandle, ctx);
        if (!range.panel()) click(range.openTarget(), startHandle, ctx);
        opened = true;
        await wait(() => range.panel(), 'date-open-unconfirmed');
        for (const index of [0, 1] as const) {
          const partCtx = { ...ctx, deadlineAt: Math.min(ctx.deadlineAt, Date.now() + 8000) };
          const handle = handles[index], value = values[index]!;
          let descriptor = await wait(() => range.part(index), 'date-panel-unconfirmed');
          if (descriptor.precision !== 'month') throw new ControlError('date-precision-mismatch');
          const year = Number(value.slice(0, 4));
          if (descriptor.readMonth().year !== year) descriptor = await selectYear(descriptor, year, () => range.part(index), handle, partCtx);
          if (descriptor.readMonth().year !== year) throw new ControlError('date-year-selection-unconfirmed');
          let last: HTMLElement | undefined, since = Date.now();
          const choice = await wait(() => {
            const current = range.part(index); if (!current || current.readMonth().year !== year) return;
            if (current.choiceDisabled?.(value)) throw new ControlError('date-choice-disabled');
            const next = current.choice(value);
            if (!next || !visible(next) || loading(current.panel, field(handle, ctx).element)) { last = undefined; since = Date.now(); return; }
            if (last !== next) { last = next; since = Date.now(); }
            return Date.now() - since >= 90 ? next : undefined;
          }, 'date-choice-unavailable');
          click(choice, handle, partCtx, descriptor.panel);
          await wait(() => norm(readTarget(field(handle, ctx))) === norm(value) ? true : undefined, 'date-selection-unconfirmed');
        }
        const panel = range.panel(), confirm = range.confirm();
        if (!panel || !confirm || confirm.matches(':disabled,[disabled],[aria-disabled="true"],.next-btn-disabled')) throw new ControlError('date-range-confirm-disabled');
        click(confirm, startHandle, ctx, panel);
        let since: number | null = null;
        await wait(() => {
          if (range.panel() || handles.some((handle, index) => norm(readTarget(field(handle, ctx))) !== norm(values[index]!))) { since = null; return; }
          since ??= Date.now(); return Date.now() - since >= 120 ? true : undefined;
        }, 'date-selection-unconfirmed', 2000);
        return { start: { attempted: true, value: readTarget(field(startHandle, ctx)) }, end: { attempted: true, value: readTarget(field(endHandle, ctx)) } };
      } catch (error) {
        if (opened && range.panel() && !ctx.signal?.aborted && !disposed) {
          const cleanupCtx = { ...ctx, deadlineAt: Math.min(ctx.cleanupDeadlineAt ?? ctx.deadlineAt, Date.now() + 500) };
          const panel = range.panel(), target = range.escapeTarget();
          if (!panel || !target || Date.now() >= cleanupCtx.deadlineAt) throw new ControlError('date-close-unconfirmed');
          escape(target, startHandle, cleanupCtx, panel);
          while (range.panel()) { if (Date.now() >= cleanupCtx.deadlineAt) throw new ControlError('date-close-unconfirmed'); await sleep(cleanupCtx); }
        }
        throw error;
      }
    }); },
    writeControl(handle, assignment, ctx) { return boundary(async () => {
      if (assignment.status !== 'ready' || assignment.value === null) throw new ControlError('assignment-not-ready');
      const target = field(handle, ctx);
      const writeBudget = target.kind === 'combobox' ? 3000 : target.kind === 'date' ? 8000 : undefined;
      if (writeBudget !== undefined) ctx = { ...ctx, cleanupDeadlineAt: ctx.cleanupDeadlineAt ?? ctx.deadlineAt, deadlineAt: Math.min(ctx.deadlineAt, Date.now() + writeBudget) };
      if (target.kind !== 'radio') writable(target.element);
      const before = readTarget(target);
      const replacement = ctx.replaceIfValue;
      let userChanged = false;
      const changed = (event: Event) => { if (event.isTrusted) userChanged = true; };
      const guardEvents = ['input', 'change', 'pointerdown', 'keydown'];
      const checkReplacement = () => {
        if (!replacement) return;
        const current = field(handle, ctx);
        if (target.kind !== 'combobox' || current.element !== target.element || userChanged || norm(readTarget(current)) !== norm(replacement.value)) throw new ControlError('dependent-default-changed');
      };
      if (replacement) { checkReplacement(); guardEvents.forEach(event => target.element.addEventListener(event, changed, true)); }
      try {
      const candidateLabel = (value: string) => {
        if (target.kind === 'select') return nativeOptions(handle, target.element as HTMLSelectElement).find(option => option.optionId === value)?.label ?? value;
        if (target.kind === 'radio') { const index = target.elements.findIndex((_, index) => `${handle.fieldId}-radio-${index}` === value); const node = target.elements[index]; return node ? radioLabel(node) : value; }
        return probes.get(handle.fieldId)?.labels.get(value) ?? value;
      };
      const expected = typeof assignment.value === 'string' ? candidateLabel(assignment.value) : Array.isArray(assignment.value) ? assignment.value.map(candidateLabel) : assignment.value;
      const multiple = target.kind === 'combobox' ? comboAdapter(target.element)?.multiple : undefined;
      if (multiple && !Array.isArray(assignment.value)) throw new ControlError('multiple-options-required');
      if (target.kind === 'combobox' && Array.isArray(assignment.value)) {
        if (!multiple) throw new ControlError('multiple-not-supported', 'unsupported');
        const probe = probes.get(handle.fieldId);
        if (!assignment.value.length || !probe || assignment.value.some(value => !probe.labels.has(value))) throw new ControlError('multi-select-option-evidence-required');
        if (probe.parentState !== parentState(target.element)) { probes.delete(handle.fieldId); throw new ControlError('option-evidence-stale'); }
        if (!Array.isArray(before) || !Array.isArray(expected) || new Set(expected).size !== expected.length || new Set(before).size !== before.length) throw new ControlError('multi-select-values-unproven');
        if (before.some(label => !expected.includes(label))) throw new ControlError('multi-select-preserve-existing-option');
      }
      if (target.kind === 'combobox' && norm(before) === norm(expected)) return { attempted: false, value: before };
      if (!(multiple && Array.isArray(assignment.value)) && ctx.overwrite !== 'replace' && !replacement && before !== '' && before !== false && !(Array.isArray(before) && before.length === 0) && norm(before) !== norm(expected)) throw new ControlError('preserve-existing-value');
      const value = assignment.value;
      if (target.kind === 'radio') {
        if (typeof value !== 'string') throw new ControlError('radio-option-required');
        const matches = target.elements.filter((node, index) => `${handle.fieldId}-radio-${index}` === value || radioLabel(node) === value);
        if (matches.length !== 1) throw new ControlError('ambiguous-option');
        click(matches[0]!, handle, ctx);
      } else if (target.kind === 'checkbox') {
        if (typeof value !== 'boolean') throw new ControlError('boolean-required');
        if (before !== value) click(target.element, handle, ctx);
      } else if (target.kind === 'select') {
        const select = target.element as HTMLSelectElement;
        const options = nativeOptions(handle, select); const wanted = Array.isArray(value) ? value : [String(value)];
        if (!select.multiple && wanted.length !== 1) throw new ControlError('multiple-not-supported');
        const indices = wanted.map(item => { const candidates = options.map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled && (option.optionId === item || option.label === item)); if (candidates.length !== 1) throw new ControlError('ambiguous-option'); return candidates[0]!.index; });
        Array.from(select.options).forEach((option, index) => { option.selected = indices.includes(index); });
        const win = select.ownerDocument.defaultView!; select.dispatchEvent(new win.Event('input', { bubbles: true })); select.dispatchEvent(new win.Event('change', { bubbles: true }));
      } else if (target.kind === 'combobox') {
        const previousProbe = probes.get(handle.fieldId);
        if (previousProbe && previousProbe.parentState !== parentState(target.element)) { probes.delete(handle.fieldId); throw new ControlError('option-evidence-stale'); }
        if (Array.isArray(value)) {
          const labels = expected as string[], original = before as string[];
          let completed = false;
          const selectedValues = () => {
            const actual = readTarget(field(handle, ctx));
            if (!Array.isArray(actual) || new Set(actual).size !== actual.length || original.some(label => !actual.includes(label))) throw new ControlError('multi-select-existing-value-lost');
            if (actual.some(label => !labels.includes(label))) throw new ControlError('multi-select-preserve-existing-option');
            return actual;
          };
          try {
            await openCombo(handle, ctx, target.element, false);
            for (const label of labels) {
              const { panel, nodes } = await awaitOptions(handle, ctx, target.element);
              const matches = nodes.filter(node => optionText(node, target.element) === label && !optionDisabled(node, target.element));
              if (matches.length !== 1) throw new ControlError('ambiguous-option');
              const chosen = matches[0]!;
              if (selectedValues().includes(label)) {
                if (!multiple!.choiceSelected(chosen)) throw new ControlError('multi-select-selection-inconsistent');
                continue;
              }
              if (multiple!.choiceSelected(chosen)) throw new ControlError('multi-select-selection-inconsistent');
              const blocked = comboAdapter(target.element)?.writeBlockedReason?.(label, ctx);
              if (blocked) throw new ControlError(blocked);
              const choice = multiple!.choiceTarget(chosen);
              if (!choice) throw new ControlError('unproven-multi-select-target');
              click(choice, handle, ctx, panel);
              while (true) {
                const actual = selectedValues(), currentPanel = linkedPanel(target.element);
                const current = currentPanel ? optionNodes(currentPanel, target.element).filter(node => optionText(node, target.element) === label) : [];
                if (actual.includes(label) && current.length === 1 && multiple!.choiceSelected(current[0]!)) break;
                await sleep(ctx);
              }
            }
            await closeCombo(handle, ctx, target.element);
            if (norm(await stableRead(handle, ctx)) !== norm(labels)) throw new ControlError('multi-select-selection-unconfirmed');
            completed = true;
          } finally {
            if (!completed && !ctx.signal?.aborted && !disposed) {
              const cleanupCtx = { ...ctx, deadlineAt: Math.min(ctx.cleanupDeadlineAt ?? ctx.deadlineAt, Date.now() + 500) };
              if (Date.now() < cleanupCtx.deadlineAt && (comboAdapter(target.element)?.isOpen?.() ?? Boolean(linkedPanel(target.element)))) await closeCombo(handle, cleanupCtx, target.element);
            }
          }
        } else {
          if (typeof value !== 'string') throw new ControlError('single-option-required');
          const requestedLabel = previousProbe?.labels.get(value) ?? value;
          const requestedQuery = previousProbe?.query ?? requestedLabel;
          let input = searchInputFor(target.element);
          const originalQuery = input?.value;
          let selected = false, queryChanged = false, completed = false;
          try {
            await openCombo(handle, ctx, target.element, false);
            input = searchInputFor(field(handle, ctx).element);
            if (input && !input.readOnly && input.value !== requestedQuery) { queryChanged = true; setComboQuery(input, requestedQuery, target.element, handle, ctx); }
            const { panel, nodes } = await awaitOptions(handle, ctx, target.element);
            const matches = nodes.filter(node => optionText(node, target.element) === requestedLabel && !optionDisabled(node, target.element));
            const custom = !nodes.some(node => optionText(node, target.element) === requestedLabel) && assignment.transform === 'identity' && previousProbe?.customInput === 'exact-text' ? comboAdapter(target.element)?.customInput?.() : undefined;
            if (custom) {
              checkReplacement();
              const opener = custom.openTarget();
              if (opener) pointerClick(opener, handle, ctx, panel);
              let editor: { input: HTMLInputElement; commit: HTMLElement; panel: HTMLElement } | undefined;
              while (!editor) {
                const currentPanel = linkedPanel(target.element), current = comboAdapter(target.element)?.customInput?.();
                const input = current?.input(), commit = current?.commitTarget();
                if (currentPanel && input && commit && currentPanel.contains(input) && currentPanel.contains(commit)) editor = { input, commit, panel: currentPanel };
                else await sleep(ctx);
              }
              gateAction(editor.input, handle, ctx, editor.panel);
              setInput(editor.input, requestedLabel);
              checkReplacement();
              const current = comboAdapter(target.element)?.customInput?.(), currentPanel = linkedPanel(target.element);
              const commit = current?.commitTarget(), customInput = current?.input();
              if (!commit || !customInput || !currentPanel || customInput.value !== requestedLabel || !currentPanel.contains(customInput) || !currentPanel.contains(commit)) throw new ControlError('custom-input-changed');
              pointerClick(commit, handle, ctx, currentPanel); selected = true;
              while (norm(readTarget(field(handle, ctx))) !== norm(requestedLabel)) await sleep(ctx);
              await closeCombo(handle, ctx, target.element);
              completed = true;
            } else {
            if (matches.length !== 1) throw new ControlError('ambiguous-option');
            const blocked = comboAdapter(target.element)?.writeBlockedReason?.(requestedLabel, ctx);
            if (blocked) throw new ControlError(blocked);
            const adapted = comboAdapter(target.element);
            checkReplacement();
            adapted?.beforeSelection?.(requestedLabel);
            if (adapted?.optionActivation === 'mousedown') {
              gateAction(matches[0]!, handle, ctx, panel);
              const win = target.element.ownerDocument.defaultView!;
              matches[0]!.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
            } else if (adapted?.optionActivation === 'pointer') pointerClick(matches[0]!, handle, ctx, panel);
            else click(matches[0]!, handle, ctx, panel);
            selected = true;
            if (adapted?.selectionConfirmed) {
              while (!adapted.selectionConfirmed(requestedLabel)) await sleep(ctx);
              if (adapted.dismissAfterSelection) {
                if (norm(await stableRead(handle, ctx)) !== norm(requestedLabel)) throw new ControlError('selection-unconfirmed');
                if (linkedPanel(target.element)) await closeCombo(handle, ctx, target.element);
              }
            } else {
              await sleep(ctx);
              if (linkedPanel(target.element)) await closeCombo(handle, ctx, target.element);
            }
            completed = true;
            }
          } finally {
            if (!completed && !ctx.signal?.aborted && !disposed) {
              const cleanupCtx = { ...ctx, deadlineAt: Math.min(ctx.cleanupDeadlineAt ?? ctx.deadlineAt, Date.now() + 500) };
              if (Date.now() < cleanupCtx.deadlineAt) {
                field(handle, cleanupCtx);
                // A clicked option may already have committed a fact; never roll it back.
                input = searchInputFor(field(handle, cleanupCtx).element);
                const restoreAfterClose = comboAdapter(target.element)?.restoreQueryAfterClose;
                if (!restoreAfterClose && !selected && queryChanged && input?.isConnected && originalQuery !== undefined) setInput(input, originalQuery);
                if (comboAdapter(target.element)?.isOpen?.() ?? Boolean(linkedPanel(target.element))) await closeCombo(handle, cleanupCtx, target.element);
                if (restoreAfterClose && !selected && queryChanged && input?.isConnected && originalQuery !== undefined) setInput(input, originalQuery, !comboAdapter(target.element)?.restoreQuerySilently);
                if (!selected && norm(readTarget(field(handle, cleanupCtx))) !== norm(before)) throw new ControlError('probe-changed-value');
              }
            }
          }
        }
      } else if (target.kind === 'date') {
        if (typeof value !== 'string') throw new ControlError('date-string-required');
        const input = inputOf(target.element);
        if ((input?.type === 'date' || input?.type === 'month') && !input.readOnly) {
          const pattern = input.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/;
          if (!pattern.test(value)) throw new ControlError('date-precision-mismatch');
          setInput(input, value);
        } else await chooseDate(handle, ctx, target, value);
      } else if (target.kind === 'contenteditable') {
        if (typeof value !== 'string') throw new ControlError('text-required');
        target.element.textContent = value; const win = target.element.ownerDocument.defaultView!; target.element.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); target.element.dispatchEvent(new win.Event('change', { bubbles: true }));
      } else if (target.kind === 'text' || target.kind === 'textarea') {
        const input = inputOf(target.element);
        if (!input || Array.isArray(value)) throw new ControlError('unsupported-text-control', 'unsupported');
        if (dateAdapter(target.element)) await chooseDate(handle, ctx, target, String(value)); else setInput(input, String(value));
      } else throw new ControlError('unsupported-control', 'unsupported');
      const actual = await stableRead(handle, ctx);
      settledWrites.set(field(handle, ctx).element, { documentId: handle.documentId, pageRevision: handle.pageRevision, fieldId: handle.fieldId, value: actual, at: Date.now() });
      return { attempted: true, value: actual };
      } finally { if (replacement) guardEvents.forEach(event => target.element.removeEventListener(event, changed, true)); }
    }); },
    rollbackAddedRecord(proof, ctx) { return boundary(async () => {
      check(ctx);
      if (ctx.sectionId !== proof.sectionId || ctx.viewId !== undefined && ctx.viewId !== proof.viewId) throw new ControlError('scope-mismatch');
      const resolved = page.resolveAddedRecordRollback(proof);
      if (resolved.status !== 'ok') throw new ControlError(resolved.code, resolved.status);
      const { element, recordElement } = resolved.value;
      // Registered, freshly checked addition proof is the only deletion capability.
      const adapted = adapters.map(adapter => adapter.addedRecordRollback?.(recordElement, element)).find(Boolean);
      const menuOpener = element.matches('button[aria-haspopup="true"]');
      if (menuOpener && !adapted) throw new ControlError('rollback-menu-unsupported', 'unsupported');
      if (adapted) {
        const waitTarget = async (read: () => { element: HTMLElement; scope: HTMLElement } | undefined, code: string) => {
          const until = Math.min(ctx.deadlineAt, Date.now() + 1500);
          while (true) { check(ctx); const resolved = page.resolveAddedRecordRollback(proof); if (resolved.status !== 'ok') throw new ControlError(resolved.code, resolved.status); const target = read(); if (target) return target; if (Date.now() >= until) throw new ControlError(code); await sleep(ctx); }
        };
        const target = await waitTarget(() => adapted.deleteTarget(), 'rollback-delete-unconfirmed');
        adapted.beforeDelete();
        click(target.element, proof, ctx, target.scope, false, 'delete');
        const confirm = await waitTarget(() => adapted.confirmationTarget(), 'rollback-confirmation-unconfirmed');
        click(confirm.element, proof, ctx, confirm.scope, false, 'confirm');
      } else click(element, proof, ctx, recordElement);
      const baselineSettleUntil = Math.min(ctx.deadlineAt, Date.now() + 1500);
      while (true) {
        check(ctx);
        const verified = page.verifyAddedRecordRollback(proof);
        if (verified.status !== 'ok') {
          // Confirmation may briefly remove original field markers while Vue
          // redraws them. Wait read-only; no further deletion is authorized.
          if (verified.code === 'addition-rollback-baseline-changed' && Date.now() < baselineSettleUntil) { await sleep(ctx); continue; }
          throw new ControlError(verified.code, verified.status);
        }
        if (!recordElement.isConnected && verified.value.removed) return { removed: true };
        await sleep(ctx);
      }
    }); },
    performAction(handle, intent, ctx) { return boundary(async () => {
      check(ctx);
      if (intent.sectionId !== handle.sectionId || ctx.sectionId !== handle.sectionId || intent.viewId !== undefined && intent.viewId !== handle.viewId || ctx.viewId !== undefined && handle.viewId !== undefined && ctx.viewId !== handle.viewId) throw new ControlError('action-scope-mismatch');
      const section = await page.scanSection(handle.sectionId, ctx);
      if (section.status !== 'ok') throw new ControlError(section.code, section.status);
      const descriptor = section.value.actions.find(action => action.actionId === handle.actionId);
      if (!descriptor || descriptor.kind !== intent.kind) throw new ControlError('action-intent-mismatch');
      if (intent.kind === 'remove-record' && (ctx.overwrite !== 'replace' || !page.canRemoveRecordAction(handle))) throw new ControlError('unproven-record-removal');
      const resolved = page.resolveAction(handle); if (resolved.status !== 'ok') throw new ControlError(resolved.code, resolved.status);
      if ((intent.kind === 'save-record' || intent.kind === 'next-section') && !adapters.some(adapter => adapter.approveAction?.(resolved.value.element, intent, handle))) throw new ControlError('unproven-local-action');
      const before = page.getIdentity(); let observed = false;
      const unsubscribe = page.observeSection(handle.sectionId, () => { observed = true; });
      try {
        click(resolved.value.element, handle, ctx, undefined, intent.kind === 'save-record');
        while (!observed) { await sleep(ctx); const after = page.getIdentity(); observed ||= before.documentId !== after.documentId || before.pageRevision !== after.pageRevision; }
        return { actionId: handle.actionId, kind: intent.kind, attempted: true, observed };
      }
      finally { unsubscribe(); }
    }); },
    dispose() { disposed = true; lifetime.abort(); probes.clear(); },
  };
}

export { createMeituanControlAdapter } from "./meituan.js";
