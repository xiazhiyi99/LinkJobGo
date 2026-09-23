'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceHeader } from '../../../components/workspace/WorkspaceHeader';
import { ProfileSidebar } from '../../../components/profile/ProfileSidebar';
import { getProfile, importResume, updateProfile, updateProfilePreferences, uploadResume, type ProfilePayload } from '../../../features/profile/profile-api';
import type { ResumeDraft } from '../../../features/profile/resume-parser';
import { validateProfile } from '../../../features/profile/profile-validation';

type FieldKind = 'text' | 'email' | 'tel' | 'url' | 'date' | 'number' | 'select' | 'textarea';
type FieldSpan = 'full' | 'half' | 'third' | 'quarter' | 'twoThirds' | 'threeQuarter';
type FieldSpec = {
  key: string;
  label: string;
  kind?: FieldKind;
  span?: FieldSpan;
  placeholder?: string;
  options?: string[];
  rows?: number;
  readOnly?: boolean;
};
type ProfileRecord = { id: string; [key: string]: string };
type SectionDefinition = {
  title: string;
  eyebrow: string;
  description: string;
  kind: 'single' | 'repeat';
  fields: FieldSpec[];
};

type RemovedItem = { section: string; item: ProfileRecord };

const singleSections: SectionDefinition[] = [
  {
    title: '基本信息', eyebrow: '基础资料', description: '填写网申中最常使用的个人信息。邮箱来自账号，暂不可修改。', kind: 'single',
    fields: [
      { key: 'name', label: '姓名', placeholder: '请输入真实姓名', span: 'half' },
      { key: 'gender', label: '性别', kind: 'select', options: ['请选择', '男', '女'], span: 'quarter' },
      { key: 'birthday', label: '出生日期', kind: 'date', span: 'quarter' },
      { key: 'phone', label: '手机号', kind: 'tel', placeholder: '请输入手机号', span: 'half' },
      { key: 'email', label: '邮箱', kind: 'email', placeholder: '登录邮箱', span: 'half', readOnly: true },
      { key: 'wechat', label: '微信', placeholder: '选填', span: 'half' },
      { key: 'citizenship', label: '国籍', placeholder: '如：中国', span: 'quarter' },
      { key: 'nationality', label: '民族', placeholder: '如：汉族', span: 'quarter' },
      { key: 'nativePlace', label: '籍贯', placeholder: '如：江苏省苏州市', span: 'half' },
      { key: 'homeCity', label: '家庭所在城市', placeholder: '如：深圳', span: 'third' },
      { key: 'homeDistrict', label: '家庭所在区县', placeholder: '如：南山区', span: 'third' },
      { key: 'schoolCity', label: '学校所在城市', placeholder: '如：广州', span: 'third' },
      { key: 'address', label: '详细地址', placeholder: '选填', span: 'full' },
      { key: 'politicalStatus', label: '政治面貌', kind: 'select', options: ['请选择', '群众', '共青团员', '中共党员', '其他'], span: 'third' },
      { key: 'highestEducation', label: '最高学历', placeholder: '如：硕士研究生', span: 'third' },
      { key: 'workExperience', label: '工作经验', kind: 'select', options: ['应届生', '1 年以内', '1–3 年', '3–5 年', '5 年以上'], span: 'third' },
      { key: 'firstWorkYear', label: '首次参加工作年份', kind: 'number', placeholder: '如：2023', span: 'third' },
      { key: 'fullTimeStudent', label: '全日制在校生', kind: 'select', options: ['请选择', '是', '否'], span: 'third' },
      { key: 'interests', label: '兴趣爱好', placeholder: '如：摄影、跑步、开源', span: 'full' },
      { key: 'website', label: '个人主页', kind: 'url', placeholder: 'https://', span: 'half' },
      { key: 'github', label: 'GitHub / 作品集', kind: 'url', placeholder: 'https://', span: 'half' },
    ],
  },
  {
    title: '求职意向', eyebrow: '目标与偏好', description: '这些信息会帮助后续职位匹配和网申填写。', kind: 'single',
    fields: [
      { key: 'targetTitles', label: '期望职位', placeholder: '如：产品经理、前端工程师', span: 'half' },
      { key: 'targetIndustries', label: '期望行业', placeholder: '如：互联网、金融科技', span: 'half' },
      { key: 'targetCities', label: '期望城市', placeholder: '如：深圳、广州、杭州', span: 'half' },
      { key: 'employmentType', label: '工作类型', kind: 'select', options: ['请选择', '全职', '实习', '校招'], span: 'quarter' },
      { key: 'availableFrom', label: '到岗时间', kind: 'date', span: 'quarter' },
      { key: 'salaryExpectation', label: '期望薪资', kind: 'number', placeholder: '月薪（元）', span: 'quarter' },
      { key: 'relocation', label: '接受岗位调剂', kind: 'select', options: ['请选择', '接受', '不接受'], span: 'quarter' },
      { key: 'hasRelativesInCompany', label: '应聘企业亲友', kind: 'select', options: ['请选择', '有', '无'], span: 'quarter' },
      { key: 'workVisaRequired', label: '需要工作签证', kind: 'select', options: ['请选择', '是', '否'], span: 'quarter' },
      { key: 'recommendationMethod', label: '推荐方式', placeholder: '如：本人直接申请', span: 'half' },
      { key: 'preferenceNote', label: '补充说明', kind: 'textarea', placeholder: '可填写岗位偏好、城市排序等', span: 'full', rows: 3 },
    ],
  },
];

