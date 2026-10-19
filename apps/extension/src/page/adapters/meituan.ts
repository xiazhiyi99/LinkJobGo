import type { SiteAdapter } from '../index.js';

const sectionLabels: Record<string, string> = {
  base_info_edit: '基本信息', edu_experience_edit: '教育经历', language_standard_edit: '语言能力',
  work_experience_edit: '工作经历', project_experience_edit: '项目经历', campus_experience_edit: '校园经历',
  honor_edit: '荣誉', certificate_edit: '证书', paper_edit: '论文', competition_edit: '竞赛经历',
};
const probedSections = ['edu_experience_edit','work_experience_edit','project_experience_edit','language_standard_edit','campus_experience_edit','honor_edit','certificate_edit','paper_edit'];
/** Only Meituan's documented DOM structure; no résumé mapping, writes, or option-value extraction. */
export function createMeituanPageAdapter(): SiteAdapter {
  const selectors = Object.keys(sectionLabels).map(name => `.${name}`).join(',');
  return {
    reuseStructureWithinTask: true,
    incrementalSections: true,
    isTransientMutation(mutation) {
      const portals = '.mtd-select-popup,.mtd-datepicker-pop';
      const safe = (element: Element) => !element.matches('style,link,script,iframe,form') && !element.querySelector('style,link,script,iframe,form') && !element.shadowRoot && !Array.from(element.querySelectorAll('*')).some(node => node.shadowRoot);
      const target = mutation.target.nodeType === 1 ? mutation.target as Element : mutation.target.parentElement;
      const popup = target?.closest(portals);
      if (popup) return safe(popup) && [...mutation.addedNodes, ...mutation.removedNodes].every(node => node.nodeType !== 1 || safe(node as Element));
      const changed = [...mutation.addedNodes, ...mutation.removedNodes];
      return mutation.type === 'childList' && Boolean(target?.matches('body')) && changed.length > 0 && changed.every(node => node.nodeType === 1 && (node as Element).matches(portals) && safe(node as Element));
    },
    includeUnscopedFields: false,
    sections(document) { return Array.from(document.querySelectorAll(selectors)); },
    records(section) { return probedSections.some(name => section.classList.contains(name)) ? Array.from(section.querySelectorAll('.model_list')).filter(row => row.querySelectorAll(':scope > .mtd-form').length === 1) : Array.from(section.querySelectorAll('.model_list > .mtd-form,.base_info_form')); },
    canProbeAddition(section) { return probedSections.some(name => section.classList.contains(name)) && Boolean(section.querySelector('.list_add')); },
    rollbackAddedRecord(record) { if (!record.matches('.model_list') || !record.closest(probedSections.map(name => `.${name}`).join(',')) || record.querySelectorAll(':scope > .mtd-form').length !== 1) return undefined; const target = record.querySelector<HTMLElement>(':scope > .delete-list > div'); const label = record.closest('.language_standard_edit,.honor_edit,.certificate_edit,.paper_edit') ? '删除这段信息' : '删除这段经历'; return target?.textContent?.trim() === label ? target : undefined; },
    describeSection(section) { return { label: sectionLabels[Array.from(section.classList).find(name => name in sectionLabels) ?? ''], mode: 'inline' }; },
    describeField(element): ReturnType<NonNullable<SiteAdapter['describeField']>> {
      const item = element.closest('.mtd-form-item');
      if (!item) return {};
      const cleanLabel = (node: Element | null) => node?.textContent?.replace(/[\s＊*：:]+$/u, '').trim();
      const candidates = [item.querySelector(':scope > .mtd-form-item-body > .label'), item.querySelector(':scope > .mtd-form-item-label .mtd-form-item-label-ctx'), item.querySelector(':scope > .mtd-form-item-label')];
      const labelElement = candidates.find(node => Boolean(cleanLabel(node)));
      const label = cleanLabel(labelElement ?? null);
      const select = element.closest<HTMLElement>('.mtd-select');
      const date = element.closest<HTMLElement>('.mtd-date-picker');
      const required = Boolean(element.hasAttribute('required') || element.getAttribute('aria-required') === 'true' || /[＊*]/u.test(labelElement?.textContent ?? '') || labelElement?.matches('.mtd-form-item-label-required') || labelElement?.querySelector('.mtd-form-item-label-required'));
      // On the verified Meituan phone field this select is the calling-code picker,
      // while the actual number is a separate native input; never treat the picker as phone.
      if (select && ['手机号码','手机号'].includes(label ?? '')) return { skip: true };
      if (select) {
        const selected = Array.from(select.querySelectorAll('.mtd-select-filter-label:not(.mtd-select-filter-hint)')).some(node => Boolean(node.textContent?.trim()));
        return { element: select, label, kind: 'combobox', currentState: selected ? 'nonempty' : 'empty', required, hints: { component: 'meituan-select', disabled: select.classList.contains('mtd-select-disabled'), popupOwnership: 'requires-site-adapter' } };
      }
      if (date) {
        const placeholder = element.getAttribute('placeholder') || '';
        const partRole = /入学|开始|起始/.test(placeholder) ? 'start' : /毕业|结束/.test(placeholder) ? 'end' : undefined;
        return { element: date, label: placeholder || label, kind: 'date', required, partRole, hints: { component: 'meituan-date-picker', placeholder, precision: 'unknown', popupOwnership: 'requires-site-adapter' } };
      }
      return { label, required };
    },
    actions(section) { return Array.from(section.querySelectorAll('.list_add')); },
    describeAction(element) { return element.classList.contains('list_add') ? { kind: 'add-record', label: '添加记录' } : undefined; },
  };
}
