import type { ComboControl, ControlAdapter, DatePanel } from './index.js';
import { isMokaApplicationPage } from '../page/adapters/moka.js';

const prefix = (value: string) => `[class^="${value}"],[class*=" ${value}"]`;
const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const direct = (node: Element, selector: string) => Array.from(node.children).filter((child): child is HTMLElement => child instanceof node.ownerDocument.defaultView!.HTMLElement && child.matches(selector));
const one = (nodes: HTMLElement[]) => nodes.length === 1 ? nodes[0] : undefined;
function visible(node: HTMLElement): boolean {
  if (!node.isConnected || !node.getClientRects().length) return false;
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(parent);
    if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
const disabled = (node: HTMLElement) => Boolean(node.closest(`[disabled],[aria-disabled="true"],${prefix('sd-Input-disabled-')},${prefix('sd-Select-disabled-')},${prefix('sd-Menu-disabled-')}`));
const months = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const calendarDisabled = (node: HTMLElement) => disabled(node) || Boolean(node.closest(prefix('sd-basic-disabled-')));
function dismissal(control: HTMLElement): { element: HTMLElement; scope: HTMLElement } | undefined {
  if (!isMokaApplicationPage(control.ownerDocument.location)) return;
  const scope = control.closest<HTMLElement>(prefix('apply-field-'));
  const title = scope ? one(direct(scope, prefix('title-'))) : undefined;
  const body = scope ? one(direct(scope, prefix('ctrl-'))) : undefined;
  if (!scope || !title || !body?.contains(control) || !visible(title) || title.matches('[role],[tabindex],[contenteditable],[onclick]') || title.querySelector('input,textarea,select,button,a,label,[role],[tabindex],[contenteditable],[onclick]')) return;
  return { element: title, scope };
}

/** Only the two captured Moka application routes; callbacks never perform DOM actions. */
export function createMokaControlAdapter(): ControlAdapter {
  const queries = new WeakMap<HTMLElement, { nodes: HTMLElement[]; labels: string[]; sawLoading: boolean; fresh: boolean; cachedExact: boolean }>();
  const combo = (element: HTMLElement): ComboControl | undefined => {
    if (!isMokaApplicationPage(element.ownerDocument.location) || element.tagName !== 'LABEL' || !element.matches(prefix('sd-Select-container-'))) return;
    const root = element, container = root.parentElement;
    const input = one(direct(root, 'input[type="text"]')) as HTMLInputElement | undefined;
    const display = one(direct(root, prefix('sd-Input-display-value-')));
    const addon = one(direct(root, prefix('sd-Select-addon-')));
    const arrow = addon ? one(direct(addon, prefix('sd-Select-icon-'))) : undefined;
    if (!container?.matches(prefix('sd-Dropdown-container-')) || !input || !display || direct(container, prefix('sd-Select-container-')).length !== 1) return;
    const item = root.closest<HTMLElement>(prefix('apply-field-'));
    const title = item ? one(direct(item, prefix('title-'))) : undefined;
    const fieldLabel = clean(title?.textContent);
    const searchable = ['学校名称', '专业名称'].includes(fieldLabel);
    const groupedCity = root.ownerDocument.location.pathname === '/campus_apply/baai/42174' && fieldLabel === '意向工作城市';
    const panel = () => {
      if (!root.isConnected || root.parentElement !== container) return;
      const slots = direct(container, 'span');
      const panels = slots.flatMap(slot => direct(slot, prefix('sd-Dropdown-dropdown-'))).filter(visible);
      const candidate = one(panels);
      return candidate && direct(candidate, prefix('sd-Select-menu-')).length === 1 ? candidate : undefined;
    };
    const label = (node: HTMLElement) => {
      const content = one(direct(node, prefix('sd-Menu-content-')));
      const items = content ? direct(content, prefix('sd-Menu-content-item-')) : [];
      if (items.length !== 1) return '';
      const captions = Array.from(items[0]!.querySelectorAll<HTMLElement>(`${prefix('option-label-')},span[data-key="sugar.select.label"]`));
      if (captions.length === 1) return clean(captions[0]!.textContent);
      const schoolLabels = searchable ? direct(items[0]!, 'div:not([class])') : [];
      return schoolLabels.length === 1 ? clean(schoolLabels[0]!.textContent) : '';
    };
    const busy = () => Array.from(root.querySelectorAll<HTMLElement>(prefix('sd-LoadingIcon-'))).some(visible);
    const fresh = (candidate: HTMLElement) => {
      const query = queries.get(root);
      if (!query) return true;
      if (busy()) { query.sawLoading = true; query.cachedExact = false; return false; }
      const current = options(candidate);
      if (query.sawLoading || current.length && (current.length !== query.nodes.length || current.some((node, index) => node !== query.nodes[index] || label(node) !== query.labels[index]))) query.fresh = true;
      // Moka retains its last results when the same school is searched again.
      // A sole live exact match is usable; unrelated retained choices are not evidence.
      const matching = current.filter(node => label(node) === clean(input.value));
      query.cachedExact = !query.fresh && Boolean(clean(input.value)) && matching.length === 1 && !disabled(matching[0]!);
      return query.fresh || query.cachedExact;
    };
    const options = (candidate: HTMLElement) => {
      if (candidate !== panel()) return [];
      const menu = one(direct(candidate, prefix('sd-Select-menu-'))), scroll = menu ? one(direct(menu, prefix('sd-Select-scrollable-'))) : undefined;
      if (!scroll) return [];
      return Array.from(scroll.children).flatMap(node => {
        if (node.matches(prefix('sd-Select-common-item-'))) return direct(node, prefix('sd-Menu-container-'));
        if (!node.matches(prefix('sd-Menu-container-'))) return [];
        if (direct(node, prefix('sd-Menu-content-')).length === 1) return [node as HTMLElement];
        if (!groupedCity || direct(node, prefix('sd-Menu-header-')).length !== 1) return [];
        const bodies = direct(node, 'div').filter(child => !child.matches(prefix('sd-Menu-header-')));
        return bodies.length === 1 ? direct(bodies[0]!, prefix('sd-Select-common-item-')).flatMap(item => direct(item, prefix('sd-Menu-container-'))) : [];
      }).filter(node => visible(node) && label(node));
    };
    const customInput = () => {
      if (fieldLabel !== '专业名称') return;
      const current = panel();
      if (!current) return;
      const custom = one(Array.from(current.querySelectorAll<HTMLElement>(prefix('custom-option-'))).filter(visible));
      if (!custom) return;
      const openTarget = () => one(direct(custom, 'button[type="button"]').filter(button => visible(button) && !disabled(button) && clean(button.textContent) === '添加专业全称')) ?? null;
      const input = () => {
        const node = one(direct(custom, 'input[placeholder="请输入就读专业全称"]')) as HTMLInputElement | undefined;
        return node?.type === 'text' && visible(node) && !node.readOnly && !disabled(node) ? node : null;
      };
      const commitTarget = () => input() ? one(direct(custom, 'button[type="button"]').filter(button => visible(button) && !disabled(button) && clean(button.textContent) === '添加')) ?? null : null;
      if (!openTarget() && (!input() || !commitTarget())) return;
      return { openTarget, input, commitTarget };
    };
    return {
      ...(!dismissal(root) ? { unsupportedReason: 'moka-close-unproven' } : {}),
      beforeOpen() { queries.delete(root); }, focusTarget: () => input, openTarget: () => input,
      panel, isOpen: () => Boolean(panel()), closeTarget: () => arrow ?? input,
      dismiss: () => dismissal(root) ?? null,
      readValue: () => { const display = one(direct(root, prefix('sd-Input-display-value-'))); return display ? clean(display.textContent) : null; },
      options: candidate => fresh(candidate) ? options(candidate).filter(node => !queries.get(root)?.cachedExact || label(node) === clean(input.value)) : [], optionLabel: label, optionDisabled: disabled,
      // Year and month menus contain all real candidates, so a date source is never typed here.
      searchInput: () => searchable ? input : null,
      beforeQuery() { const candidate = panel(), nodes = candidate ? options(candidate) : []; queries.set(root, { nodes, labels: nodes.map(label), sawLoading: false, fresh: false, cachedExact: false }); },
      loading: candidate => !fresh(candidate) || busy(),
      optionActivation: 'pointer',
      customInput,
      ...(groupedCity ? { dismissAfterSelection: true } : {}),
      selectionConfirmed: expected => (groupedCity || !panel()) && clean(one(direct(root, prefix('sd-Input-display-value-')))?.textContent) === expected,
    };
  };
  const date = (element: HTMLElement) => {
    if (!isMokaApplicationPage(element.ownerDocument.location)) return;
    const root = element.closest<HTMLElement>('label.day_info');
    const container = root?.parentElement, item = root?.closest<HTMLElement>(prefix('apply-field-'));
    const input = root ? one(direct(root, 'input[type="text"][readonly]')) as HTMLInputElement | undefined : undefined;
    const title = item ? one(direct(item, prefix('title-'))) : undefined;
    const caption = clean(title?.textContent);
    const precision: 'month' | 'day' | undefined = caption === '出生日期 (年龄)' ? 'month' : caption === '毕业时间' ? 'day' : undefined;
    if (!root || !container?.matches(prefix('sd-Dropdown-container-')) || !input || !precision || !dismissal(root)) return;
    const panel = () => {
      const candidates = direct(container, 'span').flatMap(slot => direct(slot, prefix('sd-Dropdown-dropdown-'))).filter(visible);
      const result = one(candidates);
      return result && direct(result, prefix('sd-panal-menu-wrapper-')).length === 1 ? result : undefined;
    };
    return { root, input, precision, panel };
  };
  const datePanel = (element: HTMLElement): DatePanel | undefined => {
    const control = date(element), panel = control?.panel();
    if (!control || !panel) return;
    const unique = (selector: string, matches: (node: HTMLElement) => boolean = () => true) => one(Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(node => visible(node) && matches(node))) ?? null;
    const yearTitle = () => unique(prefix('sd-basic-selector-year-'));
    const monthTitle = () => unique(prefix('sd-basic-selector-month-'));
    const year = () => Number(/^(\d{4})年$/.exec(clean(yearTitle()?.textContent))?.[1]);
    const month = () => months.indexOf(clean(monthTitle()?.textContent)) + 1;
    const yearChoice = (value: number) => unique(prefix('sd-basic-year-item-'), node => clean(node.textContent) === String(value));
    const monthChoice = (value: number) => unique(prefix('sd-basic-year-item-'), node => clean(node.textContent) === months[value - 1]);
    const dayChoice = (value: string) => unique(prefix('sd-basic-date-item-'), node => clean(node.textContent) === String(Number(value.slice(8, 10))) && !node.closest(prefix('sd-basic-fade-')));
    const selection = (value: string) => control.precision === 'month' ? monthChoice(Number(value.slice(5, 7))) : dayChoice(value);
    const previous = (unit: 'month' | 'year') => unique(prefix(unit === 'month' ? 'sd-Icon-iconleft-' : 'sd-Icon-icondoubleLeft-'));
    const next = (unit: 'month' | 'year') => unique(prefix(unit === 'month' ? 'sd-Icon-iconright-' : 'sd-Icon-icondoubleRight-'));
    return {
      panel, precision: control.precision, activation: 'pointer', navigationUnit: control.precision === 'month' ? 'year' : 'month',
      isOpen: () => Boolean(control.panel()),
      readMonth: () => ({ year: year(), month: control.precision === 'month' ? 1 : month() }),
      previous: () => previous(control.precision === 'month' ? 'year' : 'month'), next: () => next(control.precision === 'month' ? 'year' : 'month'),
      choice: value => { const node = selection(value); return node && !calendarDisabled(node) ? node : null; },
      choiceDisabled: value => { const node = selection(value); return Boolean(node && calendarDisabled(node)); },
      close: () => null, dismiss: () => dismissal(control.root) ?? null,
      ...(control.precision === 'day' ? { yearStep: (direction: 'previous' | 'next') => direction === 'previous' ? previous('year') : next('year') } : { yearPicker: () => ({
        openTarget: yearTitle,
        readRange: () => { const match = /^(\d{4})\s*-\s*(\d{4})$/.exec(clean(yearTitle()?.textContent)); return match ? { first: Number(match[1]), last: Number(match[2]) } : undefined; },
        previous: () => previous('year'), next: () => next('year'),
        choice: value => { const node = yearChoice(value); return node && !calendarDisabled(node) ? node : null; },
        choiceDisabled: value => { const node = yearChoice(value); return Boolean(node && calendarDisabled(node)); },
      }) }),
    };
  };
  return {
    combo, datePanel,
    dateOpenTarget: element => date(element)?.input,
    dateOpenActivation: element => date(element) ? 'pointer' : undefined,
    ownsDatePanel: (element, panel) => date(element)?.panel() === panel,
    readValue(element) {
      const control = date(element); if (!control) return;
      const value = clean(control.input.value);
      const match = control.precision === 'month' ? /^(\d{4}-\d{2})(?:\s*\(\d+岁\))?$/.exec(value) : /^(\d{4}-\d{2}-\d{2})$/.exec(value);
      return match ? match[1]! : value;
    },
    approveDismissal(control, target) { const expected = dismissal(control); return expected?.element === target.element && expected.scope === target.scope; },
  };
}