const repeatSections: SectionDefinition[] = [
  {
    title: '教育经历', eyebrow: '学习经历', description: '按时间倒序添加学校、专业和学习成果。', kind: 'repeat',
    fields: [
      { key: 'school', label: '学校名称', placeholder: '如：中山大学', span: 'half' },
      { key: 'college', label: '学院名称', placeholder: '如：计算机学院', span: 'half' },
      { key: 'schoolCity', label: '学校所在城市', placeholder: '如：广州', span: 'third' },
      { key: 'educationType', label: '培养方式', placeholder: '如：统招全日制', span: 'third' },
      { key: 'degree', label: '学历', kind: 'select', options: ['请选择学历', '大专', '本科', '硕士', '博士'], span: 'third' },
      { key: 'major', label: '专业', placeholder: '如：软件工程', span: 'third' },
      { key: 'research', label: '研究方向', placeholder: '选填', span: 'half' },
      { key: 'advisor', label: '导师姓名', placeholder: '选填', span: 'quarter' },
      { key: 'lab', label: '实验室', placeholder: '选填', span: 'quarter' },
      { key: 'startDate', label: '开始时间', kind: 'date', span: 'quarter' },
      { key: 'endDate', label: '结束时间', kind: 'date', span: 'quarter' },
      { key: 'current', label: '在读状态', kind: 'select', options: ['已毕业', '在读'], span: 'quarter' },
      { key: 'gpa', label: 'GPA / 绩点', kind: 'text', placeholder: '如：3.8 / 4.0', span: 'quarter' },
      { key: 'rank', label: '专业排名', placeholder: '如：前 10%', span: 'third' },
      { key: 'courses', label: '专业主要课程', placeholder: '用顿号分隔', span: 'twoThirds' },
      { key: 'description', label: '专业描述', kind: 'textarea', placeholder: '补充主修方向、学术成果等', span: 'full', rows: 4 },
    ],
  },
  {
    title: '工作/实习经历', eyebrow: '职业经历', description: '记录实习和正式工作的职责、成果与证明人信息。', kind: 'repeat',
    fields: [
      { key: 'company', label: '公司名称', placeholder: '如：腾讯科技', span: 'half' },
      { key: 'industry', label: '行业类别', kind: 'select', options: ['请选择行业', '互联网', '金融', '教育', '制造业', '其他'], span: 'quarter' },
      { key: 'city', label: '工作地点', placeholder: '如：深圳', span: 'quarter' },
      { key: 'department', label: '所在部门', placeholder: '选填', span: 'third' },
      { key: 'title', label: '职位名称', placeholder: '如：产品实习生', span: 'third' },
      { key: 'current', label: '在职状态', kind: 'select', options: ['已离职', '在职'], span: 'third' },
      { key: 'startDate', label: '开始时间', kind: 'date', span: 'quarter' },
      { key: 'endDate', label: '结束时间', kind: 'date', span: 'quarter' },
      { key: 'description', label: '详细内容', kind: 'textarea', placeholder: '描述负责的工作、协作对象和工作方法', span: 'full', rows: 4 },
      { key: 'achievements', label: '工作成果', kind: 'textarea', placeholder: '尽量量化成果，例如提升转化率 20%', span: 'full', rows: 4 },
      { key: 'referee', label: '证明人', placeholder: '选填', span: 'third' },
      { key: 'refereePhone', label: '证明人联系方式', kind: 'tel', placeholder: '选填', span: 'third' },
      { key: 'refereeTitle', label: '证明人职务', placeholder: '选填', span: 'third' },
    ],
  },
  {
    title: '项目经历', eyebrow: '实践项目', description: '突出你在项目中的角色、职责和可验证成果。', kind: 'repeat',
    fields: [
      { key: 'name', label: '项目名称', placeholder: '如：校园招聘助手', span: 'half' },
      { key: 'role', label: '担任角色', placeholder: '如：项目负责人', span: 'half' },
      { key: 'startDate', label: '开始时间', kind: 'date', span: 'quarter' },
      { key: 'endDate', label: '结束时间', kind: 'date', span: 'quarter' },
      { key: 'url', label: '项目链接', kind: 'url', placeholder: 'https://', span: 'half' },
      { key: 'organization', label: '所属单位', placeholder: '如：清华大学', span: 'half' },
      { key: 'description', label: '项目详情', kind: 'textarea', placeholder: '项目背景、目标和使用的技术/方法', span: 'full', rows: 4 },
      { key: 'responsibilities', label: '项目中职责', kind: 'textarea', placeholder: '描述你具体负责的部分', span: 'full', rows: 4 },
      { key: 'achievements', label: '项目业绩', kind: 'textarea', placeholder: '描述结果、数据和影响', span: 'full', rows: 4 },
    ],
  },
  {
    title: '论文与专利', eyebrow: '学术成果', description: '记录论文、专利和公开发表信息。', kind: 'repeat',
    fields: [
      { key: 'name', label: '成果名称', placeholder: '论文或专利名称', span: 'full' },
      { key: 'type', label: '成果类型', kind: 'select', options: ['论文', '专利'], span: 'quarter' },
      { key: 'year', label: '发表年份', kind: 'number', placeholder: '如：2026', span: 'quarter' },
      { key: 'role', label: '作者身份', placeholder: '如：第一作者', span: 'half' },
      { key: 'description', label: '发表信息', kind: 'textarea', placeholder: '会议、期刊、专利公开号等', span: 'full', rows: 3 },
    ],
  },
  {
    title: '在校经历', eyebrow: '校园实践', description: '补充学生组织、校园活动和领导力经历。', kind: 'repeat',
    fields: [
      { key: 'title', label: '职务名称', placeholder: '如：学生会部长', span: 'half' },
      { key: 'level', label: '学生干部级别', kind: 'select', options: ['请选择级别', '校级', '院级', '班级', '社团'], span: 'quarter' },
      { key: 'activity', label: '项目 / 活动名称', placeholder: '如：校园开放日', span: 'quarter' },
      { key: 'startDate', label: '开始时间', kind: 'date', span: 'quarter' },
      { key: 'endDate', label: '结束时间', kind: 'date', span: 'quarter' },
      { key: 'description', label: '职务描述', kind: 'textarea', placeholder: '描述组织规模、具体职责和结果', span: 'full', rows: 4 },
    ],
  },
  {
    title: '获奖经历', eyebrow: '荣誉成果', description: '添加奖项、等级和获奖时间。', kind: 'repeat',
    fields: [
      { key: 'category', label: '奖项类别', kind: 'select', options: ['请选择类别', '学业奖学金', '竞赛奖项', '优秀个人', '其他'], span: 'third' },
      { key: 'name', label: '奖项名称', placeholder: '如：全国大学生数学建模竞赛', span: 'third' },
      { key: 'level', label: '奖项级别', placeholder: '如：国家级', span: 'third' },
      { key: 'date', label: '获奖时间', kind: 'date', span: 'quarter' },
      { key: 'rank', label: '奖项等级', placeholder: '如：一等奖', span: 'quarter' },
      { key: 'description', label: '奖项描述', kind: 'textarea', placeholder: '选填', span: 'half', rows: 3 },
    ],
  },
  {
    title: '语言能力', eyebrow: '语言与考试', description: '记录英语及其他语言成绩或使用能力。', kind: 'repeat',
    fields: [
      { key: 'language', label: '语言', placeholder: '如：英语', span: 'third' },
      { key: 'level', label: '水平', kind: 'select', options: ['请选择水平', '母语', '熟练', '良好', '基础'], span: 'third' },
      { key: 'certificate', label: '证书 / 考试', placeholder: '如：CET-6', span: 'third' },
      { key: 'score', label: '成绩', placeholder: '如：610', span: 'quarter' },
      { key: 'obtainedAt', label: '证书获取时间', kind: 'date', span: 'quarter' },
      { key: 'usage', label: '使用场景', placeholder: '如：英文汇报、技术文档', span: 'half' },
    ],
  },
  {
    title: '证书信息', eyebrow: '资质证书', description: '添加职业资格、技术认证和其他证书。', kind: 'repeat',
    fields: [
      { key: 'name', label: '证书名称', placeholder: '如：软考中级', span: 'half' },
      { key: 'issuer', label: '颁发机构', placeholder: '如：中国计算机技术职业资格网', span: 'half' },
      { key: 'obtainedAt', label: '获得时间', kind: 'date', span: 'quarter' },
      { key: 'url', label: '证书链接', kind: 'url', placeholder: 'https://', span: 'threeQuarter' },
      { key: 'description', label: '证书描述', kind: 'textarea', placeholder: '选填', span: 'full', rows: 3 },
    ],
  },
  {
    title: '技能', eyebrow: '技术能力', description: '记录编程语言、模型框架、工程工具和其他技能。', kind: 'repeat',
    fields: [
      { key: 'category', label: '技能类别', placeholder: '如：编程语言', span: 'third' },
      { key: 'name', label: '技能名称', placeholder: '如：Python、PyTorch', span: 'twoThirds' },
    ],
  },
  {
    title: '自我介绍', eyebrow: '个人概述', description: '用一段简洁的话概括你的优势和发展方向。', kind: 'single',
    fields: [{ key: 'selfIntroduction', label: '自我介绍', kind: 'textarea', placeholder: '建议 100–300 字，突出经历、能力和求职方向', span: 'full', rows: 6 }],
  },
];

