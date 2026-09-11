"use client";
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

export type FeaturePreview = {
  title: string;
  description: string;
  previewTitle: string;
  summary: string;
  items: readonly { title: string; description: string }[];
};

export function PlaceholderPanel({ feature }: { feature: FeaturePreview }) {
  const scope = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.from(".workspace-enter", { y: 12, opacity: 0, duration: 0.45, stagger: 0.065, ease: "power2.out" });
  }, { scope, dependencies: [feature.title], revertOnUpdate: true });
  return <section ref={scope} className="feature-placeholder">
    <div className="feature-introduction workspace-enter"><span className="workspace-eyebrow">{feature.summary}</span><h2>{feature.title}</h2><p>{feature.description}</p></div>
    <div className="feature-stage workspace-enter">
      <div className="stage-copy"><span className="stage-symbol" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="12" y="7" width="26" height="34" rx="4"/><path d="M20 18h10M20 24h10M20 30h6M7 15v22a8 8 0 0 0 8 8"/></svg></span><h3>{feature.previewTitle}</h3><p>功能正在准备中。</p><span className="stage-status"><i aria-hidden="true"/>即将开放</span></div>
      <div className="preview-sheet" aria-label={`${feature.previewTitle}功能规划示意`}><div className="sheet-heading"><strong>{feature.previewTitle}</strong><span>功能预览</span></div>{feature.items.map((item) => <div className="sheet-row" key={item.title}><span className="sheet-row-symbol" aria-hidden="true"/><div><strong>{item.title}</strong><p>{item.description}</p></div><span className="sheet-row-state">待开放</span></div>)}<div className="sheet-note">静态示意 · 尚未保存任何数据</div></div>
    </div>
    <p className="workspace-footnote">静态占位 · 尚未连接真实数据</p>
  </section>;
}
