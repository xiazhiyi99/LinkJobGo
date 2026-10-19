import type { RecordType, SourceKey, SemanticBinding, FieldSnapshot, FieldCatalog } from '@job-assistant/autofill-contracts';
import type { SiteParser } from '../registry.js';
import { resolveResumeOption } from '../options.js';
import { deriveAlibabaValue, isAlibabaPaper, paperVenues } from './derivations.js';
const clean = (value: string) => value.trim().replace(/[\s＊*：:]+$/u, '').replace(/\s+/g, '');
const recordTypes: Record<string, RecordType> = { '教育经历': 'education', '语言能力': 'language', '论文发表信息': 'publication' };
const workLabels = ['工作经历', '实习/项目经历'];
const profile: Record<string, string> = { '姓名': 'name', '手机': 'phone', '邮箱': 'email', '家庭所在城市': 'homeCity', '学校所在城市': 'schoolCity', '学校城市': 'schoolCity', '国籍': 'citizenship', '国家': 'citizenship', '国家/地区': 'citizenship' };
const records: Partial<Record<RecordType, Record<string, string>>> = {
  education: { '学校全称': 'school', '专业': 'major', '学历': 'degree', '起始日期': 'startDate', '结束日期': 'endDate', 'GPA成绩': 'gpa' },
  experience: { '公司或组织名称': 'company', '职位或职责': 'title', '工作描述': 'description', '起始日期': 'startDate', '结束日期': 'endDate', '至今': 'current' },
  project: { '职位或职责': 'role', '工作描述': 'description', '起始日期': 'startDate', '结束日期': 'endDate' },
  language: { '语言能力': 'name', '语言等级': 'level' },
};
function bind(field: FieldSnapshot, sectionLabel: string, recordType: RecordType | undefined, catalog: FieldCatalog): SemanticBinding {
  const label = clean(field.label);
  const hints = [field.hints.name, field.hints.id].filter((value): value is string => typeof value === 'string');
  const suffix = (name: string) => hints.some(value => value === name || value.endsWith(`.${name}`));
  let sourceKey: SourceKey | null = null;
  let derivation: SemanticBinding['derivation'];
  let reason = 'Not covered by this site parser';
  if ((sectionLabel === '奖励与荣誉' || sectionLabel === '其他信息') && suffix('reward') && field.kind === 'textarea') derivation = 'alibaba-awards-summary';
  else if (recordType === 'publication') {
    if (suffix('paper')) { sourceKey = { scope: 'record', recordType, path: ['fields', 'description'] }; derivation = 'alibaba-paper-venue'; }
    else if (suffix('isMainAuthor') && label === '是否第一、二或通讯作者') { sourceKey = { scope: 'record', recordType, path: ['fields', 'role'] }; derivation = 'alibaba-paper-author'; }
    else if (suffix('level')) reason = 'Paper level is computed by the site, not supplied by the resume';
  } else {
    const languageField = recordType === 'language' ? suffix('languageRank') ? 'level' : suffix('language') ? 'name' : undefined : undefined;
    const recordField = recordType && (records[recordType]?.[label] ?? languageField);
    if (recordType === 'project' && label === '公司或组织名称') sourceKey = { scope: 'record', recordType, path: ['extra', 'organization'] };
    else if (recordType && recordField) sourceKey = { scope: 'record', recordType, path: ['fields', recordField] };
    else if (sectionLabel === '基本信息' && profile[label]) sourceKey = { scope: 'profile', path: [profile[label]!] };
    else if (sectionLabel === '其他信息' && label === '自我评价或其他补充信息' && suffix('otherInformation')) sourceKey = { scope: 'profile', path: ['selfIntroduction'] };
  }
  const allowed = derivation === 'alibaba-awards-summary' || sourceKey !== null && catalog.some(candidate => JSON.stringify(candidate.sourceKey) === JSON.stringify(sourceKey));
  return { templateFieldId: field.fieldId, sourceKey: allowed ? sourceKey : null, ...(allowed && derivation ? { derivation } : {}), status: allowed ? 'resolved' : 'unresolved', resolvedBy: allowed ? 'site' : null, ...(!allowed ? { reason } : {}) };
}
const resumePath = /^\/personal\/resume\/?$/;
export const alibabaParser: SiteParser = {
  id: 'alibaba-campus-resume', name: '阿里巴巴校园招聘', version: '2.0.1', origins: ['https://campus-talent.alibaba.com'], routes: [{ path: resumePath }],
  deriveValue: deriveAlibabaValue,
  includeRecord: ({ record }) => isAlibabaPaper(record),
  resolveOption(input) {
    if (input.sourceKey.scope === 'record' && input.sourceKey.recordType === 'education' && input.sourceKey.path.join('.') === 'fields.degree' && input.sourceValue === '学士') {
      const matches = input.candidates.filter(option => !option.disabled && ['学士', '本科', '大学本科'].includes(option.label.trim()));
      return matches.length === 1 ? matches[0]!.optionId : null;
    }
    if (input.sourceKey.scope === 'record' && input.sourceKey.recordType === 'publication') {
      const expected = input.sourceKey.path.join('.') === 'fields.role' && typeof input.sourceValue === 'string'
        ? ({ '第一作者': '一作/共一', '第二作者': '二作', '通讯作者': '通讯作者' } as Record<string, string>)[input.sourceValue]
        : input.sourceKey.path.join('.') === 'fields.description' ? paperVenues.find(venue => venue.code === input.sourceValue)?.label : undefined;
      if (expected) {
        const matches = input.candidates.filter(option => !option.disabled && option.label.trim() === expected);
        return matches.length === 1 ? matches[0]!.optionId : null;
      }
      // Do not collapse a categorical author role into a guessed yes/no answer.
      if (input.sourceKey.path.join('.') === 'fields.role') return null;
    }
    return resolveResumeOption(input);
  },
  matches(page, snapshot) { return page.origin === 'https://campus-talent.alibaba.com' && resumePath.test(page.path) && snapshot.sections.some(section => ['基本信息', '其他信息', '奖励与荣誉', ...workLabels, ...Object.keys(recordTypes)].includes(clean(section.label))); },
  parse({ snapshot, catalog }) {
    return { sections: snapshot.sections.filter(section => section.records.length).map(section => {
      const sectionLabel = clean(section.label), recordType = recordTypes[sectionLabel], template = section.records[0]!;
      if (workLabels.includes(sectionLabel)) return {
        sectionId: section.sectionId, template, bindings: [],
        recordVariants: (['experience', 'project'] as const).map(type => ({ recordType: type, bindings: template.fields.map(field => bind(field, sectionLabel, type, catalog)) })),
      };
      return { sectionId: section.sectionId, ...(recordType ? { recordType } : {}), ...(recordType === 'publication' ? { recordFilter: 'alibaba-papers' as const } : {}), template, bindings: template.fields.map(field => bind(field, sectionLabel, recordType, catalog)) };
    }), warnings: [] };
  },
};
