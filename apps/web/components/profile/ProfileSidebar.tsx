'use client';

import { useRef, useState } from 'react';
import type { ProfileSectionLink } from '../../features/profile/profile-navigation';
import { parseResumeText, type ResumeDraft } from '../../features/profile/resume-parser';
import { parseResumeFileWithAi } from '../../features/profile/profile-api';

const contentTypeForExtension = (extension?: string) => extension === 'pdf'
  ? 'application/pdf'
  : extension === 'doc'
    ? 'application/msword'
    : extension === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'text/plain';

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
  reader.onload = () => {
    const result = String(reader.result || '');
    const comma = result.indexOf(',');
    resolve(comma >= 0 ? result.slice(comma + 1) : result);
  };
  reader.readAsDataURL(file);
});

const asString = (value: unknown) => Array.isArray(value) ? value.join('、') : value == null ? '' : String(value);
const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

type ResumePhase = 'idle' | 'reading' | 'parsing' | 'parsed' | 'applying' | 'completed' | 'conflict' | 'error';

/** Converts the canonical API response into the section names used by the profile editor. */
const aiResponseToDraft = (response: Record<string, unknown>, sourceName: string, sourceText: string, fallback: ResumeDraft): ResumeDraft => {
  // Use the canonical normalized sections for the editor. The database-ready
  // preview intentionally flattens campus/award/publication records into the
  // existing Prisma tables, so using it here would display campus entries as
  // work experience. Keep it only as a compatibility fallback.
  const envelope = asRecord(response.normalized || (asRecord(response.data).data || response.data) || response.databaseReady || response);
  const profile = asRecord(envelope.profile);
  const preferences = asRecord(envelope.preferences);
  const records = asRecord(envelope.records);
  const values: Record<string, string> = {};
  const aliases: Record<string, string> = {
    city: 'homeCity', personalWebsite: 'website', githubUrl: 'github', location: 'homeCity',
    targetTitle: 'targetTitles', targetCity: 'targetCities', industry: 'targetIndustries',
  };
  for (const [key, value] of Object.entries({ ...profile, ...preferences })) {
    if (value == null || (typeof value === 'string' && !value.trim())) continue;
    values[aliases[key] || key] = asString(value);
  }
  const map = (key: string) => Array.isArray(records[key]) ? records[key].map((item) => {
    const record = asRecord(item);
    return Object.fromEntries(Object.entries(record).map(([field, value]) => [field, asString(value)]));
  }) : [];
  const skillItems = map('skills').flatMap((item) => {
    const grouped = item.items ? String(item.items).split('、').map((name) => { const { items: _items, ...rest } = item; return { ...rest, name }; }) : [item];
    return grouped;
  });
  const languageItems = map('languages').map((item) => ({ ...item, language: item.language || item.name || '' }));
  const resultRecords: ResumeDraft['records'] = {
    教育经历: map('educations'),
    '工作/实习经历': map('experiences'),
    项目经历: map('projects'),
    获奖经历: map('awards'),
    '论文与专利': [...map('publications'), ...map('patents')],
    在校经历: map('campusExperiences'),
    语言能力: [...languageItems, ...skillItems.filter((item) => item.kind === 'language')],
    证书信息: [...map('certificates'), ...skillItems.filter((item) => item.kind === 'certificate')],
    技能: skillItems.filter((item) => !item.kind || item.kind === 'skill'),
  };
  const hasData = Object.keys(values).length > 0 || Object.values(resultRecords).some((items) => items.length > 0);
  return {
    sourceName,
    sourceText,
    sourceContentType: sourceName.toLowerCase().endsWith('.txt') || /\.md(own)?$/i.test(sourceName) ? 'text/plain' : undefined,
    sourceStored: false,
    values: hasData ? values : fallback.values,
    records: hasData ? resultRecords : fallback.records,
  };
};

