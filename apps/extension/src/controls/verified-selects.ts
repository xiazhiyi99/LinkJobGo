import type { ComboControl, ControlAdapter, DatePanel, DateRangeControl, AddedRecordRollbackControl } from './index.js';

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
function visible(element: HTMLElement): boolean {
  if (!element.isConnected || !element.getClientRects().length) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
const disabled = (node: HTMLElement) => Boolean(node.closest('[disabled],[aria-disabled="true"],.next-disabled,.next-menu-item-disabled,.disabled'));
const ali = (element: HTMLElement) => element.ownerDocument.location.origin === 'https://campus-talent.alibaba.com' && /^\/personal\/resume\/?$/.test(element.ownerDocument.location.pathname);
const tencent = (element: HTMLElement) => element.ownerDocument.location.origin === 'https://careers.tencent.com' && element.ownerDocument.location.pathname === '/resume.html';
function paperSearchField(root: HTMLElement, input: HTMLInputElement): boolean {
  const match = /^(tfitem_\d+)\.paper$/.exec(input.id);
  const row = root.closest('.table-field-tiled-item'), group = row?.closest('.next-form-item.deep-table-form-field');
  if (!match || input.name && input.name !== input.id || !row || !group?.closest('#educationInfo') || !root.classList.contains('next-select-trigger')) return false;
  // A paper name alone is not enough: prove all three same-record markers in
  // this nested paper table, without borrowing fields from another row.
  const markers = Array.from(row.querySelectorAll('[id]')).filter(node => node.closest('.table-field-tiled-item') === row);
  return ['paper', 'level', 'isMainAuthor'].every(suffix => markers.filter(node => node.id === `${match[1]}.${suffix}`).length === 1);
}
const popupSelector = '.next-overlay-wrapper.opened > .next-overlay-inner.deep-select-popup > ul.next-menu.next-select-menu[role="listbox"]';
const rectKey = (node: HTMLElement) => { const rect = node.getBoundingClientRect(); return `${rect.left}:${rect.top}:${rect.width}:${rect.height}`; };
interface Ownership { before: Map<HTMLElement,string>; opening: boolean; proven?: HTMLElement; query?: { nodes: HTMLElement[]; labels: string[]; sawLoading: boolean; fresh: boolean } }

/** Verified single-choice behavior only. No date, record action, or tag deletion. */
export function createVerifiedSelectControlAdapter(): ControlAdapter {
  const states = new WeakMap<HTMLElement,Ownership>();
  const rangeStates = new WeakMap<HTMLElement,{ before: Map<HTMLElement,string>; expandedBefore: boolean; opening: boolean }>();
  const rollbackStates = new WeakMap<HTMLElement,{ before: Set<HTMLElement>; deleting: boolean }>();
  const rangeOwners = new WeakMap<HTMLElement,HTMLElement>();
  const owners = new WeakMap<HTMLElement,HTMLElement>();
  const state = (root: HTMLElement) => { let result = states.get(root); if (!result) { result = { before: new Map(), opening: false }; states.set(root,result); } return result; };
  const arrowsFor = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.next-input-control > span.next-select-arrow')).filter(node => node.closest('.next-select') === root);
  const selectedTags = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.next-select-values > .next-tag > .next-tag-body')).filter(node => node.closest('.next-select') === root).map(node => clean(node.textContent));
  const selectedSingle = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.next-select-values > em')).filter(node => node.closest('.next-select') === root);
  const anchored = (root: HTMLElement, panel: HTMLElement) => {
    const box = root.getBoundingClientRect(), menu = panel.parentElement!.getBoundingClientRect();
    return box.width > 0 && menu.width > 0 && Math.abs(menu.width - box.width) <= 24 &&
      (Math.abs(menu.left - box.left) <= 16 || Math.abs(menu.right - box.right) <= 16) &&
      (Math.abs(menu.top - box.bottom) <= 24 || Math.abs(menu.bottom - box.top) <= 24);
  };
  const menus = (root: HTMLElement) => Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(popupSelector)).filter(visible);
  const inputFor = (root: HTMLElement) => { const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[role="combobox"]')).filter(node => node.closest('.next-select') === root); return inputs.length === 1 ? inputs[0] : undefined; };
  const isOpen = (root: HTMLElement, input: HTMLInputElement) => root.classList.contains('next-active') && input.getAttribute('aria-expanded') === 'true' && root.ownerDocument.activeElement === input;
  const panelFor = (root: HTMLElement, input: HTMLInputElement, tag: boolean) => {
    const current = state(root);
    if (!visible(root) || !isOpen(root,input)) return undefined;
    const eligible = menus(root).filter(panel => anchored(root,panel) && (tag ? panel.classList.contains('next-menu-selectable-multiple') : panel.parentElement!.classList.contains('next-select-single-menu')));
    // A retained portal remains usable only for the exact control that proved it.
    const candidates = eligible.filter(panel => owners.get(panel) === root || current.opening && (!current.before.has(panel) || current.before.get(panel) !== rectKey(panel.parentElement!)));
    if (candidates.length !== 1) return undefined;
    const panel = candidates[0]!; current.proven = panel; owners.set(panel,root); return panel;
  };
  const resolve = (element: HTMLElement): ComboControl | undefined => {
    if (tencent(element)) {
      const degree = element.closest<HTMLElement>('.education-select');
      if (degree) {
        const titles = Array.from(degree.querySelectorAll<HTMLElement>(':scope > div.select.select-down-icon.education-required'));
        const panels = Array.from(degree.querySelectorAll<HTMLElement>(':scope > ul.select-ul'));
        if (titles.length !== 1 || panels.length !== 1) return undefined;
        const title = titles[0]!, panel = panels[0]!;
        const scope = degree.parentElement;
        const labels = scope?.matches('.resume-module-left,.resume-module-right') ? Array.from(scope.querySelectorAll<HTMLElement>(':scope > p.text')).filter(node => clean(Array.from(node.childNodes).map(child => child.nodeType === 3 ? child.textContent : child instanceof node.ownerDocument.defaultView!.HTMLElement && visible(child) ? child.textContent : '').join('')).replace(/[＊*：:]/g, '').trim() === '学历' && visible(node) && !node.matches('[role],[tabindex],[contenteditable],[onclick]') && !node.querySelector('input,textarea,select,button,a,label,[role],[tabindex],[contenteditable],[onclick]')) : [];
        const dismiss = labels.length === 1 && scope ? { element: labels[0]!, scope } : undefined;
        return { ...(!dismiss ? { unsupportedReason: 'tencent-degree-close-unproven' } : {}), beforeOpen() {}, panel: () => panel.classList.contains('active') && visible(panel) ? panel : undefined, openTarget: () => title, closeTarget: () => title, dismiss: () => dismiss ?? null, readValue: () => { const value = clean(title.textContent); return value === '选择学历' ? '' : value; }, options: candidate => candidate === panel && panel.classList.contains('active') ? Array.from(panel.querySelectorAll<HTMLElement>(':scope > li.select-li')).filter(visible) : [], optionLabel: node => clean(node.textContent), optionDisabled: disabled, searchInput: () => null };
      }
      const school = element.closest<HTMLElement>('.school-select');
      const input = school?.querySelector<HTMLInputElement>('input#school.school-input');
      const module = school?.parentElement;
      const freeTextSchool = element === input && module?.matches('.school.resume-module') && input.type === 'text' && input.matches('input.input.school-input.required[maxlength="255"]:not([role]):not([readonly])') && Array.from(module.querySelectorAll<HTMLElement>(':scope > p.text')).some(node => clean(node.querySelector(':scope > span:not([class])')?.textContent ?? Array.from(node.childNodes).filter(child => child.nodeType === 3).map(child => child.textContent).join('')).replace(/[＊*：:]/g, '').trim() === '学校');
      if (school && input && !freeTextSchool) return { unsupportedReason: 'tencent-school-selection-unverified', beforeOpen() {}, panel: () => undefined, openTarget: () => input, closeTarget: () => input, readValue: () => '', options: () => [], searchInput: () => null };
      return undefined;
    }
    if (!ali(element)) return undefined;
    const root = element.closest<HTMLElement>('.next-select'); if (!root) return undefined;
    const input = inputFor(root); if (!input) return undefined;
    const tag = root.classList.contains('next-select-tag') && root.classList.contains('next-has-search');
    if (!tag && !root.classList.contains('next-select-single')) return undefined;
    const arrows = arrowsFor(root), arrow = arrows.length === 1 ? arrows[0] : undefined;
    const tags = selectedTags(root), singles = selectedSingle(root);
    const readValue = () => { const values = tag ? selectedTags(root) : selectedSingle(root).map(node => clean(node.textContent)); return values.length > 1 ? values : values[0] ?? ''; };
    const suffix = (input.name || input.id).split('.').at(-1);
    const label = clean(root.closest('.next-form-item')?.querySelector(':scope > .next-form-item-label')?.textContent).replace(/[＊*：:]/g,'');
    const searchable = !input.readOnly && tag && (['school','major'].includes(suffix ?? '') || ['学校','学校名称','专业','专业名称'].includes(label) || paperSearchField(root, input));
    const unsupported = disabled(root) ? 'verified-select-disabled' : (tag && tags.length > 1 || !tag && singles.length > 1) ? 'verified-select-multiple-values-unsupported' : tag && !arrow ? 'verified-select-close-unproven' : tag && !searchable ? 'verified-select-search-field-unsupported' : undefined;
    const nodes = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLElement>(':scope > li.next-select-menu-item[role="option"]')).filter(visible);
    const busy = (panel: HTMLElement) => root.getAttribute('aria-busy') === 'true' || panel.getAttribute('aria-busy') === 'true' || Array.from(panel.querySelectorAll<HTMLElement>('[role="progressbar"],.next-loading')).some(visible);
    const fresh = (panel: HTMLElement) => {
      const query = state(root).query;
      if (!query) return true;
      if (busy(panel)) { query.sawLoading = true; return false; }
      const current = nodes(panel);
      if (current.length && (query.sawLoading || current.length !== query.nodes.length || current.some((node, index) => node !== query.nodes[index] || clean(node.textContent) !== query.labels[index]))) query.fresh = true;
      // A delayed response from another school query can also replace nodes.
      // Require an exact candidate for the current school query before treating
      // that mutation as usable evidence; unmatched results remain unsuccessful.
      const schoolQuery = searchable && suffix === 'school' ? clean(input.value) : '';
      return query.fresh && (!schoolQuery || current.some(node => clean(node.textContent) === schoolQuery));
    };
    return {
      ...(unsupported ? { unsupportedReason: unsupported } : {}),
      beforeOpen() { const current = state(root); current.before = new Map(menus(root).map(panel => [panel,rectKey(panel.parentElement!)])); current.opening = true; current.proven = undefined; current.query = undefined; },
      focusTarget: () => input,
      panel: () => panelFor(root,input,tag), openTarget: () => input, closeTarget: () => arrow ?? input,
      readValue,
      options: panel => panel === panelFor(root,input,tag) && fresh(panel) ? nodes(panel) : [],
      optionLabel: node => clean(node.textContent),
      optionDisabled(node) { const chosen = selectedTags(root); return disabled(node) || tag && (chosen.length > 1 || chosen.length === 1 && clean(node.textContent) !== chosen[0]); },
      searchInput: () => searchable ? input : null,
      beforeQuery() { const panel = panelFor(root,input,tag); const before = panel ? nodes(panel) : []; state(root).query = { nodes: before, labels: before.map(node => clean(node.textContent)), sawLoading: false, fresh: false }; },
      loading: panel => busy(panel) || !fresh(panel),
    };
  };
  const dateRange = (start: HTMLElement, end: HTMLElement): DateRangeControl | undefined => {
    if (!ali(start) || !ali(end) || !start.matches('input[role="combobox"][readonly][placeholder="起始日期"]') || !end.matches('input[role="combobox"][readonly][placeholder="结束日期"]')) return;
    const root = start.closest<HTMLElement>('.next-range-picker');
    if (!root || end.closest('.next-range-picker') !== root) return;
    const trigger = root.querySelector<HTMLElement>(':scope > .next-range-picker-trigger[aria-haspopup="true"]');
    if (!trigger || !trigger.contains(start) || !trigger.contains(end)) return;
    const selector = '.next-overlay-wrapper.opened > .next-overlay-inner.next-range-picker-body.deep-range-picker-popup.is-desktop';
    const panels = () => Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(selector)).filter(visible);
    const expanded = () => trigger.getAttribute('aria-expanded') === 'true' && start.getAttribute('aria-expanded') === 'true' && end.getAttribute('aria-expanded') === 'true';
    const anchoredRange = (panel: HTMLElement) => { const box = root.getBoundingClientRect(), rect = panel.getBoundingClientRect(); return box.width > 0 && rect.width >= box.width && Math.abs(rect.left - box.left) <= 16 && (Math.abs(rect.top - box.top) <= 24 || Math.abs(rect.top - box.bottom) <= 24 || Math.abs(rect.bottom - box.top) <= 24 || Math.abs(rect.bottom - box.bottom) <= 26); };
    const panel = () => {
      const state = rangeStates.get(root); if (!state || !expanded() || !visible(root)) return;
      const candidates = panels().filter(candidate => anchoredRange(candidate) && (rangeOwners.get(candidate) === root || state.opening && (!state.before.has(candidate) || state.before.get(candidate) !== rectKey(candidate) || !state.expandedBefore)));
      if (candidates.length !== 1) return;
      rangeOwners.set(candidates[0]!, root); return candidates[0]!;
    };
    const calendarFor = (index: 0 | 1) => { const popup = panel(); if (!popup) return; const calendars = Array.from(popup.querySelectorAll<HTMLElement>(':scope > .next-range-picker-panel-body > .next-calendar.next-calendar-panel')).filter(visible); return calendars.length === 2 ? calendars[index] : undefined; };
    const unique = (calendar: HTMLElement | undefined, selector: string, match: (node: HTMLElement) => boolean = () => true) => { const nodes = Array.from(calendar?.querySelectorAll<HTMLElement>(selector) ?? []).filter(node => visible(node) && match(node)); return nodes.length === 1 ? nodes[0]! : null; };
    const part = (index: 0 | 1): DatePanel | undefined => {
      const popup = panel(), calendar = calendarFor(index); if (!popup || !calendar) return;
      const yearButton = () => unique(calendarFor(index), '.next-calendar-panel-header button.next-calendar-btn[title]', node => /^\d{4}$/.test(node.title));
      const year = Number(yearButton()?.title); if (!Number.isInteger(year) || year <= 0) return;
      const months = (value: string) => unique(calendarFor(index), 'td[role="gridcell"][title]', node => node.title === `${Number(value.slice(5, 7))}月`);
      return {
        panel: popup, precision: 'month', navigationUnit: 'year', readMonth: () => ({ year: Number(yearButton()?.title), month: 1 }),
        previous: () => unique(calendarFor(index), 'button[title="上一年"]'), next: () => unique(calendarFor(index), 'button[title="下一年"]'),
        choice: value => { const node = months(value); return node && !disabled(node) ? node : null; }, choiceDisabled: value => { const node = months(value); return !!node && disabled(node); },
        close: () => null, isOpen: () => Boolean(panel()),
        yearPicker: () => ({
          openTarget: yearButton,
          readRange: () => { const node = unique(calendarFor(index), '.next-calendar-panel-header button.next-calendar-btn[title]', node => /^\d{4}-\d{4}$/.test(node.title)); const match = /^(\d{4})-(\d{4})$/.exec(node?.title ?? ''); return match ? { first: Number(match[1]), last: Number(match[2]) } : undefined; },
          previous: () => unique(calendarFor(index), 'button.next-calendar-btn-prev-decade[title="上十年"]'), next: () => unique(calendarFor(index), 'button.next-calendar-btn-next-decade[title="后十年"]'),
          choice: year => { const node = unique(calendarFor(index), '.next-calendar-year[title]', node => node.title === String(year)); return node && !disabled(node) ? node : null; },
          choiceDisabled: year => { const node = unique(calendarFor(index), '.next-calendar-year[title]', node => node.title === String(year)); return !!node && disabled(node); },
        }),
      };
    };
    return { root, beforeOpen() { rangeStates.set(root, { before: new Map(panels().map(candidate => [candidate,rectKey(candidate)])), expandedBefore: expanded(), opening: true }); }, openTarget: () => start, panel, part,
      confirm: () => { const popup = panel(); return unique(popup, '.next-date-picker-panel-footer button', node => clean(node.textContent) === '确定'); },
      escapeTarget: () => unique(panel(), '.next-range-picker-panel-input-start-date input'),
    };
  };
  const splitDate = (element: HTMLElement): DatePanel | undefined => {
    if (!tencent(element)) return;
    const root = element.closest<HTMLElement>('.test-border'); if (!root) return;
    const unique = (selector: string) => { const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector)); return nodes.length === 1 ? nodes[0]! : null; };
    const year = unique('.select-wrapper.short > .select-left.short-down-icon.required-year'), month = unique('.select-wrapper.long > .select-right.splicing-down-icon.required-month');
    const years = unique('.select-wrapper.short > ul.small-select-ul'), months = unique('.select-wrapper.long > ul.splicing-select-ul');
    if (!year || !month || !years || !months) return;
    const opened = (panel: HTMLElement) => panel.classList.contains('active') && visible(panel);
    const find = (panel: HTMLElement, selector: string, label: string) => { const nodes = Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(node => clean(node.textContent) === label && visible(node)); return nodes.length === 1 ? nodes[0]! : null; };
    const scope = root.closest<HTMLElement>('.resume-module-left,.resume-module-right');
    const labels = scope ? Array.from(scope.querySelectorAll<HTMLElement>(':scope > p.text')).filter(visible) : [];
    if (!scope || labels.length !== 1) return;
    return { panel: root, precision: 'month', navigationUnit: 'year', isOpen: () => opened(years) || opened(months), readMonth: () => ({ year: Number(clean(year.textContent)), month: Number(clean(month.textContent)) }), previous: () => null, next: () => null,
      choiceOpenTarget: () => opened(months) ? null : month,
      choice: value => { const node = opened(months) ? find(months, ':scope > li.splicing-select-li', value.slice(5, 7)) : null; return node && !disabled(node) ? node : null; },
      choiceDisabled: value => { const node = opened(months) ? find(months, ':scope > li.splicing-select-li', value.slice(5, 7)) : null; return !!node && disabled(node); }, close: () => null, dismiss: () => ({ element: labels[0]!, scope }),
      yearPicker: () => ({ openTarget: () => year, readRange: () => { if (!opened(years)) return; const values = Array.from(years.querySelectorAll<HTMLElement>(':scope > li.small-select-li')).map(node => Number(clean(node.textContent))).filter(value => Number.isInteger(value) && value >= 1000 && value <= 9999); return values.length ? { first: Math.min(...values), last: Math.max(...values) } : undefined; }, previous: () => null, next: () => null,
        choice: value => { const node = opened(years) ? find(years, ':scope > li.small-select-li', String(value)) : null; return node && !disabled(node) ? node : null; }, choiceDisabled: value => { const node = opened(years) ? find(years, ':scope > li.small-select-li', String(value)) : null; return !!node && disabled(node); },
      }),
    };
  };
  const addedRecordRollback = (record: HTMLElement, opener: HTMLElement): AddedRecordRollbackControl | undefined => {
    if (!ali(record) || !record.matches('.table-field-tiled-item') || !record.contains(opener) || !opener.matches('button[aria-haspopup="true"]') || !opener.parentElement?.matches('span.item-actions')) return;
    const identifiers = Array.from(record.querySelectorAll<HTMLElement>('[id]')).map(node => node.id);
    const has = (suffix: string) => identifiers.some(id => new RegExp(`^tfitem_\\d+\\.${suffix}$`).test(id));
    const education = !!record.closest('#educationInfo') && has('school');
    const experience = !!record.closest('#experienceInfo') && has('name') && has('timeRange') && (has('responsibility') || has('description'));
    const language = !!record.closest('.deep-table-form-field') && has('language') && has('languageRank');
    const paper = !!record.closest('#educationInfo .deep-table-form-field') && has('paper') && has('level') && has('isMainAuthor');
    if ([education, experience, language, paper].filter(Boolean).length !== 1) return;
    const suffix = education ? 'school' : experience ? 'name' : paper ? 'paper' : 'language';
    const groups = [...new Set(identifiers.filter(id => new RegExp(`^tfitem_\\d+\\.${suffix}$`).test(id)).map(id => id.split('.')[0]))];
    if (groups.length !== 1) return;
    const deletionClass = experience ? /(?:^|\s)ExperienceInfo--deleteBtn--/ : /(?:^|\s)EducationInfo--deleteBtn--/;
    const deletionLabel = (node: HTMLElement) => language || paper ? !clean(node.textContent).replace(/[\uE000-\uF8FF]/g, '') && node.querySelectorAll('.next-icon-ashbin').length === 1 : clean(node.querySelector('.next-btn-helper')?.textContent) === '删除这段经历';
    const balloons = () => Array.from(record.ownerDocument.querySelectorAll<HTMLElement>('[role="tooltip"].next-balloon.deep-balloon-popup[aria-hidden="false"]')).filter(visible);
    const deleteTarget = () => {
      const buttons = Array.from(opener.querySelectorAll<HTMLElement>(':scope > div[data-group-id] > button[type="button"]')).filter(node => node.parentElement?.getAttribute('data-group-id') === groups[0] && deletionClass.test(node.className) && deletionLabel(node) && visible(node));
      return buttons.length === 1 ? { element: buttons[0]!, scope: record } : undefined;
    };
    return { deleteTarget, beforeDelete() { rollbackStates.set(record, { before: new Set(balloons()), deleting: true }); }, confirmationTarget() {
      const state = rollbackStates.get(record), target = deleteTarget(); if (!state?.deleting || !target) return;
      const expanded = Array.from(record.ownerDocument.querySelectorAll<HTMLElement>('button[aria-haspopup="true"][aria-expanded="true"]')).filter(node => visible(node) && node.closest('span.item-actions'));
      if (expanded.length !== 1 || expanded[0] !== opener) return;
      const candidates = balloons().filter(panel => !state.before.has(panel) && clean(panel.querySelector('.next-balloon-content')?.textContent).startsWith('确认要删除本项吗？'));
      if (candidates.length !== 1) return;
      const panel = candidates[0]!, buttons = Array.from(panel.querySelectorAll<HTMLElement>('button[type="button"]')).filter(visible);
      const confirm = buttons.filter(node => clean(node.textContent) === '确定'), cancel = buttons.filter(node => clean(node.textContent) === '取消');
      return buttons.length === 2 && confirm.length === 1 && cancel.length === 1 ? { element: confirm[0]!, scope: panel } : undefined;
    } };
  };
  return { combo: resolve, dateRange, addedRecordRollback, datePanel: splitDate, ownsDatePanel: (element, panel) => splitDate(element)?.panel === panel, readValue: element => {
      const split = splitDate(element);
      if (split) { const date = split.readMonth(); return Number.isInteger(date.year) && date.year >= 1000 && date.month >= 1 && date.month <= 12 ? `${date.year}-${String(date.month).padStart(2, '0')}` : ''; }
      if (tencent(element) && element.matches('.currently-checkbox > p.checkbox-text')) return element.classList.contains('active');
      return resolve(element)?.readValue();
    },
    allowDecorativeClick(control, target) {
      if (!ali(control)) return false;
      const root = control.closest<HTMLElement>('.next-select');
      if (!root || target.closest('.next-select') !== root || target.tagName !== 'SPAN' || target.getAttribute('aria-hidden') !== 'true') return false;
      const arrows = arrowsFor(root);
      if (arrows.length !== 1 || arrows[0] !== target || !target.isConnected || !target.getClientRects().length || disabled(target)) return false;
      for (let node: HTMLElement | null = target; node; node = node.parentElement) {
        const style = node.ownerDocument.defaultView!.getComputedStyle(node);
        if (node.hidden || node !== target && node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
      }
      const input = inputFor(root); if (!input) return false;
      const tag = root.classList.contains('next-select-tag') && root.classList.contains('next-has-search');
      return Boolean(panelFor(root,input,tag));
    },
  };
}
