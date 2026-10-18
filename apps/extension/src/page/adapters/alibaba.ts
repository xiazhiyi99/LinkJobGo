import type { SiteAdapter } from '../index.js';
const names: Record<string, string> = { personalInfo: '基本信息', educationInfo: '教育经历', experienceInfo: '实习/项目经历', otherInfo: '其他信息' };
const nativeFields = 'input:not([type="hidden"]):not([type="file"]),textarea,select,[contenteditable="true"]';
const actionText = (element: Element) => element.textContent?.replace(/[\s\uE000-\uF8FF]/g, '');
const isAddition = (element: Element) => ['添加教育情况','添加更多项目经历','添加语言能力','添加论文发表信息'].includes(actionText(element) ?? '');
type HasField = (row: Element, suffix: string) => boolean;
// A lookup lives only for one synchronous adapter call. Every later call reads
// the current DOM again, including edits that keep the same row element.
function createFieldLookup(): HasField {
  const rows = new Map<Element, Set<string>>();
  return (row, suffix) => {
    let fields = rows.get(row);
    if (!fields) {
      fields = new Set();
      for (const element of row.querySelectorAll('[id]')) if (/^tfitem_\d+\./.test(element.id) && element.closest('.table-field-tiled-item') === row) fields.add(element.id.slice(element.id.lastIndexOf('.') + 1));
      rows.set(row, fields);
    }
    return fields.has(suffix);
  };
}
function nestedKind(section: Element, hasField = createFieldLookup()): 'language' | 'paper' | undefined {
  if (!section.matches('.next-form-item.deep-table-form-field') || !section.closest('#educationInfo')) return undefined;
  const rows = Array.from(section.querySelectorAll('.table-field-tiled-item'));
  const buttons = Array.from(section.querySelectorAll('button'));
  const language = rows.some(row => hasField(row, 'language') && hasField(row, 'languageRank')) || buttons.some(button => actionText(button) === '添加语言能力');
  const paper = rows.some(row => hasField(row, 'paper') && hasField(row, 'level') && hasField(row, 'isMainAuthor')) || buttons.some(button => actionText(button) === '添加论文发表信息');
  return language === paper ? undefined : language ? 'language' : 'paper';
}
function rewardSection(section: Element): boolean { return section.matches('.next-form-item') && !section.classList.contains('deep-table-form-field') && Boolean(section.querySelector(':scope textarea#reward')) && Boolean(section.closest('#experienceInfo')); }
function additionLabel(section: Element): string | undefined {
  if (section.id === 'educationInfo') return '添加教育情况';
  if (section.id === 'experienceInfo') return '添加更多项目经历';
  const kind = nestedKind(section);
  return kind === 'language' ? '添加语言能力' : kind === 'paper' ? '添加论文发表信息' : undefined;
}
function supportedRows(section: Element): Element[] {
  const rows = Array.from(section.querySelectorAll('.table-field-tiled-item')), hasField = createFieldLookup();
  const nested = section.classList.contains('deep-table-form-field'), kind = nested ? nestedKind(section, hasField) : undefined;
  return rows.filter(row => {
    if (nested) return kind === 'language' ? hasField(row, 'language') && hasField(row, 'languageRank') : kind === 'paper' && hasField(row, 'paper') && hasField(row, 'level') && hasField(row, 'isMainAuthor');
    if (section.id === 'educationInfo') return hasField(row, 'school') || hasField(row, 'topDegree');
    if (section.id === 'experienceInfo') return hasField(row, 'name') && hasField(row, 'timeRange') && (hasField(row, 'responsibility') || hasField(row, 'description'));
    return false;
  });
}
/** Alibaba Campus Fusion fields, scoped independently from bottom agreement controls. */
export function createAlibabaPageAdapter(): SiteAdapter {
  return {
    includeUnscopedFields: false,
    includeNestedSections: true,
    sections(document) {
      const sections = Array.from(document.querySelectorAll('#personalInfo,#educationInfo,#experienceInfo,#otherInfo,#educationInfo .next-form-item.deep-table-form-field')).filter(element => !element.classList.contains('deep-table-form-field') || nestedKind(element));
      const reward = document.querySelector('#experienceInfo textarea#reward')?.closest('.next-form-item');
      if (reward && rewardSection(reward)) sections.push(reward);
      return sections;
    },
    records(section) { return rewardSection(section) ? [section] : supportedRows(section); },
    canProbeAddition(section) { const label = additionLabel(section); return Boolean(label && Array.from(section.querySelectorAll('button')).some(button => actionText(button) === label)); },
    rollbackAddedRecord(record) {
      if (!record.matches('.table-field-tiled-item')) return undefined;
      const hasField = createFieldLookup();
      const suffix = record.closest('#educationInfo') && hasField(record, 'school') ? 'school' : record.closest('#educationInfo') && hasField(record, 'language') && hasField(record, 'languageRank') ? 'language' : record.closest('#educationInfo') && hasField(record, 'paper') && hasField(record, 'level') && hasField(record, 'isMainAuthor') ? 'paper' : record.closest('#experienceInfo') && hasField(record, 'name') && hasField(record, 'timeRange') && (hasField(record, 'responsibility') || hasField(record, 'description')) ? 'name' : undefined;
      if (!suffix) return undefined;
      const group = Array.from(record.querySelectorAll<HTMLElement>('[data-group-id]')).find(element => /^tfitem_\d+$/.test(element.dataset.groupId ?? '') && Boolean(record.querySelector(`[id="${element.dataset.groupId}.${suffix}"]`)));
      const deletion = group?.querySelector(`button[type="button"][class*="${suffix === 'name' ? 'ExperienceInfo' : 'EducationInfo'}--deleteBtn--"]`);
      // Public desktop component uses the same scoped icon deletion renderer for paper and language tables.
      const languageIcon = (suffix === 'language' || suffix === 'paper') && !deletion?.textContent?.replace(/[\s\uE000-\uF8FF]/g, '') && deletion?.querySelectorAll('.next-icon-ashbin').length === 1;
      if (!deletion || !languageIcon && deletion.textContent?.replace(/\s+/g, '') !== '删除这段经历') return undefined;
      const menu = deletion.closest('span.item-actions')?.querySelector<HTMLElement>(':scope > button[aria-haspopup="true"]');
      return menu && record.contains(menu) ? menu : undefined;
    },
    fields(section) {
      if (rewardSection(section)) return Array.from(section.querySelectorAll('textarea#reward'));
      const rows = ['educationInfo','experienceInfo'].includes(section.id) || section.classList.contains('deep-table-form-field') ? new Set(supportedRows(section)) : undefined;
      return Array.from(section.querySelectorAll(nativeFields)).filter(element => {
        if (element.closest('.next-select')?.querySelector('input#mobile')) return false;
        if (!rows) return true;
        const row = element.closest('.table-field-tiled-item');
        return Boolean(row && rows.has(row));
      });
    },
    actions(section) { return Array.from(section.querySelectorAll('button')).filter(isAddition); },
    allowAction(element, section) {
      if (section.classList.contains('deep-table-form-field') && section.closest('#educationInfo')) { const label = additionLabel(section); return Boolean(label && actionText(element) === label); }
      if (!['educationInfo','experienceInfo'].includes(section.id)) return false;
      const groups = new Set(supportedRows(section).map(row => row.closest('.next-form-item.deep-table-form-field')).filter(Boolean));
      if (groups.size === 0) { const label = section.id === 'educationInfo' ? '添加教育情况' : '添加更多项目经历'; for (const group of section.querySelectorAll('.next-form-item.deep-table-form-field')) if (Array.from(group.querySelectorAll('button')).some(button => actionText(button) === label)) groups.add(group); }
      return groups.size === 1 && Array.from(groups)[0]!.contains(element);
    },
    describeAction(element) { const text = element.textContent?.replace(/[\s\uE000-\uF8FF]/g, ''); return text === '添加更多项目经历' || text === '添加教育情况' || text === '添加语言能力' || text === '添加论文发表信息' ? { kind: 'add-record', label: text } : undefined; },
    describeSection(section) { const kind = nestedKind(section); return { label: rewardSection(section) ? '奖励与荣誉' : kind === 'paper' ? '论文发表信息' : kind === 'language' ? '语言能力' : names[section.id] }; },
    describeField(element): ReturnType<NonNullable<SiteAdapter['describeField']>> {
      // Fusion displays a 0/3000 counter but does not set native maxlength.
      if (element.matches('textarea#reward') && element.closest('#experienceInfo')) return { label: '奖励与荣誉', kind: 'textarea', hints: { name: 'reward', component: 'alibaba-reward', maxLength: 3000 } };
      if (element.matches('textarea#otherInformation') && element.closest('#otherInfo')) return { label: '自我评价或其他补充信息', kind: 'textarea', hints: { name: 'otherInformation' } };
      const item = element.closest('.next-form-item');
      const rawName = element.getAttribute('name') ?? '';
      const fieldSuffix = /^tfitem_\d+\.([A-Za-z][A-Za-z0-9_]*)$/.exec(rawName)?.[1] ?? /^tfitem_\d+\.([A-Za-z][A-Za-z0-9_]*)$/.exec(element.id)?.[1];
      // Fusion's tfitem counter identifies a current view, not a semantic field.
      // Retain the proved field suffix so another record can match the same structure.
      const fieldHints = { name: fieldSuffix ?? rawName };
      const label = item?.querySelector(':scope > .next-form-item-label')?.textContent?.replace(/[＊*：:]\s*$/g, '').trim();
      const range = element.closest('.next-range-picker');
      if (range) {
        const placeholder = element.getAttribute('placeholder') || '';
        const partRole = /起始|开始/.test(placeholder) ? 'start' : /结束/.test(placeholder) ? 'end' : undefined;
        return { label: placeholder || label, kind: 'date', groupElement: range, partRole, hints: { ...fieldHints, component: 'alibaba-range-date', placeholder, precision: 'unknown', popupOwnership: 'requires-site-adapter' } };
      }
      const select = element.closest<HTMLElement>('.next-select');
      if (select) return { element: select, label, kind: 'combobox', currentState: 'unknown', hints: { ...fieldHints, component: 'alibaba-select', disabled: select.classList.contains('next-disabled'), popupOwnership: 'requires-site-adapter' } };
      return { label, hints: fieldHints };
    },
  };
}