export function ProfileSidebar({ sections, activeId, onApplyResumeDraft, existingValues = {}, onSelectSection, completion, filledFieldCount, experienceCount }: {
  sections: ProfileSectionLink[];
  activeId: string;
  onApplyResumeDraft?: (draft: ResumeDraft, options?: { replaceFields?: string[]; keepFields?: string[] }) => Promise<void> | void;
  existingValues?: Record<string, string>;
  onSelectSection: (id: string) => void;
  completion?: number;
  filledFieldCount?: number;
  experienceCount?: number;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft | null>(null);
  const [resumePhase, setResumePhase] = useState<ResumePhase>('idle');
  const [resumeStatus, setResumeStatus] = useState('');
  const [isApplyingResume, setIsApplyingResume] = useState(false);
  const [conflicts, setConflicts] = useState<Array<{ key: string; label: string; current: string; incoming: string }>>([]);
  const [replaceFields, setReplaceFields] = useState<string[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  const updateResumeStatus = (phase: ResumePhase, message: string) => {
    setResumePhase(phase);
    setResumeStatus(message);
  };

  const fieldLabels: Record<string, string> = {
    name: '姓名', phone: '手机号', gender: '性别', birthday: '出生日期', email: '邮箱',
    homeCity: '所在城市', city: '所在城市', nativePlace: '籍贯', highestEducation: '最高学历',
    targetTitles: '期望职位', targetCities: '期望城市', targetIndustries: '期望行业', employmentType: '工作类型',
    availableFrom: '到岗时间', salaryExpectation: '期望薪资', selfIntroduction: '自我介绍', website: '个人主页', personalWebsite: '个人主页', github: 'GitHub / 作品集', githubUrl: 'GitHub / 作品集',
  };

  const applyDraftImmediately = async (draft: ResumeDraft, fields: string[] = [], keep: string[] = []) => {
    if (!onApplyResumeDraft) return;
    setIsApplyingResume(true);
    updateResumeStatus('applying', '解析完成，正在写入资料…');
    try {
      await onApplyResumeDraft(draft, { replaceFields: fields, keepFields: keep });
      updateResumeStatus('completed', `解析完成，已导入 ${draft.sourceName}，经历条目已追加到资料。`);
      setShowConflictDialog(false);
    } catch (error) {
      const detail = error as { status?: number; payload?: { conflicts?: Array<{ path?: string; field?: string; existing?: unknown; incoming?: unknown }> } };
      if (detail.status === 409 && detail.payload?.conflicts?.length) {
        const serverConflicts = detail.payload.conflicts.map((item) => ({ key: item.field || item.path || '', label: fieldLabels[item.field || ''] || item.field || item.path || '资料字段', current: String(item.existing ?? ''), incoming: String(item.incoming ?? '') }));
        setConflicts(serverConflicts);
        setReplaceFields([]);
        setShowConflictDialog(true);
        updateResumeStatus('conflict', '解析完成，检测到已有资料与简历内容冲突，请选择需要覆盖的字段。');
        return;
      }
      throw error;
    } finally {
      setIsApplyingResume(false);
    }
  };

  const inspectAndApply = (draft: ResumeDraft) => {
    setResumeDraft(draft);
    const valueAliases: Record<string, string> = { city: 'homeCity', homeCity: 'city', personalWebsite: 'website', website: 'personalWebsite', githubUrl: 'github', github: 'githubUrl' };
    const nextConflicts = Object.entries(draft.values)
      .map(([key, value]) => [key, value, existingValues[key] || existingValues[valueAliases[key]]] as const)
      .filter(([key, value, current]) => key !== 'email' && String(value || '').trim() && String(current || '').trim() && String(current).trim() !== String(value).trim())
      .map(([key, value, current]) => ({ key, label: fieldLabels[key] || key, current: String(current), incoming: String(value) }));
    if (nextConflicts.length) {
      setConflicts(nextConflicts);
      setReplaceFields([]);
      setShowConflictDialog(true);
      updateResumeStatus('conflict', '解析完成，检测到已有资料与简历内容冲突，请选择需要覆盖的字段。');
      return;
    }
    void applyDraftImmediately(draft).catch(() => updateResumeStatus('error', '资料保存失败，请确认 API 已启动后重试。'));
  };

  const handleResumeFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      setResumeDraft(null);
      updateResumeStatus('error', '文件不能超过 12MB，请压缩后重试。');
      return;
    }
    const extension = file.name.toLowerCase().split('.').pop();
    const textFile = ['txt', 'md', 'markdown'].includes(extension || '');
    const binaryFile = ['pdf', 'docx'].includes(extension || '');
    if (!textFile && !binaryFile) {
      setResumeDraft(null);
      updateResumeStatus('error', '请选择 TXT、Markdown、PDF 或 DOCX 简历。');
      return;
    }
    try {
      // A new upload starts a fresh state machine; do not leave the previous
      // draft visible while the new file is being read or parsed.
      setResumeDraft(null);
      setShowConflictDialog(false);
      setConflicts([]);
      setReplaceFields([]);
      updateResumeStatus('reading', `正在读取 ${file.name}…`);
      if (textFile) {
        const sourceText = await file.text();
        const localDraft = parseResumeText(sourceText, file.name);
        // Keep text uploads on the same server pipeline as PDF/DOCX uploads.
        // `/ai/resume/parse` is the raw extraction endpoint; `/ai/resume/parse-file`
        // also runs the canonical normalizer and returns the database-ready shape
        // consumed by this editor.
        const contentBase64 = await fileToBase64(file);
        updateResumeStatus('parsing', '正在解析简历，请稍候…');
        try {
          const response = await parseResumeFileWithAi({ filename: file.name, contentType: file.type || contentTypeForExtension(extension), contentBase64 });
          updateResumeStatus('parsed', '解析完成，正在整理资料…');
          inspectAndApply(aiResponseToDraft(response as unknown as Record<string, unknown>, file.name, sourceText, localDraft));
        } catch {
          updateResumeStatus('parsed', '解析完成，正在整理资料…');
          inspectAndApply(localDraft);
        }
        return;
      }

      const contentBase64 = await fileToBase64(file);
      updateResumeStatus('parsing', '正在解析简历，请稍候…');
      const response = await parseResumeFileWithAi({ filename: file.name, contentType: file.type || contentTypeForExtension(extension), contentBase64 });
      updateResumeStatus('parsed', '解析完成，正在整理资料…');
      const draft = aiResponseToDraft(response as unknown as Record<string, unknown>, file.name, '', { values: {}, records: {}, sourceName: file.name, sourceText: '' });
      draft.sourceFingerprint = response.requestId || `${file.name}:${file.size}:${file.lastModified}`;
      inspectAndApply(draft);
    } catch {
      setResumeDraft(null);
      updateResumeStatus('error', '简历解析失败，请检查文件后重试。');
    }
  };

  const confirmConflictImport = async () => {
    if (!resumeDraft) return;
    try {
      await applyDraftImmediately(resumeDraft, replaceFields, conflicts.filter((item) => !replaceFields.includes(item.key)).map((item) => item.key));
    } catch {
      updateResumeStatus('error', '资料保存失败，请确认 API 已启动后重试。');
    }
  };

  return (
    <section className="profile-tools" aria-label="资料工具">
      <div className="profile-tools-summary" aria-label="资料概览">
        <div className="profile-tools-progress">
          <div className="profile-tools-progress-heading"><span>资料完成度</span><strong>{completion ?? 0}%</strong></div>
          <div className="profile-tools-progress-bar" role="progressbar" aria-label="资料完成度" aria-valuenow={completion ?? 0} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${completion ?? 0}%` }} /></div>
        </div>
        <div className="profile-tools-stats">
          <div><strong>{filledFieldCount ?? 0}</strong><span>已填写字段</span></div>
          <div><strong>{experienceCount ?? 0}</strong><span>经历条目</span></div>
          <div><strong>3</strong><span>核心功能</span></div>
        </div>
        <div className="profile-parser-control" id="resume-parser">
          <input
            ref={fileInputRef}
            className="profile-resume-input"
            type="file"
            accept=".txt,.md,.markdown,.pdf,.docx"
            onChange={(event) => { void handleResumeFile(event.target.files?.[0]); event.currentTarget.value = ''; }}
          />
          <button className="profile-parser-button" onClick={() => fileInputRef.current?.click()} disabled={isApplyingResume || resumePhase === 'reading' || resumePhase === 'parsing'}>
            <span aria-hidden="true">✦</span> AI 简历解析
          </button>
        </div>
      </div>
      <nav className="profile-section-map" aria-label="资料目录">
        <div ref={tabsRef} className="profile-map-list" role="tablist" aria-label="资料模块">
          {sections.map((section, index) => (
            <button
              type="button"
              role="tab"
              id={`tab-${section.id}`}
              className="profile-map-item"
              key={section.id}
              aria-selected={activeId === section.id}
              tabIndex={activeId === section.id ? 0 : -1}
              aria-controls={section.id}
              onClick={() => onSelectSection(section.id)}
              onKeyDown={(event) => {
                let nextIndex: number;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % sections.length;
                else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + sections.length) % sections.length;
                else if (event.key === 'Home') nextIndex = 0;
                else if (event.key === 'End') nextIndex = sections.length - 1;
                else return;
                event.preventDefault();
                onSelectSection(sections[nextIndex].id);
                tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
              }}
            >
              <span className="profile-map-node" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className="profile-map-copy"><strong>{section.title}</strong></span>
            </button>
          ))}
        </div>
      </nav>
      {resumeStatus && <span className="profile-parser-status" data-state={resumePhase} role="status" aria-live="polite"><span className="profile-resume-status-dot" aria-hidden="true" />{resumeStatus}</span>}
      {showConflictDialog && resumeDraft && <div className="profile-conflict-backdrop" role="presentation">
        <section className="profile-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-conflict-title">
          <div className="profile-card-heading"><div><h2 id="profile-conflict-title">发现资料冲突</h2><p>经历和项目会直接追加；以下个人信息已有不同内容，请选择是否覆盖。</p></div></div>
          <div className="profile-conflict-list">
            {conflicts.map((item) => <label className="profile-conflict-item" key={item.key}>
              <input type="checkbox" checked={replaceFields.includes(item.key)} onChange={(event) => setReplaceFields((current) => event.target.checked ? [...current, item.key] : current.filter((key) => key !== item.key))} />
              <span><strong>{item.label}</strong><em>现有：{item.current}</em><em>简历：{item.incoming}</em></span>
            </label>)}
          </div>
          <div className="profile-conflict-actions"><button className="profile-button profile-button--quiet" onClick={() => { setShowConflictDialog(false); updateResumeStatus('conflict', '已保留原有个人信息，经历仍会追加。'); void applyDraftImmediately(resumeDraft, [], conflicts.map((item) => item.key)); }}>保留原内容</button><button className="profile-primary-action" onClick={() => void confirmConflictImport()} disabled={isApplyingResume}>{isApplyingResume ? '保存中…' : '保存并覆盖已选'}</button></div>
        </section>
      </div>}
    </section>
  );
}
