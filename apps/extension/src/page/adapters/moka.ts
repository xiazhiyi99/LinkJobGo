import type { SiteAdapter } from '../index.js';
import { readHashRoute } from '@job-assistant/autofill-contracts';

const prefix = (value: string) => `[class^="${value}"],[class*=" ${value}"]`;
const blockSelector = prefix('apply-block-');
const recordSelector = prefix('apply-fields-');
const fieldSelector = prefix('apply-field-');
const titleSelector = prefix('title-');
const controlSelector = prefix('ctrl-');
const selectSelector = prefix('sd-Select-container-');
const nativeFields = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select';
const direct = (element: Element, selector: string) => Array.from(element.children).filter(child => child.matches(selector));
const clean = (value: string | null) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);

export function isMokaApplicationPage(location: Pick<Location, 'origin' | 'pathname' | 'hash'>): boolean {
  const hashRoute = readHashRoute(location.hash);
  return location.origin === 'https://app.mokahr.com' && /^\/campus_apply\/[A-Za-z0-9_-]+\/\d+\/?$/.test(location.pathname) && hashRoute !== undefined && /^\/job\/[A-Za-z0-9_-]+\/apply\/?$/.test(hashRoute);
}
export const isCompatibleMokaDocument = (document: Document) => blocks(document).some(section => direct(section, recordSelector).some(record =>
  direct(record, fieldSelector).some(field => direct(field, controlSelector).some(control => control.querySelector(nativeFields)))));

function staticText(element: Element | null): string {
  if (!element) return '';
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll(`input,textarea,select,button,[role="button"],script,style,[hidden],[aria-hidden="true"],${prefix('required-asterisk-')}`).forEach(node => node.remove());
  return clean(copy.textContent);
}

function header(section: Element): Element | undefined {
  const titles = direct(section, prefix('blockTitle-'));
  return titles.length === 1 ? titles[0] : undefined;
}

function blockTitle(section: Element): string {
  // Description and add controls are siblings of/in this first static row.
  return staticText(header(section)?.firstElementChild ?? null);
}

function blocks(document: Document): Element[] {
  if (!isMokaApplicationPage(document.location)) return [];
  return Array.from(document.querySelectorAll(blockSelector)).filter(isBlock);
}

function isBlock(section: Element): boolean {
  return isMokaApplicationPage(section.ownerDocument.location) && section.matches(blockSelector) && Boolean(blockTitle(section)) && direct(section, recordSelector).length > 0 && !section.parentElement?.closest(blockSelector);
}

function addAction(element: Element, section: Element): boolean {
  const title = header(section);
  return isBlock(section) && Boolean(title?.contains(element)) && element.matches('button') && clean(element.textContent) === '添加';
}

function selectState(select: Element | null): 'empty' | 'nonempty' | 'unknown' {
  if (!select) return 'unknown';
  const displays = direct(select, prefix('sd-Input-display-value-'));
  const inputs = direct(select, 'input');
  if (displays.length !== 1 || inputs.length !== 1) return 'unknown';
  if (clean(displays[0].textContent)) return 'nonempty';
  return (inputs[0] as HTMLInputElement).value ? 'unknown' : 'empty';
}

function rangePart(range: Element, element: Element): number | undefined {
  // Moka clears placeholders after selection. The two observed direct spans
  // each own two item containers in year/month order, independent of values.
  const spans = Array.from(range.children).filter(child => child.tagName === 'SPAN' && direct(child, prefix('item-')).length === 2);
  if (spans.length !== 2) return undefined;
  const parts = spans.flatMap(span => direct(span, prefix('item-')).map(item => {
    const selects = item.querySelectorAll(selectSelector);
    return selects.length === 1 && direct(selects[0], 'input').length === 1 ? direct(selects[0], 'input')[0] : undefined;
  }));
  if (parts.some((input, index) => !input || input.getAttribute('placeholder') && input.getAttribute('placeholder') !== (index % 2 ? '月' : '年'))) return undefined;
  const index = parts.indexOf(element);
  return index < 0 ? undefined : index;
}