const allSections = [...singleSections, ...repeatSections];
const blankRecord = (fields: FieldSpec[]): ProfileRecord => ({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ...Object.fromEntries(fields.map((field) => [field.key, ''])) });
const cloneRecords = (records: Record<string, ProfileRecord[]>) => Object.fromEntries(Object.entries(records).map(([key, value]) => [key, value.map((item) => ({ ...item }))]));
const textValue = (value: unknown) => Array.isArray(value) ? value.join('、') : typeof value === 'string' ? value : value == null ? '' : String(value);
const recordValue = (value: unknown): ProfileRecord => {
  const source = (value || {}) as Record<string, unknown>;
  return { id: textValue(source.id) || `server-${Math.random().toString(16).slice(2)}`, ...Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'id').map(([key, item]) => [key, textValue(item)])) };
};
const recordsValue = (value: unknown, currentLabels?: { active: string; inactive: string }) => Array.isArray(value)
  ? value.map((item) => {
    const record = recordValue(item);
    if (currentLabels && typeof (item as Record<string, unknown>)?.current === 'boolean') {
      record.current = (item as Record<string, unknown>).current ? currentLabels.active : currentLabels.inactive;
    }
    return record;
  })
  : [];

function hydrateProfile(payload: ProfilePayload) {
  const source = ((payload as Record<string, unknown>).data as ProfilePayload | undefined) || payload;
  const profile = ((source.profile || source) || {}) as Record<string, unknown>;
  const preferences = (source.preferences || {}) as Record<string, unknown>;
  const values: Record<string, string> = {
    name: textValue(profile.name), phone: textValue(profile.phone), email: textValue(profile.email), gender: textValue(profile.gender), birthday: textValue(profile.birthday),
    citizenship: textValue(profile.citizenship), nationality: textValue(profile.nationality), politicalStatus: textValue(profile.politicalStatus),
    wechat: textValue(profile.wechat), nativePlace: textValue(profile.nativePlace), highestEducation: textValue(profile.highestEducation),
    firstWorkYear: textValue(profile.firstWorkYear), fullTimeStudent: textValue(profile.fullTimeStudent), hasRelativesInCompany: textValue(profile.hasRelativesInCompany),
    homeCity: textValue(profile.city || profile.homeCity), website: textValue(profile.personalWebsite || profile.website),
    github: textValue(profile.githubUrl || profile.github), selfIntroduction: textValue(profile.selfIntroduction),
    targetTitles: textValue(preferences.targetTitles), targetCities: textValue(preferences.targetCities),
    targetIndustries: textValue(preferences.targetIndustries), employmentType: textValue(preferences.employmentType),
    availableFrom: textValue(preferences.availableFrom), salaryExpectation: textValue(preferences.salaryExpectation), relocation: textValue(preferences.relocation),
    recommendationMethod: textValue(profile.recommendationMethod), workVisaRequired: textValue(profile.workVisaRequired),
  };
  const skills = recordsValue(source.skills);
  const languages = recordsValue(source.languages).map((item) => ({
    ...item,
    language: item.language || item.name || '',
    kind: 'language',
  }));
  const certificates = recordsValue(source.certificates).map((item) => ({ ...item, kind: 'certificate' }));
  const records: Record<string, ProfileRecord[]> = {
    教育经历: recordsValue(source.educations, { active: '在读', inactive: '已毕业' }),
    '工作/实习经历': recordsValue(source.experiences, { active: '在职', inactive: '已离职' }),
    项目经历: recordsValue(source.projects),
    '论文与专利': recordsValue(source.publications),
    在校经历: recordsValue(source.campusExperiences),
    获奖经历: recordsValue(source.awards),
    语言能力: languages.length ? languages : skills.filter((item) => item.kind === 'language'),
    证书信息: certificates.length ? certificates : skills.filter((item) => item.kind === 'certificate'),
    技能: skills.filter((item) => item.kind === 'skill'),
  };
  return { values, records };
}

