import type { ControlAdapter, ComboControl, DatePanel } from './index.js';
const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const visible = (element: HTMLElement) => {
  if (!element.isConnected || !element.getClientRects().length) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(node);
    if (node.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
};
interface Ownership { before: Map<HTMLElement, string>; focusedBefore: boolean; proven?: HTMLElement; opened: boolean }
const matches = (element: HTMLElement) => element.ownerDocument.location.origin === 'https://zhaopin.meituan.com' && ['/web/delivery-confirm', '/web/personal-center/resume-detail'].includes(element.ownerDocument.location.pathname);
const finiteSelectLabels = new Set(['性别', '学历', '成绩排名', '是否全日制', '语言类型', '语言水平', '熟练程度', '语言考试', '工作类型', '发表渠道', '作者顺序']);
/** No Vue internals or page data: ownership derives from the click's before/after DOM and local geometry. */
export function createMeituanControlAdapter(): ControlAdapter {
  const comboStates = new WeakMap<HTMLElement, Ownership>();
  const dateStates = new WeakMap<HTMLElement, Ownership>();
  const selectors = { combo: '.mtd-select-popup', date: '.mtd-datepicker-pop' };
  const all = (root: HTMLElement, selector: string) => Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(selector)).filter(visible);
  const state = (map: WeakMap<HTMLElement, Ownership>, root: HTMLElement) => { let item = map.get(root); if (!item) { item = { before: new Map(), focusedBefore: false, opened: false }; map.set(root, item); } return item; };
  const rectKey = (element: HTMLElement) => { const rect = element.getBoundingClientRect(); return `${rect.left}:${rect.top}:${rect.width}:${rect.height}`; };
  const focused = (root: HTMLElement) => Boolean(root.querySelector('.mtd-select-filter-focused')) || root.contains(root.ownerDocument.activeElement);
  const anchored = (root: HTMLElement, panel: HTMLElement) => { const box = root.getBoundingClientRect(), rect = panel.getBoundingClientRect(); return (Math.abs(rect.left - box.left) <= 16 || Math.abs(rect.right - box.right) <= 16) && (Math.abs(rect.top - box.bottom) <= 24 || Math.abs(rect.bottom - box.top) <= 24); };
  const before = (map: WeakMap<HTMLElement, Ownership>, root: HTMLElement, selector: string) => { const item = state(map, root); item.before = new Map(all(root, selector).map(panel => [panel, rectKey(panel)])); item.focusedBefore = focused(root); item.proven = undefined; item.opened = true; };
  const owned = (map: WeakMap<HTMLElement, Ownership>, root: HTMLElement, selector: string): HTMLElement | undefined => {
    const item = state(map, root);
    if (item.proven && visible(item.proven) && anchored(root, item.proven) && (selector !== selectors.combo || focused(root))) return item.proven;
    const local = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(visible);
    if (local.length === 1) { item.proven = local[0]; return local[0]; }
    const container = root.closest<HTMLElement>('.mtd-popover,.mtd-dropdown');
    if (container && container.querySelectorAll('.mtd-select,.mtd-date-picker').length === 1) {
      const panels = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(visible);
      if (panels.length === 1) { item.proven = panels[0]; return panels[0]; }
    }
    if (!item.opened) return undefined;
    const candidates = all(root, selector).filter(panel => anchored(root, panel) && (!item.before.has(panel) || item.before.get(panel) !== rectKey(panel) || !item.focusedBefore && focused(root)));
    if (candidates.length !== 1) return undefined;
    if (selector === selectors.combo && !focused(root)) return undefined;
    item.proven = candidates[0]; return candidates[0];
  };
  const itemLabel = (item: Element | null) => {
    if (!item) return '';
    const candidates = [item.querySelector(':scope > .mtd-form-item-body > .label'), item.querySelector(':scope > .mtd-form-item-label .mtd-form-item-label-ctx'), item.querySelector(':scope > .mtd-form-item-label')];
    return candidates.map(node => clean(node?.textContent).replace(/[＊*：:]/g, '').trim()).find(Boolean) ?? '';
  };
  const comboRoot = (element: HTMLElement) => matches(element) ? element.closest<HTMLElement>('.mtd-select') : null;
  const dateRoot = (element: HTMLElement) => matches(element) ? element.closest<HTMLElement>('.mtd-date-picker') : null;
  return {
    combo(element): ComboControl | undefined {
      const root = comboRoot(element); if (!root) return;
      const filter = root.querySelector<HTMLElement>('.mtd-select-filter');
      if (!filter) return;
      // MTD binds the opening click to this inner button, beside its separate clear button.
      const trigger = Array.from(filter.querySelectorAll<HTMLElement>(':scope > div[role="button"][tabindex="0"]')).find(node => !node.classList.contains('mtd-select-filter-delete') && node.querySelector('.mtd-select-filter-input') && node.querySelector('.mtd-select-filter-icon')) ?? filter;
      const closeIcon = root.querySelector<HTMLElement>('.mtd-select-filter-icon');
      return {
        ...(root.classList.contains('mtd-select-multiple') ? { unsupportedReason: 'meituan-multiple-select-unsupported' } : !closeIcon ? { unsupportedReason: 'meituan-popup-close-unsupported' } : {}),
        beforeOpen: () => before(comboStates, root, selectors.combo),
        panel: () => owned(comboStates, root, selectors.combo),
        openTarget: () => trigger, closeTarget: () => closeIcon ?? trigger,
        // Focusing the search input can schedule an async open before the button toggles it shut.
        focusTarget: () => trigger !== filter ? trigger : root.querySelector<HTMLInputElement>('input') ?? trigger,
        readValue: () => {
          const label = root.querySelector<HTMLElement>('.mtd-select-filter-label');
          return label && !label.classList.contains('mtd-select-filter-hint') ? clean(label.textContent) : '';
        },
        // Finite enums must reach the server intact: searching a résumé alias
        // such as 大学英语六级 or 第一作者 hides CET-6 or 一作 before alias matching.
        searchInput: () => finiteSelectLabels.has(itemLabel(root.closest('.mtd-form-item'))) ? null : root.querySelector<HTMLInputElement>('.mtd-select-filter-input input'),
        // A remote search may debounce its request while an old empty label is
        // visible. Only a finite, unfiltered enum can prove an empty result here.
        empty: panel => finiteSelectLabels.has(itemLabel(root.closest('.mtd-form-item'))) && Array.from(panel.querySelectorAll<HTMLElement>('.mtd-select-popup-empty')).some(node => visible(node) && clean(node.textContent) === '无数据'),
        options: panel => Array.from(panel.querySelectorAll<HTMLElement>('.mtd-select-item')).filter(node => !node.classList.contains('mtd-select-item-loading') && !node.classList.contains('mtd-select-item-empty')),
        optionLabel: node => clean(node.querySelector('.mtd-select-item-content')?.textContent ?? node.textContent),
        optionDisabled: node => node.classList.contains('mtd-select-item-disabled'),
        writeBlockedReason: (targetLabel, context) => {
          const record = root.closest<HTMLElement>('.mtd-form');
          if (!record?.closest('.edu_experience_edit')) return;
          const item = root.closest('.mtd-form-item');
          const label = itemLabel(item);
          const selected = root.querySelector<HTMLElement>('.mtd-select-filter-label:not(.mtd-select-filter-hint)');
          if (!['学校','学校名称'].includes(label) || clean(selected?.textContent) === targetLabel) return;
          const college = Array.from(record.querySelectorAll<HTMLElement>('.mtd-form-item')).filter(candidate => {
            if (candidate.closest('.mtd-form') !== record) return false;
            const label = itemLabel(candidate);
            return ['学院','学院名称','院系','所属学院'].includes(label);
          });
          const hasCollege = college.some(candidate => Array.from(candidate.querySelectorAll<HTMLElement>('.mtd-select-filter-label:not(.mtd-select-filter-hint)')).some(node => visible(node) && Boolean(clean(node.textContent))) || Array.from(candidate.querySelectorAll<HTMLInputElement>('input')).some(node => visible(node) && !node.closest('.mtd-select-filter-input') && Boolean(node.value.trim())));
          return hasCollege && !(context.overwrite === 'replace' && context.allowCollegeReset === true) ? 'cascade-college-source-required' : undefined;
        },

        loading: panel => Boolean(Array.from(panel.querySelectorAll<HTMLElement>('.mtd-loading,.mtd-select-loading,.mtd-select-item-loading')).find(visible)),
      };
    },
    readValue(element) {
      const root = dateRoot(element); if (!root) return;
      const value = root.querySelector<HTMLInputElement>('input')?.value;
      if (value === undefined) return;
      // Only an observed numeric date delimiter changes; precision never changes.
      return /^\d{4}\/\d{2}(?:\/\d{2})?$/.test(value) ? value.replaceAll('/', '-') : value;
    },
    beforeDateOpen(element) { const root = dateRoot(element); if (root) before(dateStates, root, selectors.date); },
    dateOpenTarget(element) { return dateRoot(element)?.querySelector<HTMLInputElement>('input') ?? undefined; },
    ownsDatePanel(element, panel) { const root = dateRoot(element); return !!root && owned(dateStates, root, selectors.date) === panel; },
    datePanel(element): DatePanel | undefined {
      const root = dateRoot(element); if (!root) return;
      const panel = owned(dateStates, root, selectors.date); if (!panel) return;
      const current = () => { const panels = Array.from(panel.querySelectorAll<HTMLElement>('.mtd-month-calendar-content.active')).filter(visible); return panels.length === 1 ? panels[0] : undefined; };
      if (!current()) return;
      const yearText = () => clean(current()?.querySelector('.mtd-month-calendar-year-btn')?.textContent ?? '');
      if (!/^\d{4}年$/.test(yearText()) && !/^\d{4}\s*[-–]\s*\d{4}$/.test(clean(current()?.querySelector('.mtd-month-calendar-year-header-range')?.textContent))) return;
      const choicesFor = (value: string) => Array.from(current()?.querySelectorAll<HTMLElement>('.mtd-month-panel-list-data') ?? []).filter(node => clean(node.textContent) === `${Number(value.slice(5, 7))}月` && visible(node));
      const disabled = (node: HTMLElement) => Boolean(node.closest('.disabled,.disabled-month,.mtd-month-panel-list-disabled,[disabled],[aria-disabled="true"]'));
      return {
        panel, precision: 'month', navigationUnit: 'year',
        yearPicker: () => ({
          openTarget: () => current()?.querySelector<HTMLElement>('.mtd-month-calendar-year-btn') ?? null,
          readRange: () => { const value = clean(current()?.querySelector('.mtd-month-calendar-year-header-range')?.textContent); const match = /^(\d{4})\s*[-–]\s*(\d{4})$/.exec(value); return match ? { first: Number(match[1]), last: Number(match[2]) } : undefined; },
          previous: () => current()?.querySelector<HTMLElement>('.mtd-month-calendar-year-header .left-switcher') ?? null,
          next: () => current()?.querySelector<HTMLElement>('.mtd-month-calendar-year-header .right-switcher') ?? null,
          choice: year => { const choices = Array.from(current()?.querySelectorAll<HTMLElement>('.mtd-year-panel-list-data') ?? []).filter(node => visible(node) && clean(node.textContent) === String(year)); return choices.length === 1 && !choices[0]!.closest('.disabled-year,[disabled],[aria-disabled="true"]') ? choices[0]! : null; },
          choiceDisabled: year => { const choices = Array.from(current()?.querySelectorAll<HTMLElement>('.mtd-year-panel-list-data') ?? []).filter(node => visible(node) && clean(node.textContent) === String(year)); return choices.length === 1 && Boolean(choices[0]!.closest('.disabled-year,[disabled],[aria-disabled="true"]')); },
        }),
        isOpen: () => Boolean(owned(dateStates, root, selectors.date)),
        readMonth: () => ({ year: Number(yearText().slice(0, -1)), month: 1 }),
        previous: () => current()?.querySelector<HTMLElement>('.mtd-month-calendar-year-switcher.left-switcher') ?? null,
        next: () => current()?.querySelector<HTMLElement>('.mtd-month-calendar-year-switcher.right-switcher') ?? null,
        choice: value => { const choices = choicesFor(value).filter(node => !disabled(node)); return choices.length === 1 ? choices[0] : null; },
        choiceDisabled: value => { const choices = choicesFor(value); return choices.length === 1 && disabled(choices[0]); },
        close: () => null,
        dismiss: () => {
          const scope = root.closest<HTMLElement>('.mtd-form-item-body');
          if (!scope) return null;
          const labels = Array.from(scope.children).filter((node): node is HTMLElement => node instanceof root.ownerDocument.defaultView!.HTMLElement && node.matches('div.label') && visible(node) && !node.matches('[role],[tabindex],[contenteditable],[onclick]') && !node.querySelector('input,textarea,select,button,a,label,[role],[tabindex],[contenteditable],[onclick]'));
          return labels.length === 1 ? { element: labels[0], scope } : null;
        },
      };
    },
  };
}
