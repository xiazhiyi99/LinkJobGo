import type { SiteAdapter } from '../index.js';
const nativeFields = 'input:not([type="hidden"]):not([type="file"]),textarea,select';
function uiText(element: Element | null): string | undefined {
  if (!element) return undefined;
  const staticSpan = Array.from(element.children).find(child => child.tagName === 'SPAN' && !(child.getAttribute('class') ?? '').trim());
  const text = staticSpan?.textContent?.trim() || Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join('');
  return text?.replace(/[\s＊*：:]+$/u, '').trim() || undefined;
}
/** Tencent résumé structure only; selected values never become field labels. */
export function createTencentPageAdapter(): SiteAdapter {
  return {
    includeUnscopedFields: false,
    sections(document) { return Array.from(document.querySelectorAll('.resume-content > .information,.resume-content .education-message,.resume-content .experience-message,.resume-content > .WorkLink,.resume-content > .HomePageLink')).filter(element => !element.closest('.last-work-experience')); },
    records(section) { return Array.from(section.querySelectorAll(section.matches('.WorkLink,.HomePageLink') ? ':scope > form > .workLinkItem' : '.create-empirical,.create-education')); },
    canProbeAddition(section) { return section.matches('.education-message,.experience-message,.WorkLink') && Boolean(section.querySelector('.add-experience > p.add-text.education,.add-experience > p.add-text.experience')); },
    rollbackAddedRecord(record) { const selector = record.matches('.workLinkItem') && record.parentElement?.parentElement?.matches('.WorkLink') ? '.remove-experience' : record.matches('.create-education') ? '.remove-education' : record.matches('.create-empirical') ? '.remove-experience' : undefined; return selector ? record.querySelector<HTMLElement>(`:scope > .remove-module > .remove-btn${selector}`) ?? undefined : undefined; },
    describeSection(section) {
      if (section.matches('.WorkLink')) return { label: '作品链接' };
      if (section.matches('.HomePageLink')) return { label: '个人主页链接' };
      if (section.classList.contains('information')) {
        const title = uiText(section.querySelector(':scope > .title'));
        return { label: title === '工作意向' || title === '求职意向' ? title : '基本信息' };
      }
      if (section.classList.contains('education-message')) return { label: '教育经历' };
      const title = uiText(section.querySelector(':scope > .title'));
      return { label: title === '补充信息' ? title : '工作经验' };
    },
    fields(section) { return Array.from(section.querySelectorAll(`${nativeFields},.el-radio[role="radio"],.education-select > .select,.test-border,.currently-checkbox > p.checkbox-text`)).filter(element => !element.closest('.telephone-select,.telephone-region,[role="listbox"],.el-select-dropdown,.small-select-ul,.splicing-select-ul')); },
    describeField(element): ReturnType<NonNullable<SiteAdapter['describeField']>> {
      if (element.matches('input.el-input__inner') && element.closest('.WorkLink,.HomePageLink')) {
        const item = element.closest('.el-form-item');
        return { label: uiText(item?.querySelector(':scope > label.el-form-item__label') ?? null), kind: 'text', hints: { component: 'tencent-link-text' } };
      }
      const module = element.closest('.resume-module-left,.resume-module-right') ?? element.closest('.resume-module,.work-describe');
      const label = uiText(module?.querySelector(':scope > p.text') ?? null);
      const hint = { component: 'tencent-resume', disabled: element.hasAttribute('disabled') };
      if (element.matches('.currently-checkbox > p.checkbox-text')) return { label: uiText(element), kind: 'checkbox', currentState: element.classList.contains('active') ? 'nonempty' : 'empty', hints: { ...hint, component: 'tencent-current-checkbox', preserveDefaultWhenSourceMissing: true } };
      if (element.classList.contains('test-border')) {
        const years = element.querySelectorAll(':scope > .select-wrapper > .required-year');
        const months = element.querySelectorAll(':scope > .select-wrapper > .required-month');
        const year = years[0]?.textContent?.trim(), month = months[0]?.textContent?.trim();
        const currentState = years.length !== 1 || months.length !== 1 ? 'unknown' : year === '年' && month === '月' ? 'empty' : /^\d{4}$/.test(year ?? '') || /^\d{1,2}$/.test(month ?? '') ? 'nonempty' : 'unknown';
        return { label, kind: 'date', currentState, hints: { ...hint, component: 'tencent-split-date', precision: 'month' } };
      }
      if (element.getAttribute('type') === 'radio' || element.matches('.el-radio[role="radio"]')) {
        const group = element.closest('.el-radio-group');
        const exposed = group ? Array.from(group.querySelectorAll<HTMLElement>('.el-radio[role="radio"]')) : [];
        const radios = exposed.length ? exposed : group ? Array.from(group.querySelectorAll<HTMLElement>('input[type="radio"]')) : [];
        if (radios.length) return { element: radios[0], elements: radios, label, kind: 'radio', currentState: radios.some(radio => (radio as HTMLInputElement).checked || radio.getAttribute('aria-checked') === 'true') ? 'nonempty' : 'empty', hints: hint };
      }
      if (label === '学校' && element.matches('input#school.input.school-input.required[maxlength="255"]:not([role]):not([readonly])') && element.parentElement?.matches('.school-select') && element.parentElement.parentElement?.matches('.school.resume-module') && element.parentElement.querySelectorAll(':scope > ul.input-select-ul').length === 1) return { label, kind: 'text', hints: { ...hint, component: 'tencent-school-text' } };
      const select = element.closest<HTMLElement>('.el-select,.country-select,.school-select,.education-select');
      if (select) {
        const degreeTrigger = select.matches('.education-select') ? select.querySelector(':scope > .select.education-required') : null;
        const currentState = degreeTrigger?.textContent?.trim() === '选择学历' ? 'empty' : 'unknown';
        return { element: select, label, kind: 'combobox', currentState, hints: { ...hint, component: 'tencent-select', popupOwnership: 'requires-site-adapter' } };
      }
      return { label, hints: hint };
    },
    actions(section) { return Array.from(section.querySelectorAll('.add-experience > p.add-text.experience,.add-experience > p.add-text.education')).filter(element => !element.closest('.last-work-experience')); },
    describeAction(element) { return element.matches('p.add-text.experience,p.add-text.education') && element.parentElement?.classList.contains('add-experience') ? { kind: 'add-record', label: '添加记录' } : undefined; },
  };
}