function toApiProfile(values: Record<string, string>) {
  return {
    name: values.name || '', phone: values.phone || '', city: values.homeCity || '',
    personalWebsite: values.website || '', githubUrl: values.github || '', selfIntroduction: values.selfIntroduction || '',
    gender: values.gender || '', birthday: values.birthday || '', citizenship: values.citizenship || '', nationality: values.nationality || '',
    politicalStatus: values.politicalStatus || '', wechat: values.wechat || '', nativePlace: values.nativePlace || '',
    highestEducation: values.highestEducation || '', firstWorkYear: values.firstWorkYear || '', fullTimeStudent: values.fullTimeStudent || '',
    hasRelativesInCompany: values.hasRelativesInCompany || '', recommendationMethod: values.recommendationMethod || '',
    workVisaRequired: values.workVisaRequired || '',
  };
}

function toApiPreferences(values: Record<string, string>) {
  return {
    targetTitles: values.targetTitles || '', targetCities: values.targetCities || '',
    targetIndustries: values.targetIndustries || '', employmentType: values.employmentType || '',
    availableFrom: values.availableFrom || '', salaryExpectation: values.salaryExpectation || '',
    relocation: values.relocation || '', preferenceNote: values.preferenceNote || '',
  };
}

function FormField({ field, value, onChange }: { field: FieldSpec; value: string; onChange: (value: string) => void }) {
  const common = { value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(event.target.value), placeholder: field.placeholder, readOnly: field.readOnly };
  return <label className={`profile-field profile-field--${field.span || 'half'}`}><span>{field.label}</span>{field.kind === 'textarea' ? <textarea {...common} rows={field.rows || 4} /> : field.kind === 'select' ? <select {...common}>{field.options?.map((option) => <option key={option} value={option === '请选择' || option.startsWith('请选择') ? '' : option}>{option}</option>)}</select> : <input {...common} type={field.kind || 'text'} />}</label>;
}

