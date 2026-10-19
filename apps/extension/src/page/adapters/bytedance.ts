import type { SiteAdapter } from '../index.js';

const moduleSelector = '[class*="applyFormModuleWrapper__"]';
const cardSelector = '[class*="apply-form-array-card__"]';
const nativeFields = 'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]),textarea,select';
const caption = (section: Element) => section.querySelector(':scope > .applyFormModuleWrapper-left .applyFormModuleWrapper-text')?.textContent?.trim() ?? '';
const isModule = (section: Element) => section.matches(moduleSelector) && section.parentElement?.matches('form') === true;
const cards = (section: Element) => Array.from(section.querySelectorAll(cardSelector)).filter(card => card.closest(moduleSelector) === section);
const removeButton = (card: Element) => {
  const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button[type="button"]')).filter(button => button.closest(cardSelector) === card && button.querySelector('svg[data-icon="DeleteTrashOutlined"]'));
  return buttons.length === 1 ? buttons[0] : undefined;
};
const list = (section: Element) => section.querySelector('.applyFormModuleWrapper-right > .ud-formily-item[id$="_list"]');
const addButton = (button: Element, section: Element) => button.matches('button[type="button"]') && button.textContent?.trim() === '添加' && Boolean(list(section)?.contains(button));

/** Observed unsaved form structure only; business mappings stay in the backend. */
export function createBytedancePageAdapter(): SiteAdapter {
  return {
    reuseStructureWithinTask: true,
    incrementalSections: true,
    includeUnscopedFields: true,
    sections(document) { return Array.from(document.querySelectorAll(`form > ${moduleSelector}`)).filter(section => caption(section) && (section.querySelector(nativeFields) || Array.from(section.querySelectorAll('button')).some(button => addButton(button, section)))); },
    records(section) { return isModule(section) ? cards(section).length ? cards(section) : list(section) ? [] : [section] : []; },
    describeSection(section) { return isModule(section) ? { label: caption(section), mode: 'inline' } : {}; },
    fields(section) {
      if (isModule(section)) {
        const rows = cards(section);
        return Array.from(section.querySelectorAll(nativeFields)).filter(field => !field.closest('.ud__select__dropdown') && (!rows.length || rows.some(row => row.contains(field))));
      }
      return section === section.ownerDocument.body ? Array.from(section.querySelectorAll('input[type="checkbox"]')).filter(field => !field.closest(cardSelector)) : [];
    },
    describeField(field) {
      const item = field.closest('.ud-formily-item');
      const label = item?.querySelector(':scope > .ud-formily-item-label label')?.textContent?.trim();
      if (!field.closest(moduleSelector)) return { label: field.closest('label')?.textContent?.trim() || '隐私同意', kind: 'unknown', hints: { blockedReason: 'requires-user-consent' } };
      const checkbox = field.matches('input[type="checkbox"]');
      if (checkbox) return { label: field.closest('label')?.textContent?.trim(), kind: 'unknown', hints: { blockedReason: 'requires-user-choice' } };
      const peers = item ? Array.from(item.querySelectorAll(nativeFields)) : [];
      const dateEdge = label && /时间|日期/.test(label) && peers.length === 2 && peers.every(peer => peer.matches('input:not([role])')) ? peers.indexOf(field) : -1;
      // These editable autocomplete inputs retain arbitrary text on blur. Their
      // suggestions are optional; readonly single selects still use the driver.
      const freeText = field.matches('input[role="combobox"][type="search"]:not([readonly])') && field.closest('.ud__select__selector-hide-arrow');
      const selected = field.closest('.ud__select')?.querySelector('.ud__select__selector__selectItem')?.textContent?.trim();
      return { ...(label ? { label: dateEdge >= 0 ? `${label}（${dateEdge === 0 ? '开始' : '结束'}）` : label } : {}), ...(freeText ? { kind: 'text' as const } : {}), ...(field.getAttribute('role') === 'combobox' ? { currentState: selected || (field as HTMLInputElement).value ? 'nonempty' as const : 'empty' as const } : {}), required: Boolean(item?.querySelector(':scope > .ud-formily-item-label .ud-formily-item-asterisk')) };
    },
    actions(section) { return isModule(section) ? Array.from(section.querySelectorAll('button')).filter(button => addButton(button, section) || cards(section).some(card => removeButton(card) === button)) : []; },
    allowAction(button, section) { return isModule(section) && button.closest(moduleSelector) === section; },
    describeAction(button) { const section = button.closest(moduleSelector); if (!section) return; if (addButton(button, section)) return { kind: 'add-record', label: '添加' }; const card = button.closest(cardSelector); if (card && removeButton(card) === button) return { kind: 'remove-record', label: '删除记录' }; },
    canProbeAddition(section) { return isModule(section) && Boolean(list(section)) && Array.from(section.querySelectorAll('button')).some(button => addButton(button, section)); },
    rollbackAddedRecord: removeButton,
    canRemoveRecord(section, record) { return isModule(section) && Boolean(list(section)) && record.closest(moduleSelector) === section && cards(section).includes(record) && Boolean(removeButton(record)); },
  };
}
