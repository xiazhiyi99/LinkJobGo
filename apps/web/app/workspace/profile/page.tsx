'use client';

import { useMemo, useState } from 'react';
import { WorkspaceHeader } from '../../../components/workspace/WorkspaceHeader';
import { ProfileSidebar } from '../../../components/profile/ProfileSidebar';
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
      { key: 'homeCity', label: '家庭所在城市', placeholder: '如：深圳', span: 'third' },
      { key: 'homeDistrict', label: '家庭所在区县', placeholder: '如：南山区', span: 'third' },
      { key: 'schoolCity', label: '学校所在城市', placeholder: '如：广州', span: 'third' },
      { key: 'address', label: '详细地址', placeholder: '选填', span: 'full' },
      { key: 'politicalStatus', label: '政治面貌', kind: 'select', options: ['请选择', '群众', '共青团员', '中共党员', '其他'], span: 'third' },
      { key: 'nationality', label: '民族', placeholder: '如：汉族', span: 'third' },
      { key: 'workExperience', label: '工作经验', kind: 'select', options: ['应届生', '1 年以内', '1–3 年', '3–5 年', '5 年以上'], span: 'third' },
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
      { key: 'description', label: '项目详情', kind: 'textarea', placeholder: '项目背景、目标和使用的技术/方法', span: 'full', rows: 4 },
      { key: 'responsibilities', label: '项目中职责', kind: 'textarea', placeholder: '描述你具体负责的部分', span: 'full', rows: 4 },
      { key: 'achievements', label: '项目业绩', kind: 'textarea', placeholder: '描述结果、数据和影响', span: 'full', rows: 4 },
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
    title: '自我介绍', eyebrow: '个人概述', description: '用一段简洁的话概括你的优势和发展方向。', kind: 'single',
    fields: [{ key: 'selfIntroduction', label: '自我介绍', kind: 'textarea', placeholder: '建议 100–300 字，突出经历、能力和求职方向', span: 'full', rows: 6 }],
  },
];

const allSections = [...singleSections, ...repeatSections];
const blankRecord = (fields: FieldSpec[]): ProfileRecord => ({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ...Object.fromEntries(fields.map((field) => [field.key, ''])) });
const cloneRecords = (records: Record<string, ProfileRecord[]>) => Object.fromEntries(Object.entries(records).map(([key, value]) => [key, value.map((item) => ({ ...item }))]));

function FormField({ field, value, onChange }: { field: FieldSpec; value: string; onChange: (value: string) => void }) {
  const common = { value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(event.target.value), placeholder: field.placeholder, readOnly: field.readOnly };
  return <label className={`profile-field profile-field--${field.span || 'half'}`}><span>{field.label}</span>{field.kind === 'textarea' ? <textarea {...common} rows={field.rows || 4} /> : field.kind === 'select' ? <select {...common}>{field.options?.map((option) => <option key={option} value={option === '请选择' || option.startsWith('请选择') ? '' : option}>{option}</option>)}</select> : <input {...common} type={field.kind || 'text'} />}</label>;
}

function RecordPreview({ item, fields, index }: { item: ProfileRecord; fields: FieldSpec[]; index: number }) {
  const preview = fields.filter((field) => item[field.key]).slice(0, 4);
  return <div className="profile-record-preview"><div className="profile-record-index">{String(index + 1).padStart(2, '0')}</div><div className="profile-record-summary">{preview.length ? preview.map((field) => <div key={field.key}><span>{field.label}</span><strong>{item[field.key]}</strong></div>) : <span className="profile-empty">尚未填写内容</span>}</div></div>;
}

