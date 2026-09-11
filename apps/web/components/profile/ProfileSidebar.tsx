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

const RAIL_TOP = 24;
const RAIL_BOTTOM = 24;

export function ProfileSidebar({ sections }: { sections: ProfileSectionLink[] }) {
  const railRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const clickedRef = useRef<ProfileNavigationClick | null>(null);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? null);
  const [layout, setLayout] = useState({ columns: 1, rows: Math.max(1, sections.length) });

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

  return (
    <aside className="profile-public-secondary" ref={railRef}>
      <section className="profile-side-card profile-resume-card" id="resume-parser">
        <div className="profile-card-heading">
          <div><span className="profile-overline">简历管理</span><h2>AI 简历解析</h2></div>
          <span className="coming-soon">即将开放</span>
        </div>
        <p>上传 PDF、Word 或 Markdown 简历，生成待确认的资料草稿。</p>
        <button className="profile-primary-action profile-primary-action--wide" disabled>功能即将开放</button>
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
              <span className="profile-map-copy"><strong>{section.title}</strong><small>{section.description}</small></span>
            </button>
          ))}
        </div>
      </nav>
    </aside>
  );
}
