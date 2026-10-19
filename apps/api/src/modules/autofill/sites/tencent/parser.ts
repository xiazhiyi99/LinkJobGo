import type { RecordType, SourceKey } from '@job-assistant/autofill-contracts';
import type { SiteParser } from '../registry.js';
import { resolveResumeOption } from '../options.js';
import type { OptionSnapshot, Value } from '@job-assistant/autofill-contracts';
const clean = (value: string) => value.trim().replace(/[\s＊*：:]+$/u, '').replace(/\s+/g, '');
const recordTypes: Record<string, RecordType> = { '教育经历': 'education', '工作经验': 'experience', '工作经历': 'experience', '作品链接': 'project' };
const profile: Record<string, string> = { '姓名': 'name', '当前居住省/市': 'city', '手机号码': 'phone', '手机号': 'phone', '电子邮箱': 'email', '性别': 'gender' };
const preferences: Record<string, string> = { '期望工作城市': 'targetCities', '是否接受工作地分配': 'relocation' };
const records: Partial<Record<RecordType, Record<string, string>>> = {
  project: { '作品名称': 'name', '作品链接': 'url' },
  education: { '学校': 'school', '专业': 'major', '学历': 'degree', '开始时间': 'startDate', '结束时间': 'endDate' },
  experience: { '工作职位': 'title', '公司名称': 'company', '工作描述': 'description', '开始时间': 'startDate', '结束时间': 'endDate', '我当前在这里工作': 'current' },
};
function resolveTencentOption(input: { sourceKey: SourceKey; sourceValue: Value; candidates: OptionSnapshot[] }): string | string[] | null {
  // Tencent's education level menu represents a bachelor's degree as 本科.
  // This conversion belongs to this record field, not to global degree/level
  // equivalence or the profile's highestEducation field.
  if (input.sourceKey.scope === 'record' && input.sourceKey.recordType === 'education' && input.sourceKey.path.join('.') === 'fields.degree' && input.sourceValue === '学士') {
    const exact = input.candidates.filter(candidate => !candidate.disabled && candidate.label.trim() === '学士');
    if (exact.length) return exact.length === 1 ? exact[0].optionId : null;
    const bachelor = input.candidates.filter(candidate => !candidate.disabled && candidate.label.trim() === '本科');
    return bachelor.length === 1 ? bachelor[0].optionId : null;
  }
  if (input.sourceKey.scope === 'preferences' && input.sourceKey.path.length === 1 && input.sourceKey.path[0] === 'targetCities') {
    if (typeof input.sourceValue !== 'string') return null;
    const cities = input.sourceValue.split(/[、，,；;]/u).map(city => city.trim()).filter(Boolean);
    if (!cities.length) return null;
    const chosen: string[] = [];
    for (const city of cities) {
      const normalized = (label: string) => label.trim() === city || label.trim() === city.replace(/市$/u, '') || label.trim().replace(/市$/u, '') === city.replace(/市$/u, '');
      const matches = input.candidates.filter(candidate => !candidate.disabled && normalized(candidate.label));
      if (matches.length !== 1 || chosen.includes(matches[0].optionId)) return null;
      chosen.push(matches[0].optionId);
    }
    return chosen;
  }
  return resolveResumeOption(input);
}
const resumePath = '/resume.html';
export const tencentParser: SiteParser = {
  id: 'tencent-resume', name: '腾讯招聘', version: '1.3.0', origins: ['https://careers.tencent.com'], routes: [{ path: resumePath }], resolveOption: resolveTencentOption,
  matches(page, snapshot) { return page.origin === 'https://careers.tencent.com' && page.path === resumePath && snapshot.sections.some(section => ['基本信息','工作意向','求职意向','补充信息','个人主页链接',...Object.keys(recordTypes)].includes(clean(section.label))); },
  parse({ snapshot, catalog }) {
    return { sections: snapshot.sections.filter(section => section.records.length).map(section => {
      const sectionLabel = clean(section.label); const recordType = recordTypes[sectionLabel]; const template = section.records[0];
      return { sectionId: section.sectionId, ...(recordType ? { recordType } : {}), template, bindings: template.fields.map(field => {
        const label = clean(field.label); let sourceKey: SourceKey | null = null;
        const recordField = recordType && records[recordType]?.[label];
        if (recordType && recordField) sourceKey = { scope: 'record', recordType, path: ['fields',recordField] };
        else if (sectionLabel === '基本信息' && profile[label]) sourceKey = { scope: 'profile', path: [profile[label]] };
        else if (['工作意向','求职意向'].includes(sectionLabel) && preferences[label]) sourceKey = { scope: 'preferences', path: [preferences[label]] };
        else if (sectionLabel === '补充信息' && label === '自我评价或其他补充信息') sourceKey = { scope: 'profile', path: ['selfIntroduction'] };
        else if (sectionLabel === '个人主页链接' && label === '个人主页链接') sourceKey = { scope: 'profile', path: ['personalWebsite'] };
        const unsupported = sectionLabel === '基本信息' && ['当前居住国家/地区','当前国家/地区','国家/地区'].includes(label) || ['工作意向','求职意向'].includes(sectionLabel) && label === '期望工作国家/地区';
        const allowed = sourceKey !== null && catalog.some(candidate => JSON.stringify(candidate.sourceKey) === JSON.stringify(sourceKey));
        return { templateFieldId: field.fieldId, sourceKey: allowed ? sourceKey : null, status: allowed ? 'resolved' as const : unsupported ? 'unsupported' as const : 'unresolved' as const, resolvedBy: allowed ? 'site' as const : null, ...(!allowed ? { reason: unsupported ? 'The resume API has no residence or target-work country field' : 'Not covered by this site parser' } : {}) };
      }) };
    }), warnings: [] };
  },
};