export default function ProfilePage() {
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [records, setRecords] = useState<Record<string, ProfileRecord[]>>({});
  const [draftRecords, setDraftRecords] = useState<Record<string, ProfileRecord[]>>({});
  const [removed, setRemoved] = useState<RemovedItem[]>([]);
  const [message, setMessage] = useState('');
  const progress = useMemo(() => {
    const total = allSections.reduce((sum, section) => sum + section.fields.length, 0);
    const filledSingles = Object.values(values).filter(Boolean).length;
    const filledRecords = Object.values(records).flat().reduce((sum, item) => sum + Object.entries(item).filter(([key, value]) => key !== 'id' && value).length, 0);
    return Math.round(Math.min(100, ((filledSingles + filledRecords) / total) * 100));
  }, [values, records]);

  const notify = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(''), 2200); };
  const beginEdit = (section: SectionDefinition) => { setEditing(section.title); setDraftValues({ ...values }); setDraftRecords(cloneRecords(records)); setRemoved([]); };
  const cancelEdit = () => { setEditing(null); setRemoved([]); };
  const save = (section: SectionDefinition) => {
    if (section.title === '基本信息') { const errors = validateProfile({ name: draftValues.name || '' }); if (errors.name) { notify(errors.name); return; } }
    setValues({ ...draftValues }); setRecords(cloneRecords(draftRecords)); setEditing(null); setRemoved([]); notify('已保存');
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

  const displayName = values.name || '林同学';
  const headline = values.targetTitles || '把经历整理成下一次机会';
  const location = values.homeCity || '中国 · 开放求职中';

  return <div className="workspace-content profile-page linkedin-profile-page">
    <WorkspaceHeader title="个人资料" />
    <main className="profile-public">
      <section className="profile-hero">
        <div className="profile-cover"><div className="profile-cover-orb" /><div className="profile-cover-lines" /></div>
        <div className="profile-identity-card">
          <div className="profile-avatar profile-hero-portrait">{displayName.slice(0, 1)}</div>
          <div className="profile-identity-main">
            <h1>{displayName}</h1>
            <p>{headline} <span>·</span> 领客求职者</p>
            <div className="profile-location">{location}</div>
            <div className="profile-hero-actions"><button className="profile-primary-action" onClick={() => beginEdit(singleSections[0])}>编辑资料</button><button className="profile-secondary-action" onClick={() => document.getElementById('resume-parser')?.scrollIntoView()}>简历解析</button></div>
          </div>
          <aside className="profile-identity-side">
            <div className="profile-identity-side-heading"><span>资料完成度</span><strong>{progress}%</strong></div>
            <div className="profile-identity-side-progress"><i style={{ width: `${progress}%` }} /></div>
          </aside>
        </div>
      </section>

      <div className="profile-public-layout">
        <div className="profile-public-primary">
          {allSections.map((section, sectionIndex) => {
            const isEditing = editing === section.title;
            const sectionRecords = isEditing ? draftRecords[section.title] || [] : records[section.title] || [];
            return <section id={`profile-section-${sectionIndex}`} className={`profile-section profile-public-section profile-section--${section.kind}`} key={section.title}>
              <header><div><h3>{section.title}</h3></div><div className="profile-actions">{isEditing && <button className="profile-button profile-button--quiet" onClick={cancelEdit}>取消</button>}<button className="profile-button" onClick={() => isEditing ? save(section) : beginEdit(section)}>{isEditing ? '保存' : '编辑'}</button></div></header>
              {section.kind === 'single' ? (isEditing ? <div className="profile-form">{section.fields.map((field) => <FormField key={field.key} field={field} value={draftValues[field.key] || ''} onChange={(value) => setDraftValues((current) => ({ ...current, [field.key]: value }))} />)}</div> : <div className="profile-read-grid">{section.fields.map((field) => <div className={`profile-read-item profile-read-item--${field.span || 'half'}`} key={field.key}><span>{field.label}</span><strong>{values[field.key] || '未填写'}</strong></div>)}</div>) : <>
                {isEditing && <div className="profile-form profile-form--repeat">{sectionRecords.map((item) => <div className="profile-record" key={item.id}><div className="profile-record-heading"><span>经历条目</span><button className="profile-remove" onClick={() => removeRecord(section.title, item.id)}>移除</button></div><div className="profile-form">{section.fields.map((field) => <FormField key={field.key} field={field} value={item[field.key] || ''} onChange={(value) => setDraftRecords((current) => ({ ...current, [section.title]: (current[section.title] || []).map((entry) => entry.id === item.id ? { ...entry, [field.key]: value } : entry) }))} />)}</div></div>)}</div>}
                {!isEditing && sectionRecords.map((item, index) => <RecordPreview key={item.id} item={item} fields={section.fields} index={index} />)}
                {!sectionRecords.length && !isEditing && <div className="profile-empty-state">还没有添加{section.title}，从一条经历开始。</div>}
                {isEditing && removed.filter((entry) => entry.section === section.title).map((entry) => <div className="profile-undo" key={entry.item.id}>已移除一条记录<button onClick={() => undoRecord(removed.findIndex((item) => item.item.id === entry.item.id))}>撤销</button></div>)}
                <button className="add-profile" onClick={() => addRecord(section)}>＋ 添加{section.title}</button>
              </>}
            </section>;
          })}
        </div>
        <ProfileSidebar sections={allSections.map((section, sectionIndex) => ({ id: `profile-section-${sectionIndex}`, title: section.title, description: section.eyebrow }))} />
      </div>
    </main>
    {message && <div className="profile-toast">{message}</div>}
  </div>;
}