/** Observed Moka structure only. Source semantics and all DOM actions stay elsewhere. */
export function createMokaPageAdapter(): SiteAdapter {
  return {
    reuseStructureWithinTask: true,
    incrementalSections: true,
    // Only explicitly returned outside-block checkboxes reach the fallback body.
    // records([]) below prevents generic year/month repetition heuristics there.
    includeUnscopedFields: true,
    sections(document) { return blocks(document); },
    records(section) { return isBlock(section) ? direct(section, recordSelector) : []; },
    describeSection(section) { return isBlock(section) ? { label: blockTitle(section), mode: 'inline' } : {}; },
    fields(section) {
      if (!isMokaApplicationPage(section.ownerDocument.location)) return [];
      if (!isBlock(section)) {
        return section === section.ownerDocument.body && blocks(section.ownerDocument).length > 0
          ? Array.from(section.querySelectorAll('input[type="checkbox"]')).filter(element => !element.closest(blockSelector))
          : [];
      }
      return direct(section, recordSelector).flatMap(record => direct(record, fieldSelector).flatMap(item => {
        const controls = direct(item, controlSelector);
        // Custom-entry editors live in the select's temporary dropdown. They
        // belong to the control driver, never to the application field registry.
        return controls.length === 1 ? Array.from(controls[0].querySelectorAll(nativeFields)).filter(element => !element.closest(prefix('sd-Dropdown-dropdown-'))) : [];
      }));
    },
    describeField(element): ReturnType<NonNullable<SiteAdapter['describeField']>> {
      if (!isMokaApplicationPage(element.ownerDocument.location)) return { skip: true };
      const item = element.closest(fieldSelector);
      if (!item) {
        if (element.matches('input[type="checkbox"]') && element.ownerDocument.querySelector(blockSelector)) {
          const label = element.closest('label');
          const descriptions = label?.parentElement ? direct(label.parentElement, prefix('desc-')) : [];
          const caption = staticText(label) || (descriptions.length === 1 ? staticText(descriptions[0]) : '');
          return { label: caption, kind: 'unknown', currentState: (element as HTMLInputElement).checked ? 'nonempty' : 'empty', hints: { component: 'moka-consent', blockedReason: 'requires-user-consent' } };
        }
        return { skip: true };
      }
      const titles = direct(item, titleSelector);
      const caption = titles.length === 1 ? staticText(titles[0]) : '';
      const required = titles.length === 1 && Boolean(titles[0].querySelector(prefix('required-asterisk-')));
      const checkboxLabel = element.matches('input[type="checkbox"]') ? staticText(element.closest('label')) : '';
      if (checkboxLabel === '同步更新在线简历') return { label: checkboxLabel, kind: 'unknown', required: false, currentState: (element as HTMLInputElement).checked ? 'nonempty' : 'empty', hints: { component: 'moka-consent', blockedReason: 'requires-user-consent' } };
      if (!caption) return { kind: 'unknown', hints: { component: 'moka-unverified' } };
      const base = { label: caption, required, hints: { component: 'moka-text' } };
      const range = element.closest('.month-range-select');
      if (range) {
        if (element.matches('input[type="checkbox"]')) return { label: staticText(element.closest('label')), kind: 'checkbox', required: false, hints: { component: 'moka-current-checkbox' } };
        const part = rangePart(range, element);
        if (part === undefined) return { ...base, kind: 'unknown', hints: { component: 'moka-date-unverified' } };
        const unit = part % 2 === 0 ? '年' : '月';
        const edge = part < 2 ? 'start' : 'end';
        const select = element.closest<HTMLElement>(selectSelector);
        return { ...base, ...(select ? { element: select } : {}), label: `${caption}${part < 2 ? '开始' : '结束'}${unit}`, kind: 'combobox', currentState: selectState(select), groupElement: range, partRole: `${edge}-${unit === '年' ? 'year' : 'month'}`, hints: { component: 'moka-date-part', driver: 'moka-date-part-v1', popupOwnership: 'requires-site-adapter', ...(unit === '年' ? { linkedDefaultPart: `${edge}-month`, linkedDefaultValue: '1' } : {}) } };
      }
      if (element.matches('input[type="checkbox"]')) {
        const label = staticText(element.closest('label')) || caption;
        return { ...base, label, kind: 'checkbox', hints: { component: 'moka-checkbox' } };
      }
      if (element.matches('input[type="file"]')) return { ...base, kind: 'unknown', hints: { component: 'moka-file-unverified' } };
      if (element.closest(prefix('code-')) && element.closest(selectSelector) && caption === '手机号码') {
        return { ...base, element: element.closest<HTMLElement>(selectSelector)!, label: '手机区号', kind: 'combobox', currentState: selectState(element.closest(selectSelector)), hints: { component: 'moka-country-code', popupOwnership: 'requires-site-adapter' } };
      }
      if (Array.from(item.classList).some(value => value.startsWith('day_info-')) || element.closest('label.day_info')) {
        const date = element.closest<HTMLElement>('label.day_info');
        const inputs = date ? direct(date, 'input') : [];
        const datePrecision = caption === '出生日期 (年龄)' ? 'month' : caption === '毕业时间' ? 'day' : undefined;
        if (date && inputs.length === 1 && inputs[0] === element && element.matches('input[type="text"][readonly]') && datePrecision) {
          return { ...base, element: date, kind: 'date', hints: { component: 'moka-date', driver: 'moka-date-v1', datePrecision, popupOwnership: 'requires-site-adapter' } };
        }
        return { ...base, kind: 'unknown', hints: { component: 'moka-date-unverified' } };
      }
      const select = element.closest<HTMLElement>(selectSelector);
      if (select) return { ...base, element: select, kind: 'combobox', currentState: selectState(select), hints: { component: 'moka-select', popupOwnership: 'requires-site-adapter' } };
      return { ...base, kind: element.tagName === 'TEXTAREA' ? 'textarea' : element.tagName === 'SELECT' ? 'select' : 'text' };
    },
    actions(section) { return isBlock(section) ? Array.from(header(section)?.querySelectorAll('button') ?? []).filter(element => addAction(element, section)) : []; },
    allowAction(element, section) { return addAction(element, section); },
    describeAction(element) {
      const section = element.closest(blockSelector);
      return section && addAction(element, section) ? { kind: 'add-record', label: '添加' } : undefined;
    },
  };
}
