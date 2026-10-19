import type { RecordType, SourceKey } from '@job-assistant/autofill-contracts';
import type { SiteParser } from '../registry.js';
import { resolveResumeOption } from '../options.js';

const sectionTypes: Record<string, RecordType> = {
  '教育经历': 'education', '教育背景': 'education', '工作经历': 'experience',
  '实习经历': 'experience', '工作/实习经历': 'experience', '项目经历': 'project', '校园经历': 'campus',
  '语言能力': 'language', '语言水平': 'language', '资格证书': 'certificate', '证书': 'certificate', '获奖经历': 'award', '荣誉': 'award', '论文': 'publication',
};
const profileLabels: Record<string, string> = { '姓名': 'name', '性别': 'gender', '手机号码': 'phone', '手机号': 'phone', '邮箱': 'email', '所在城市': 'city', '当前居住城市': 'city', '最高学历': 'highestEducation', '自我介绍': 'selfIntroduction' };
const recordLabels: Partial<Record<RecordType, Record<string, string>>> = {
  education: { '学校名称': 'school', '学校': 'school', '专业名称': 'major', '专业': 'major', '学历': 'degree', '入学时间': 'startDate', '毕业时间': 'endDate', '在读': 'current' },
  experience: { '公司名称': 'company', '公司': 'company', '职位名称': 'title', '职位': 'title', '开始时间': 'startDate', '在开始时间': 'startDate', '结束时间': 'endDate', '工作内容': 'description', '工作描述': 'description', '在职': 'current', '至今': 'current' },
  campus: { '组织名称': 'company', '校园经历名称': 'company', '职位名称': 'title', '角色': 'title', '开始时间': 'startDate', '结束时间': 'endDate', '经历描述': 'description', '校园经历描述': 'description', '至今': 'current' },
  project: { '项目名称': 'name', '项目角色': 'role', '开始时间': 'startDate', '结束时间': 'endDate', '项目描述': 'description', '项目链接': 'url' },
  language: { '语种': 'name', '语言类型': 'name', '熟练程度': 'level', '语言水平': 'level', '语言考试': 'certificate' },
  certificate: { '证书名称': 'name', '颁发机构': 'issuer', '获得时间': 'obtainedAt' },
  award: { '奖项名称': 'name', '荣誉名称': 'name', '获奖描述': 'description', '荣誉描述': 'description' },
  publication: { '论文名称': 'name', '作者顺序': 'role', '论文链接': 'url' },
};
// Extra fields remain distinct: college is not school, rank is not GPA, and
// full-time education is not the profile's current-student flag.
const extraLabels: Partial<Record<RecordType, Record<string, string>>> = {
  education: { '学院名称': 'college', '学院': 'college', '成绩排名': 'rank', '是否全日制': 'fullTime', '实验室': 'laboratory', '请输入实验室': 'laboratory', '导师': 'advisor', '研究方向': 'researchDirection' },
  experience: { '部门名称': 'department', '工作类型': 'employmentType' },
  language: { '考试分数': 'score' },
};
const noEquivalent: Partial<Record<RecordType, readonly string[]>> = {
  publication: ['发表渠道', '影响因子'],
};
const clean = (value: string) => value.replace(/[\s*：:]/g, '');
export const meituanParser: SiteParser = {
  id: 'meituan-resume', version: '1.4.2', origins: ['https://zhaopin.meituan.com'],
  includeRecord: ({ record }) => record.recordType === 'publication' && typeof record.extra?.publicationType === 'string' && ['论文', '会议论文', '期刊论文', 'paper', 'conference paper', 'journal article'].includes(record.extra.publicationType.trim().toLowerCase()),
  resolveOption(input) {
    if (input.sourceKey.scope === 'record' && input.sourceKey.recordType === 'publication' && input.sourceKey.path.join('.') === 'fields.role') {
      const aliases = [['第一作者', '一作'], ['第二作者', '二作'], ['第三作者', '三作'], ['共同第一作者', '共一']];
      const group = aliases.find(labels => labels.includes(String(input.sourceValue).trim()));
      const matches = input.candidates.filter(option => !option.disabled && group?.includes(option.label.trim()));
      return matches.length === 1 ? matches[0].optionId : null;
    }
    return resolveResumeOption(input);
  },
  matches(page, snapshot) {
    return page.origin === 'https://zhaopin.meituan.com' &&
      ['/web/delivery-confirm', '/web/personal-center/resume-detail'].includes(page.path) &&
      snapshot.sections.some(section => ['基本信息', '基础信息', '个人信息', ...Object.keys(sectionTypes)].includes(clean(section.label)));
  },
  parse({ snapshot, catalog }) {
    return {
      sections: snapshot.sections.filter(section => section.records.length).map(section => {
        const label = clean(section.label);
        const recordType = sectionTypes[label];
        const template = section.records[0];
        return {
          sectionId: section.sectionId, ...(recordType ? { recordType } : {}), ...(recordType === 'publication' ? { recordFilter: 'papers' as const } : {}), template,
          bindings: template.fields.map(field => {
            const unsupported = Boolean(recordType && noEquivalent[recordType]?.includes(clean(field.label)));
            const fieldName = recordType ? recordLabels[recordType]?.[clean(field.label)] :
              ['基本信息', '基础信息', '个人信息'].includes(label) ? profileLabels[clean(field.label)] : undefined;
            // The observed lab select asks for a level (国家级/省部级/校级),
            // while the adjacent text input asks for its name. Never search
            // classification options using the laboratory name.
            const extraName = recordType === 'education' && clean(field.label) === '实验室' && field.kind === 'combobox' ? 'laboratoryLevel' : recordType && extraLabels[recordType]?.[clean(field.label)];
            const sourceKey: SourceKey | null = extraName ? { scope: 'record', recordType: recordType!, path: ['extra', extraName] } : fieldName ? recordType
              ? { scope: 'record', recordType, path: ['fields', fieldName] }
              : { scope: 'profile', path: [fieldName] } : null;
            const allowed = sourceKey && catalog.some(item => JSON.stringify(item.sourceKey) === JSON.stringify(sourceKey));
            return { templateFieldId: field.fieldId, sourceKey: allowed ? sourceKey : null,
              status: allowed ? 'resolved' as const : unsupported ? 'unsupported' as const : 'unresolved' as const,
              resolvedBy: allowed ? 'site' as const : null, ...(!allowed ? { reason: unsupported ? '该字段在当前简历目录中没有等价来源，不能用含义相近的字段代替。' : 'Not covered by this site parser' } : {}) };
          }),
        };
      }), warnings: [],
    };
  },
};