function RecordPreview({ item, fields, index }: { item: ProfileRecord; fields: FieldSpec[]; index: number }) {
  const preview = fields.filter((field) => item[field.key]).slice(0, 4);
  return <div className="profile-record-preview"><div className="profile-record-index">{String(index + 1).padStart(2, '0')}</div><div className="profile-record-summary">{preview.length ? preview.map((field) => <div key={field.key}><span>{field.label}</span><strong>{item[field.key]}</strong></div>) : <span className="profile-empty">-</span>}</div></div>;
}

export default function ProfilePage() {
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState('profile-section-0');
  const [values, setValues] = useState<Record<string, string>>({});
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [records, setRecords] = useState<Record<string, ProfileRecord[]>>({});
  const [draftRecords, setDraftRecords] = useState<Record<string, ProfileRecord[]>>({});
  const [removed, setRemoved] = useState<RemovedItem[]>([]);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const sectionDrafts = useRef<Record<string, { values: Record<string, string>; records: Record<string, ProfileRecord[]>; removed: RemovedItem[] }>>({});
  const { progress, filledFieldCount, experienceCount } = useMemo(() => {
    const total = allSections.reduce((sum, section) => sum + section.fields.length, 0);
    let filledFieldCount = 0;
    let experienceCount = 0;
    for (const section of allSections) {
      const items = section.kind === 'single' ? [values] : records[section.title] || [];
      if (section.kind === 'repeat') experienceCount += items.length;
      for (const item of items) {
        filledFieldCount += section.fields.filter((field) => String(item[field.key] || '').trim()).length;
      }
    }
    return { progress: Math.round(Math.min(100, (filledFieldCount / total) * 100)), filledFieldCount, experienceCount };
  }, [values, records]);

  const notify = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(''), 2200); };
  useEffect(() => {
    let cancelled = false;
    getProfile().then((payload) => {
      if (cancelled) return;
      const hydrated = hydrateProfile(payload);
      setValues((current) => ({ ...current, ...hydrated.values }));
      setRecords(hydrated.records);
    }).catch((error) => {
      if (!cancelled && error?.status !== 401) notify('资料服务暂不可用，当前可继续编辑本地草稿');
    }).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const beginEdit = (section: SectionDefinition) => { setEditing(section.title); setDraftValues({ ...values }); setDraftRecords(cloneRecords(records)); setRemoved([]); };
  const cancelEdit = () => { if (editing) delete sectionDrafts.current[editing]; setEditing(null); setRemoved([]); };
  const selectSection = (id: string) => {
    if (id === selectedSectionId) return;
    if (editing) sectionDrafts.current[editing] = { values: draftValues, records: draftRecords, removed };
    const section = allSections.find((_, index) => `profile-section-${index}` === id);
    if (!section) return;
    const draft = sectionDrafts.current[section.title];
    setSelectedSectionId(id);
    setEditing(draft ? section.title : null);
    setDraftValues(draft?.values || {});
    setDraftRecords(draft?.records || {});
    setRemoved(draft?.removed || []);
  };
  const save = async (section: SectionDefinition) => {
    if (section.title === '基本信息') { const errors = validateProfile({ name: draftValues.name || '' }); if (errors.name) { notify(errors.name); return; } }
    const nextValues = section.kind === 'single'
      ? { ...values, ...Object.fromEntries(section.fields.map((field) => [field.key, draftValues[field.key] || ''])) }
      : values;
    const nextRecords = section.kind === 'repeat' ? { ...records, [section.title]: draftRecords[section.title] || [] } : records;
    delete sectionDrafts.current[section.title];
    setValues(nextValues); setRecords(nextRecords); setEditing(null); setRemoved([]); notify('已保存');
    try {
      if (section.title === '求职意向') await updateProfilePreferences(toApiPreferences(nextValues));
      else await updateProfile({ profile: toApiProfile(nextValues), preferences: toApiPreferences(nextValues), records: nextRecords });
    } catch (error) {
      notify(error?.status === 401 ? '请先登录后再同步资料' : '已保存本地草稿，服务暂不可用');
    }
  };

  const applyResumeDraft = async (draft: ResumeDraft, options?: { replaceFields?: string[]; keepFields?: string[] }) => {
    const replaceFields = new Set(options?.replaceFields || []);
    const nextValues = { ...values };
    const valueAliases: Record<string, string> = { city: 'homeCity', personalWebsite: 'website', githubUrl: 'github' };
    for (const [key, value] of Object.entries(draft.values)) {
      if (!String(value || '').trim()) continue;
      const localKey = valueAliases[key] || key;
      if (!String(values[localKey] || '').trim() || replaceFields.has(key) || replaceFields.has(localKey)) nextValues[localKey] = String(value);
    }
    const nextRecords = cloneRecords(records);
    for (const [key, items] of Object.entries(draft.records)) {
      nextRecords[key] = [...(nextRecords[key] || []), ...(items || []).map(recordValue)];
    }
    const profile = { ...draft.values } as Record<string, unknown>;
    if (profile.website && !profile.personalWebsite) profile.personalWebsite = profile.website;
    if (profile.github && !profile.githubUrl) profile.githubUrl = profile.github;
    if (profile.homeCity && !profile.city) profile.city = profile.homeCity;
    const preferences = Object.fromEntries(Object.entries(draft.values).filter(([key]) => ['targetTitles', 'targetCities', 'targetIndustries', 'employmentType', 'availableFrom', 'salaryExpectation', 'relocation', 'preferenceNote'].includes(key)));
    const resolutionAliases: Record<string, string> = { website: 'personalWebsite', github: 'githubUrl' };
    const preferenceKeys = new Set(['targetTitles', 'targetCities', 'targetIndustries', 'employmentType', 'availableFrom', 'salaryExpectation', 'relocation', 'preferenceNote']);
    const resolutionPath = (field: string) => `${preferenceKeys.has(field) ? 'preferences' : 'profile'}.${resolutionAliases[field] || field}`;
    const resolutions = Object.fromEntries([
      ...(options?.replaceFields || []).map((field) => [resolutionPath(field), 'replace' as const]),
      ...(options?.keepFields || []).map((field) => [resolutionPath(field), 'keep' as const]),
    ]);
    // Let the API derive the idempotency key from the normalized payload. A
    // filename/length key would reuse an older import after the parser or
    // normalizer is fixed, preventing newly recovered records from being
    // written.
    await importResume({ result: { profile, preferences, records: draft.records }, resolutions });
    setValues(nextValues);
    setRecords(nextRecords);
    // Text/Markdown sources are retained by the legacy document endpoint. Binary
    // files are already handled by /ai/resume/parse-file and are not re-uploaded.
    if (draft.sourceText.trim()) {
      await uploadResume({ filename: draft.sourceName, contentType: draft.sourceContentType || 'text/plain', content: draft.sourceText });
    }
  };
  const addRecord = (section: SectionDefinition) => {
    const nextRecords = cloneRecords(editing === section.title ? draftRecords : records);
    nextRecords[section.title] = [...(nextRecords[section.title] || []), blankRecord(section.fields)];
    if (editing !== section.title) { setDraftValues({ ...values }); setEditing(section.title); }
    setDraftRecords(nextRecords);
  };
  const removeRecord = (section: string, id: string) => {
    const target = (draftRecords[section] || []).find((item) => item.id === id);
    if (!target) return;
    setDraftRecords((current) => ({ ...current, [section]: (current[section] || []).filter((item) => item.id !== id) }));
    setRemoved((current) => [...current, { section, item: target }]);
  };
  const undoRecord = (index: number) => { const entry = removed[index]; if (!entry) return; setDraftRecords((current) => ({ ...current, [entry.section]: [...(current[entry.section] || []), entry.item] })); setRemoved((current) => current.filter((_, itemIndex) => itemIndex !== index)); };

  return <div className="workspace-content profile-page linkedin-profile-page">
    <WorkspaceHeader title="个人资料" />
    <main className="profile-public" aria-busy={isLoading}>
      <ProfileSidebar
        sections={allSections.map((section, sectionIndex) => ({ id: `profile-section-${sectionIndex}`, title: section.title, description: section.eyebrow }))}
        activeId={selectedSectionId}
        existingValues={values}
        onSelectSection={selectSection}
        completion={progress}
        filledFieldCount={filledFieldCount}
        experienceCount={experienceCount}
        onApplyResumeDraft={applyResumeDraft}
      />
      <div className="profile-public-layout">
        <div className="profile-public-primary">
          {allSections.map((section, sectionIndex) => {
            const isEditing = editing === section.title;
            const sectionRecords = isEditing ? draftRecords[section.title] || [] : records[section.title] || [];
            return <section id={`profile-section-${sectionIndex}`} role="tabpanel" aria-labelledby={`tab-profile-section-${sectionIndex}`} hidden={selectedSectionId !== `profile-section-${sectionIndex}`} className={`profile-section profile-public-section profile-section--${section.kind}`} key={section.title}>
              <header><div><h3>{section.title}</h3></div><div className="profile-actions">{isEditing && <button className="profile-button profile-button--quiet" onClick={cancelEdit}>取消</button>}<button className="profile-button" onClick={() => isEditing ? save(section) : beginEdit(section)}>{isEditing ? '保存' : '编辑'}</button></div></header>
              {section.kind === 'single' ? (isEditing ? <div className="profile-form">{section.fields.map((field) => <FormField key={field.key} field={field} value={draftValues[field.key] || ''} onChange={(value) => setDraftValues((current) => ({ ...current, [field.key]: value }))} />)}</div> : <div className="profile-read-grid">{section.fields.map((field) => <div className={`profile-read-item profile-read-item--${field.span || 'half'}`} key={field.key}><span>{field.label}</span><strong>{values[field.key] || '-'}</strong></div>)}</div>) : <>
                {isEditing && <div className="profile-form profile-form--repeat">{sectionRecords.map((item) => <div className="profile-record" key={item.id}><div className="profile-record-heading"><span>经历条目</span><button className="profile-remove" onClick={() => removeRecord(section.title, item.id)}>移除</button></div><div className="profile-form">{section.fields.map((field) => <FormField key={field.key} field={field} value={item[field.key] || ''} onChange={(value) => setDraftRecords((current) => ({ ...current, [section.title]: (current[section.title] || []).map((entry) => entry.id === item.id ? { ...entry, [field.key]: value } : entry) }))} />)}</div></div>)}</div>}
                {!isEditing && sectionRecords.map((item, index) => <RecordPreview key={item.id} item={item} fields={section.fields} index={index} />)}
                {!sectionRecords.length && !isEditing && <div className="profile-empty-state">还没有添加{section.title}，从一条经历开始。</div>}
                {isEditing && removed.filter((entry) => entry.section === section.title).map((entry) => <div className="profile-undo" key={entry.item.id}>已移除一条记录<button onClick={() => undoRecord(removed.findIndex((item) => item.item.id === entry.item.id))}>撤销</button></div>)}
                <button className="add-profile" onClick={() => addRecord(section)}>＋ 添加{section.title}</button>
              </>}
            </section>;
          })}
        </div>
      </div>
    </main>
    {message && <div className="profile-toast">{message}</div>}
  </div>;
}
