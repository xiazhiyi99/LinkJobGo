import { sourceKeyId } from '@job-assistant/autofill-contracts';
import type { FieldSnapshot, RecordType, ResumeRecord, SectionSnapshot, SemanticBinding, SourceKey } from '@job-assistant/autofill-contracts';
import type { SiteParser } from '../registry.js';

const clean = (value: string) => value.replace(/[＊*]/g, '').replace(/\s+/g, '').replace(/[：:]$/, '');
const profile = (name: string): SourceKey => ({ scope: 'profile', path: [name] });
const record = (type: RecordType, name: string, extra = false): SourceKey => ({ scope: 'record', recordType: type, path: [extra ? 'extra' : 'fields', name] });
const textField = (field: FieldSnapshot) => ['text', 'textarea', 'contenteditable', 'date'].includes(field.kind) && !['file', 'hidden', 'password'].includes(String(field.hints.inputType));
const choice = (field: FieldSnapshot) => ['select', 'combobox', 'radio'].includes(field.kind);
const sections: Record<string, { type: RecordType; anchors: string[]; fields: Record<string, string>; extra?: Record<string, string> }> = {
  教育经历: { type: 'education', anchors: ['学校名称', '学历', '专业'], fields: { 学校名称: 'school', 学历: 'degree', 专业: 'major' }, extra: { 学历类型: 'fullTime', 学院: 'college', 实验室: 'laboratory', 领域方向: 'researchDirection', 导师: 'advisor' } },
  实习经历: { type: 'experience', anchors: ['公司名称', '职位名称', '描述'], fields: { 公司名称: 'company', 职位名称: 'title', 描述: 'description' } },
  工作经历: { type: 'experience', anchors: ['公司名称', '职位名称', '描述'], fields: { 公司名称: 'company', 职位名称: 'title', 描述: 'description' } },
  项目经历: { type: 'project', anchors: ['项目名称', '项目角色', '描述'], fields: { 项目名称: 'name', 项目角色: 'role', 项目链接: 'url', 描述: 'description' } },
  语言能力: { type: 'language', anchors: ['语言', '精通程度'], fields: { 语言: 'name', 精通程度: 'level' } },
};
const sameShape = (section: SectionSnapshot, anchors: string[]) => section.mode === 'inline' && section.records.length > 0 && section.records.every(row => anchors.every(label => row.fields.filter(field => clean(field.label) === label).length === 1));
function employment(record: ResumeRecord): 'internship' | 'employment' | undefined {
  const type = record.extra?.employmentType;
  if (typeof type === 'string' && type.trim()) {
    if (['实习', '实习生', 'intern', 'internship'].includes(type.trim().toLowerCase())) return 'internship';
    if (['正式', '全职', '兼职', 'full-time', 'fulltime', 'part-time', 'parttime'].includes(type.trim().toLowerCase())) return 'employment';
    return;
  }
  return record.extra?.profileSection === '实习经历' ? 'internship' : record.extra?.profileSection === '工作经历' ? 'employment' : undefined;
}
const degreeAliases: Record<string, string> = { 大学本科: '本科', 学士: '本科', 硕士研究生: '硕士', 博士研究生: '博士', 大学专科: '大专', 专科: '大专' };
const fullTimeAliases: Record<string, string> = { 是: '统招全日制', 全日制: '统招全日制', 统招全日制: '统招全日制', 否: '非全日制', 非全日制: '非全日制' };

/** Observed campus résumé fields. All sources, aliases and record selection live here. */
export const bytedanceParser: SiteParser = {
  id: 'bytedance', version: '1.0.0', origins: ['https://jobs.bytedance.com'],
  matches(page) { return /^\/campus\/resume\/\d+\/apply\/?$/.test(page.path); },
  includeRecord({ filter, record }) {
    return record.recordType === 'experience' && (filter === 'internships' ? employment(record) === 'internship' : filter === 'employment' && employment(record) === 'employment');
  },
  parse({ snapshot, catalog }) {
    const available = new Set(catalog.map(field => sourceKeyId(field.sourceKey)));
    return { sections: snapshot.sections.filter(section => section.records.length).map(section => {
      const label = clean(section.label), rule = sections[label];
      const type = rule && sameShape(section, rule.anchors) ? rule.type : undefined;
      const template = section.records[0]!;
      return { sectionId: section.sectionId, ...(type ? { recordType: type } : {}), ...(type === 'experience' ? { recordFilter: label === '实习经历' ? 'internships' as const : 'employment' as const } : {}), template, bindings: template.fields.map((field): SemanticBinding => {
        const name = clean(field.label);
        let sourceKey: SourceKey | null = null;
        // The telephone prefix shares its caption with the actual text input.
        const peers = template.fields.filter(candidate => clean(candidate.label) === name && (textField(candidate) === textField(field)));
        if (field.hints.disabled !== true && peers.length === 1 && !['checkbox', 'unknown'].includes(field.kind)) {
          if (type && rule) {
            const standard = rule.fields[name], extra = rule.extra?.[name];
            if (standard && (['degree', 'level'].includes(standard) || type === 'language' ? choice(field) : textField(field))) sourceKey = record(type, standard);
            else if (extra && (extra === 'fullTime' ? choice(field) : textField(field))) sourceKey = record(type, extra, true);
            else if (['education', 'experience', 'project'].includes(type) && textField(field) && /^起止时间[（(](开始|结束)[）)]$/.test(name)) sourceKey = record(type, name.includes('开始') ? 'startDate' : 'endDate');
          } else if (label === '基本信息' && section.records.length === 1 && textField(field)) {
            const key = ({ 姓名: 'name', 手机号码: 'phone', 邮箱: 'email' } as Record<string, string>)[name];
            if (key) sourceKey = profile(key);
          } else if (label === '自我评价' && section.records.length === 1 && textField(field) && name === '自我评价') sourceKey = profile('selfIntroduction');
        }
        return sourceKey && available.has(sourceKeyId(sourceKey))
          ? { templateFieldId: field.fieldId, sourceKey, status: 'resolved', resolvedBy: 'site' }
          : { templateFieldId: field.fieldId, sourceKey: null, status: 'unsupported', resolvedBy: null, reason: 'No verified ByteDance rule for this section, field or control. No AI fallback.' };
      }) };
    }), warnings: [] };
  },
  resolveOption({ sourceKey, sourceValue, candidates }) {
    if (typeof sourceValue !== 'string') return null;
    let expected = sourceValue.trim();
    const degree = sourceKeyId(sourceKey) === sourceKeyId(record('education', 'degree'));
    const fullTime = sourceKeyId(sourceKey) === sourceKeyId(record('education', 'fullTime', true));
    const normalize = (value: string) => degree ? degreeAliases[value] ?? value : fullTime ? fullTimeAliases[value] ?? value : value;
    expected = normalize(expected);
    const matches = candidates.filter(option => !option.disabled && normalize(option.label.trim()) === expected);
    return matches.length === 1 ? matches[0]!.optionId : null;
  },
};
