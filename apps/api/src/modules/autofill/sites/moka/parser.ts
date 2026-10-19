import type { FieldSnapshot, PageSnapshot, SectionSnapshot, SemanticBinding, SourceKey, SourceRef } from '@job-assistant/autofill-contracts';
import { sourceKeyId } from '@job-assistant/autofill-contracts';
import { matchesSiteRoute, type SiteParser } from '../registry.js';

// Company-specific derivations remain below; common controls are shared across
// tenants and job IDs only when their actual scanned structure is compatible.
const observedPages = [
  { path: '/campus_apply/baai/42174', hashRoute: '/job/13706229-ac4f-4d58-9a8a-f0f43a05730a/apply', tenant: 'baai' },
  { path: '/campus_apply/zuoyebang/144908', hashRoute: '/job/6e0a630d-9d1b-4855-b0c2-a916adf971d3/apply', tenant: 'zuoyebang' },
] as const;
const origins = ['https://app.mokahr.com'];
const applicationRoute = { path: /^\/campus_apply\/([A-Za-z0-9_-]+)\/\d+\/?$/, hashRoute: /^\/job\/[A-Za-z0-9_-]+\/apply\/?$/ };
const identifyPage = (page: PageSnapshot['page']) => origins.includes(page.origin) && matchesSiteRoute(applicationRoute, page)
  ? { tenant: applicationRoute.path.exec(page.path)![1]! } : undefined;
const clean = (label: string) => label.replace(/^[*\s]+|[*\s：:]+$/g, '').replace(/\s+/g, ' ');
const profileKey = (name: string): SourceKey => ({ scope: 'profile', path: [name] });
const preferenceKey = (name: string): SourceKey => ({ scope: 'preferences', path: [name] });
const recordKey = (recordType: 'education' | 'experience', name: string): SourceKey => ({ scope: 'record', recordType, path: ['fields', name] });
const isText = (field: FieldSnapshot) => field.kind === 'text' && !['hidden', 'password', 'file'].includes(String(field.hints.inputType ?? ''));
const isChoice = (field: FieldSnapshot) => ['select', 'combobox', 'radio'].includes(field.kind);
const isSingleton = (section: SectionSnapshot) => section.mode === 'inline' && !section.repeatable && section.records.length === 1 && section.actions.length === 0;
const uniqueField = (section: SectionSnapshot, label: string) => section.records.every(record => record.fields.filter(field => clean(field.label) === label).length === 1);
const hasRecordShape = (section: SectionSnapshot, fields: Record<string, (field: FieldSnapshot) => boolean>) => section.records.every(record =>
  Object.entries(fields).every(([label, accepts]) => {
    const matches = record.fields.filter(field => clean(field.label) === label);
    return matches.length === 1 && accepts(matches[0]!);
  }));
const dateRoles = ['start-year', 'start-month', 'end-year', 'end-month'] as const;
const dateSuffixes: Record<string, string> = { 'start-year': '开始年', 'start-month': '开始月', 'end-year': '结束年', 'end-month': '结束月' };
const isDatePart = (field: FieldSnapshot) => field.kind === 'combobox' && field.hints.component === 'moka-date-part' && field.hints.driver === 'moka-date-part-v1' && dateRoles.some(role => role === field.partRole);
const isFullDate = (field: FieldSnapshot) => field.kind === 'date' && field.hints.component === 'moka-date' && field.hints.driver === 'moka-date-v1' && ['month', 'day'].includes(String(field.hints.datePrecision));
const degreeAliases: Record<string, string> = { '大学本科': '本科', '学士': '本科', '硕士研究生': '硕士', '博士研究生': '博士', '专科': '大专', '大学专科': '大专' };
const degreeIdentity = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return;
  const normalized = degreeAliases[value.trim()] ?? value.trim();
  return ['本科', '硕士', '博士', '高中', '大专', '中专', '初中及以下', 'MBA'].includes(normalized) ? normalized : undefined;
};

