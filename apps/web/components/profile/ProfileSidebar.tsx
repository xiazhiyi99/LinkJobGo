'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getActiveProfileSection,
  getProfileNavigationLayout,
  PROFILE_NAV_ROW_HEIGHT,
  PROFILE_SECTION_OFFSET,
  type ProfileNavigationClick,
  type ProfileSectionLink,
} from '../../features/profile/profile-navigation';
import { parseResumeText, type ResumeDraft } from '../../features/profile/resume-parser';
import { parseResumeWithAi } from '../../features/profile/profile-api';

const RAIL_TOP = 24;
const RAIL_BOTTOM = 24;

export function ProfileSidebar({ sections, onApplyResumeDraft }: {
  sections: ProfileSectionLink[];
  onApplyResumeDraft?: (draft: ResumeDraft) => Promise<void> | void;
}) {
  const railRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const clickedRef = useRef<ProfileNavigationClick | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? null);
  const [layout, setLayout] = useState({ columns: 1, rows: Math.max(1, sections.length) });
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft | null>(null);
  const [resumeStatus, setResumeStatus] = useState('');
  const [isApplyingResume, setIsApplyingResume] = useState(false);

  useEffect(() => {
    const rail = railRef.current;
    const list = listRef.current;
    if (!rail || !list) return;
    const targets = sections.map(({ id }) => document.getElementById(id))
      .filter((target): target is HTMLElement => Boolean(target));
    const desktop = window.matchMedia('(min-width: 981px)');
    let frame = 0;

    const update = () => {
      frame = 0;
      const viewport = {
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
      };
      const clicked = clickedRef.current;
      if (clicked && (Math.abs(clicked.scrollY - viewport.scrollY) > 2
        || Math.abs(clicked.scrollHeight - viewport.scrollHeight) > 2)) {
        clickedRef.current = null;
      }
      setActiveId(getActiveProfileSection(
        targets.map((target) => ({ id: target.id, top: target.getBoundingClientRect().top })),
        viewport,
        clickedRef.current,
      ));

      if (desktop.matches) {
        const top = Math.max(RAIL_TOP, rail.getBoundingClientRect().top);
        const height = `${Math.max(0, Math.floor(viewport.viewportHeight - top - RAIL_BOTTOM))}px`;
        if (rail.style.getPropertyValue('--profile-rail-height') !== height) {
          rail.style.setProperty('--profile-rail-height', height);
        }
      } else {
        rail.style.removeProperty('--profile-rail-height');
      }

      const nextLayout = desktop.matches
        ? getProfileNavigationLayout(sections.length, list.clientHeight)
        : { columns: 1, rows: Math.max(1, sections.length) };
      setLayout((current) => current.columns === nextLayout.columns && current.rows === nextLayout.rows
        ? current : nextLayout);
    };

    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const onResize = () => {
      clickedRef.current = null;
      scheduleUpdate();
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(list);
    observer.observe(rail);
    targets.forEach((target) => observer.observe(target));
    const content = targets[0]?.parentElement;
    if (content) observer.observe(content);
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', onResize);
    desktop.addEventListener('change', onResize);
    scheduleUpdate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', onResize);
      desktop.removeEventListener('change', onResize);
    };
  }, [sections]);

  const jumpToSection = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const top = window.scrollY + target.getBoundingClientRect().top - PROFILE_SECTION_OFFSET;
    // Explicitly bypass the marketing page's global smooth-scroll rule.
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' as ScrollBehavior });
    clickedRef.current = { id, scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight };
    setActiveId(id);
  };

  const handleResumeFile = async (file?: File) => {
    if (!file) return;
    const extension = file.name.toLowerCase().split('.').pop();
    if (!['txt', 'md', 'markdown'].includes(extension || '')) {
      setResumeDraft(null);
      setResumeStatus('已选择文件；PDF 和 Word 解析将在 API 接入后开放。');
      return;
    }
    try {
      const sourceText = await file.text();
      const localDraft = parseResumeText(sourceText, file.name);
      try {
        const response = await parseResumeWithAi({ filename: file.name, content: sourceText });
        const aiValues = Object.fromEntries(Object.entries({ ...response.data.profile, ...response.data.preferences }).filter(([, value]) => value != null && String(value).trim()));
        if (aiValues.city && !aiValues.homeCity) aiValues.homeCity = aiValues.city;
        const draft: ResumeDraft = {
          ...localDraft,
          values: { ...Object.fromEntries(Object.entries(aiValues).map(([key, value]) => [key, String(value)])), ...localDraft.values },
          records: { ...localDraft.records, ...(response.data.records || {}) },
        };
        setResumeDraft(draft);
        setResumeStatus(`AI 已读取 ${file.name}，请确认后保存。`);
      } catch {
        setResumeDraft(localDraft);
        setResumeStatus(`AI 服务暂不可用，已使用本地解析读取 ${file.name}，请确认后保存。`);
      }
    } catch {
      setResumeDraft(null);
      setResumeStatus('文件读取失败，请重新选择。');
    }
  };

  const applyResumeDraft = async () => {
    if (!resumeDraft || !onApplyResumeDraft) return;
    setIsApplyingResume(true);
    try {
      await onApplyResumeDraft(resumeDraft);
      setResumeStatus('简历内容已保存到资料草稿。');
    } catch {
      setResumeStatus('资料保存失败，请确认 API 已启动后重试。');
    } finally {
      setIsApplyingResume(false);
    }
  };

  return (
    <aside className="profile-public-secondary" ref={railRef}>
      <section className="profile-side-card profile-resume-card" id="resume-parser">
        <div className="profile-card-heading">
          <div><h2>AI 简历解析</h2></div>
        </div>
        <p>上传 PDF、Word 或 Markdown 简历，生成待确认的资料草稿。</p>
        <input
          ref={fileInputRef}
          className="profile-resume-input"
          type="file"
          accept=".txt,.md,.markdown,.pdf,.doc,.docx"
          onChange={(event) => { void handleResumeFile(event.target.files?.[0]); event.currentTarget.value = ''; }}
        />
        <button className="profile-secondary-action profile-secondary-action--wide" onClick={() => fileInputRef.current?.click()}>
          选择简历文件
        </button>
        {resumeStatus && <p className="profile-resume-status" role="status">{resumeStatus}</p>}
        {resumeDraft && <div className="profile-resume-draft">
          <strong>{resumeDraft.values.name || '未识别姓名'}</strong>
          <span>{[resumeDraft.values.targetTitles, resumeDraft.values.email].filter(Boolean).join(' · ') || '已生成待确认资料'}</span>
          <button className="profile-primary-action profile-primary-action--wide" onClick={() => void applyResumeDraft()} disabled={isApplyingResume}>
            {isApplyingResume ? '保存中…' : '保存到个人资料'}
          </button>
        </div>}
      </section>

      <nav className="profile-section-map" aria-label="资料目录">
        <div className="profile-outline-heading"><span>资料目录</span><span>{sections.length} 个分区</span></div>
        <div
          ref={listRef}
          className="profile-map-list"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.rows}, ${PROFILE_NAV_ROW_HEIGHT}px)`,
          }}
        >
          {sections.map((section, index) => (
            <button
              className="profile-map-item"
              key={section.id}
              aria-current={activeId === section.id ? 'location' : undefined}
              aria-controls={section.id}
              data-column-start={index % layout.rows === 0 ? 'true' : undefined}
              onClick={() => jumpToSection(section.id)}
            >
              <span className="profile-map-node" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className="profile-map-copy"><strong>{section.title}</strong></span>
            </button>
          ))}
        </div>
      </nav>
    </aside>
  );
}