function parseDate(source: string): { year: string; month: string; day?: string } | null {
  const parts = /^([1-9]\d{3})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.exec(source);
  if (!parts) return null;
  const year = Number(parts[1]), month = Number(parts[2]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (parts[3] && Number(parts[3]) > days[month - 1]!) return null;
  return { year: parts[1]!, month: parts[2]!, ...(parts[3] ? { day: parts[3] } : {}) };
}

function datePartSource(field: FieldSnapshot, recordType: 'education' | 'experience', fields: FieldSnapshot[]): SourceKey | null {
  if (!isDatePart(field) || !field.groupId) return null;
  const prefix = recordType === 'education' ? '就读时间' : '起止时间';
  const group = fields.filter(candidate => candidate.groupId === field.groupId);
  if (group.length !== 4 || !dateRoles.every(role => group.filter(candidate => isDatePart(candidate) && candidate.partRole === role && clean(candidate.label) === prefix + dateSuffixes[role]).length === 1)) return null;
  return recordKey(recordType, field.partRole!.startsWith('start-') ? 'startDate' : 'endDate');
}

function dateOptionLabel(source: string, field: FieldSnapshot, sourceKey: SourceKey): string | null {
  if (!isDatePart(field) || field.hints.disabled === true || sourceKey.scope !== 'record' || !['education', 'experience'].includes(sourceKey.recordType)) return null;
  const expected = field.partRole!.startsWith('start-') ? 'startDate' : 'endDate';
  if (sourceKey.path.length !== 2 || sourceKey.path[0] !== 'fields' || sourceKey.path[1] !== expected) return null;
  const parts = parseDate(source);
  if (!parts) return null;
  return field.partRole!.endsWith('-year') ? parts.year : String(Number(parts.month));
}

function isLegacyContact(section: SectionSnapshot): boolean {
  return isSingleton(section) && clean(section.label) === 'Form' && ['姓名', '请输入手机号', '邮箱'].every(label => uniqueField(section, label));
}

function unsupportedReason(field: FieldSnapshot): string | undefined {
  const label = clean(field.label);
  if (field.hints.component === 'moka-consent') return 'Consent and synchronization choices require the user; they are not resume data.';
  if (field.hints.component === 'moka-date-unverified' || field.hints.component === 'moka-date-part' && !isDatePart(field) || field.hints.component === 'moka-date' && !isFullDate(field)) return 'The observed Moka date control has no verified driver; never write a full date into a year or month part.';
  if (['出生日期 (年龄)', '出生日期', '日期（年月日）', '年', '月'].includes(label) && !isFullDate(field)) return 'Date semantics or component interaction are not verified for this capture.';
  if (label === '最高学历高校类别') return 'The catalog has no classification of the highest-education school.';
  if (label === '目前职位') return 'The catalog has no profile current job title; do not borrow a record without a proven identity.';
  if (label === '是否有教师资格证') return 'A teacher-certificate boolean is not directly available; do not infer it from arbitrary certificate records.';
  if (label === '招聘信息来源') return 'Recruiting information source is not a verified equivalent of recommendationMethod.';
  if (label === '推荐码') return 'Referral code is not recommendationMethod.';
  if (label === '手机区号' || /^\+\d+$/.test(label)) return 'Phone dialing prefix is not citizenship or nationality.';
  if (label === '同步更新在线简历') return 'Resume synchronization is a user decision, not resume data.';
  if (field.hints.inputType === 'file') return 'File upload has no supported source or action in this parser.';
  return undefined;
}

const profileLabels: Record<string, string> = { '姓名': 'name', '手机号码': 'phone', '邮箱': 'email', '性别': 'gender', '最高学历': 'highestEducation' };
const educationLabels: Record<string, string> = { '学校名称': 'school', '专业名称': 'major', '学历': 'degree' };
const experienceLabels: Record<string, string> = { '公司名称': 'company', '职位名称': 'title', '工作职责': 'description', '至今': 'current' };

function hasSharedStructure(snapshot: PageSnapshot): boolean {
  return snapshot.sections.some(section => {
    if (!section.records.length || !section.records[0]!.fields.some(field => ['moka-text', 'moka-select', 'moka-date-part', 'moka-date'].includes(String(field.hints.component)))) return false;
    const label = clean(section.label);
    if (isSingleton(section) && label === '个人信息') return Object.keys(profileLabels).some(name => uniqueField(section, name) && section.records[0]!.fields.some(field => clean(field.label) === name && (['性别', '最高学历'].includes(name) ? isChoice(field) : isText(field))));
    if (section.mode !== 'inline' || !section.repeatable) return false;
    return label === '教育背景' && hasRecordShape(section, { '学校名称': field => isText(field) || isChoice(field), '专业名称': field => isText(field) || isChoice(field), '学历': isChoice })
      || label === '实习经历' && hasRecordShape(section, { '公司名称': isText, '职位名称': isText, '工作职责': field => field.kind === 'textarea' });
  });
}

export const mokaDraftParser: SiteParser = {
  id: 'moka', name: 'Moka 招聘', version: '1.2.0', origins, routes: [applicationRoute, ...observedPages], scope: 'provider', provider: 'moka',
  includeRecord({ filter, record }) {
    if (filter !== 'internships' || record.recordType !== 'experience') return false;
    const type = record.extra?.employmentType;
    // An explicit type overrides a legacy section label. Unknown records stay
    // excluded with the existing warning rather than guessing from job titles.
    if (typeof type === 'string' && type.trim()) return ['实习', '实习生', 'intern', 'internship'].includes(type.trim().toLowerCase());
    return record.extra?.profileSection === '实习经历';
  },
  ownsPage(page) { return Boolean(identifyPage(page)); },
  matches(page, snapshot) { return Boolean(identifyPage(page)) && (observedPages.some(candidate => candidate.path === page.path && candidate.hashRoute === page.hashRoute) || hasSharedStructure(snapshot)); },
  parse({ snapshot, catalog }) {
    const page = identifyPage(snapshot.page);
    const available = new Set(catalog.map(item => sourceKeyId(item.sourceKey)));
    const profileSections = snapshot.sections.filter(section => isSingleton(section) && (clean(section.label) === '个人信息' || isLegacyContact(section)));
    const applicationSections = snapshot.sections.filter(section => isSingleton(section) && clean(section.label) === '申请信息');
    const profileLabelCounts = new Map<string, number>();
    for (const section of profileSections) for (const field of section.records[0]!.fields) {
      const label = clean(field.label);
      profileLabelCounts.set(label, (profileLabelCounts.get(label) ?? 0) + 1);
    }
    return {
      sections: snapshot.sections.filter(section => section.records.length > 0).map(section => {
        const sectionLabel = clean(section.label);
        const repeatable = Boolean(page) && section.mode === 'inline' && section.repeatable;
        const recordType = repeatable && sectionLabel === '教育背景' && hasRecordShape(section, { '学校名称': field => isText(field) || isChoice(field), '专业名称': field => isText(field) || isChoice(field), '学历': isChoice }) ? 'education' as const
          : repeatable && sectionLabel === '实习经历' && hasRecordShape(section, { '公司名称': isText, '职位名称': isText, '工作职责': field => field.kind === 'textarea' }) ? 'experience' as const : undefined;
        const template = section.records[0]!;
        return {
          sectionId: section.sectionId, ...(recordType ? { recordType } : {}), ...(recordType === 'experience' && sectionLabel === '实习经历' ? { recordFilter: 'internships' as const } : {}), template,
          bindings: template.fields.map((field): SemanticBinding => {
            const label = clean(field.label);
            const reason = unsupportedReason(field);
            let sourceKey: SourceKey | null = null;
            const unambiguous = template.fields.filter(candidate => clean(candidate.label) === label).length === 1;
            if (page && !reason && field.hints.disabled !== true && unambiguous) {
              if (applicationSections.length === 1 && applicationSections.includes(section) && label === '意向工作城市' && field.kind === 'combobox' && field.hints.component === 'moka-select') {
                sourceKey = preferenceKey('targetCities');
              } else if (recordType === 'education') {
                const name = educationLabels[label];
                if (name && (name === 'degree' ? isChoice(field) : isText(field) || isChoice(field))) sourceKey = recordKey(recordType, name);
                else if (label === '毕业时间' && isFullDate(field) && field.hints.datePrecision === 'day') sourceKey = recordKey(recordType, 'endDate');
                else sourceKey = datePartSource(field, recordType, template.fields);
              } else if (recordType === 'experience') {
                const name = experienceLabels[label];
                if (name && (name === 'current' ? field.kind === 'checkbox' : name === 'description' ? field.kind === 'textarea' : isText(field))) sourceKey = recordKey(recordType, name);
                else sourceKey = datePartSource(field, recordType, template.fields);
              } else if (profileSections.length === 1 && profileSections.includes(section) && profileLabelCounts.get(label) === 1) {
                if (isLegacyContact(section)) {
                  const name = ({ '姓名': 'name', '请输入手机号': 'phone', '邮箱': 'email' } as Record<string, string>)[label];
                  if (name && isText(field)) sourceKey = profileKey(name);
                } else {
                  if (page.tenant === 'baai' && label === '最高学历高校' && isText(field) && [profileKey('highestEducation'), recordKey('education', 'degree'), recordKey('education', 'school'), { scope: 'record', recordType: 'education', path: ['extra', 'educationType'] } as SourceKey].every(key => available.has(sourceKeyId(key)))) {
                    return { templateFieldId: field.fieldId, sourceKey: null, derivation: 'moka-highest-education-school', status: 'resolved', resolvedBy: 'site' };
                  }
                  const name = profileLabels[label];
                  if (name && (['gender', 'highestEducation'].includes(name) ? isChoice(field) : isText(field))) sourceKey = profileKey(name);
                  else if (label === '出生日期 (年龄)' && isFullDate(field) && field.hints.datePrecision === 'month') sourceKey = profileKey('birthday');
                }
              }
            }
            if (sourceKey && available.has(sourceKeyId(sourceKey))) return { templateFieldId: field.fieldId, sourceKey, status: 'resolved', resolvedBy: 'site' };
            return { templateFieldId: field.fieldId, sourceKey: null, status: reason ? 'unsupported' : 'unresolved', resolvedBy: null,
              reason: reason ?? 'No compatible mapping for this provider, section, field type and record structure.' };
          }),
        };
      }),
      warnings: [],
    };
  },
  deriveValue({ derivation, resume, record, field }) {
    const sourceRefs: SourceRef[] = [{ scope: 'profile', path: ['highestEducation'] }];
    const fail = (status: 'missing-source' | 'unresolved' | 'unsupported', reason: string) => ({ status, value: null, sourceRefs, reason });
    if (derivation !== 'moka-highest-education-school' || record !== null || clean(field.label) !== '最高学历高校' || !isText(field) || field.hints.disabled === true) return fail('unsupported', 'Highest school requires its verified singleton text field');
    const highest = degreeIdentity(resume.profile.highestEducation);
    if (!highest) return fail('missing-source', 'Highest education is absent or has no approved exact degree identity');
    const education = resume.records.filter(item => item.recordType === 'education');
    if (!education.length) return fail('missing-source', 'No education records establish the highest school');
    const matches = [];
    for (const item of education) {
      sourceRefs.push({ scope: 'record', recordType: 'education', recordId: item.id, path: ['fields', 'degree'] });
      const degree = degreeIdentity(item.fields.degree);
      if (!degree) {
        sourceRefs.push({ scope: 'record', recordType: 'education', recordId: item.id, path: ['extra', 'educationType'] });
        // Only an explicit non-degree exchange record can be excluded. Missing
        // degree alone is uncertainty, never evidence of a lower qualification.
        if ((item.fields.degree == null || typeof item.fields.degree === 'string' && item.fields.degree.trim() === '') && item.extra?.educationType === '交换生') continue;
        return fail('unresolved', 'An education degree is missing or unrecognized; the highest school is not unique');
      }
      if (degree === highest) matches.push(item);
    }
    if (matches.length !== 1) return fail('unresolved', 'Highest education must match exactly one explicit education record');
    const selected = matches[0]!;
    sourceRefs.push({ scope: 'record', recordType: 'education', recordId: selected.id, path: ['fields', 'school'] });
    if (typeof selected.fields.school !== 'string' || !selected.fields.school.trim()) return fail('missing-source', 'The uniquely matched education has no school');
    return { status: 'ready', value: selected.fields.school, sourceRefs, transform: 'identity' };
  },
  formatValue({ sourceKey, sourceValue, field }) {
    if (field.hints.component !== 'moka-date') return { status: 'ready', value: sourceValue, transform: 'identity' };
    const birthday = sourceKeyId(sourceKey) === sourceKeyId(profileKey('birthday')) && clean(field.label) === '出生日期 (年龄)' && field.hints.datePrecision === 'month';
    const graduation = sourceKeyId(sourceKey) === sourceKeyId(recordKey('education', 'endDate')) && clean(field.label) === '毕业时间' && field.hints.datePrecision === 'day';
    if (!isFullDate(field) || field.hints.disabled === true || !birthday && !graduation) return { status: 'unsupported', value: null, transform: 'identity', reason: 'Date control precision or source identity is not verified.' };
    const date = typeof sourceValue === 'string' ? parseDate(sourceValue.trim()) : null;
    if (!date) return { status: 'unsupported', value: null, transform: 'identity', reason: 'Date source is not a valid YYYY-MM or YYYY-MM-DD calendar date.' };
    if (graduation && !date.day) return { status: 'unsupported', value: null, transform: 'identity', reason: 'Date source has month precision; this graduation date requires a day. No day was invented.' };
    return { status: 'ready', value: `${date.year}-${date.month}${graduation ? `-${date.day}` : ''}`, transform: 'date-format' };
  },
  allowCustomInput({ sourceKey, sourceValue, field, evidence }) {
    return sourceKeyId(sourceKey) === sourceKeyId(recordKey('education', 'major')) && typeof sourceValue === 'string' && sourceValue.trim().length > 0
      && field.kind === 'combobox' && clean(field.label) === '专业名称' && field.hints.component === 'moka-select' && field.hints.disabled !== true
      && evidence.status === 'ready' && evidence.customInput === 'exact-text' && evidence.templateFieldId === field.fieldId && typeof evidence.recordId === 'string'
      && !evidence.options.some(option => option.label.trim() === sourceValue.trim());
  },
  resolveOption({ sourceKey, sourceValue, candidates, field }) {
    if (typeof sourceValue !== 'string' || !sourceValue.trim() || new Set(candidates.map(candidate => candidate.optionId)).size !== candidates.length) return null;
    const key = sourceKeyId(sourceKey);
    const source = sourceValue.trim();
    if (key === sourceKeyId(preferenceKey('targetCities'))) {
      if (!field || clean(field.label) !== '意向工作城市' || field.kind !== 'combobox' || field.hints.component !== 'moka-select' || field.hints.disabled === true) return null;
      const aliases: Record<string, string> = { 北京: '北京市', 上海: '上海市', 深圳: '深圳市' };
      const city = (value: string) => aliases[value.trim()] ?? value.trim();
      const targets = source.split(/[、,，;；\n]/u).map(value => value.trim()).filter(Boolean);
      if (!targets.length || targets.length > 50) return null;
      const matching = candidates.filter(candidate => !candidate.disabled && targets.some(target => city(target) === city(candidate.label)));
      return matching.length === 1 ? matching[0]!.optionId : null;
    }
    let target = source;
    if (field?.hints.component === 'moka-date-part') {
      const dateLabel = dateOptionLabel(source, field, sourceKey);
      if (!dateLabel) return null;
      target = dateLabel;
    } else if (key === sourceKeyId(profileKey('highestEducation')) || key === sourceKeyId(recordKey('education', 'degree'))) {
      target = degreeAliases[source] ?? source;
      const observed = key === sourceKeyId(profileKey('highestEducation')) ? ['本科', '硕士', '博士', '其他'] : ['本科', '硕士', '博士', '高中', '大专', '中专', '初中及以下', 'MBA', '其他'];
      if (!observed.includes(target)) return null;
    } else if (![profileKey('gender'), recordKey('education', 'school'), recordKey('education', 'major')].some(allowed => sourceKeyId(allowed) === key)) return null;
    const matching = candidates.filter(candidate => candidate.label.trim() === target);
    return matching.length === 1 && !matching[0]!.disabled ? matching[0]!.optionId : null;
  },
};
