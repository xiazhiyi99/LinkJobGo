"use client";

import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const features = [
  { title: "资料中枢", body: "经历、项目和简历版本各就各位，随时准备出发。", className: "feature-a" },
  { title: "智能填写", body: "识别页面字段，匹配你的资料，确认之后一键完成填写。", className: "feature-b" },
  { title: "投递航迹", body: "从待投递到 Offer，每一次进展都留下可回看的路径；面试、测评和截止时间，也集中在下一步行动里。", className: "feature-c" },
  { title: "职位雷达", body: "把散落在不同招聘官网的机会，收进一个清晰的求职视野。", className: "feature-d", status: "测试中" },
];

export default function HomePage() {
  const page = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const context = gsap.context(() => {
      gsap.from(".hero-copy > *", { y: 42, opacity: 0, duration: 1, stagger: 0.12, ease: "power3.out" });
      gsap.from(".hero-visual", { scale: 0.86, rotate: 3, opacity: 0, duration: 1.3, delay: 0.25, ease: "power3.out" });
      gsap.to(".scrub-word", {
        opacity: 1,
        stagger: 0.06,
        scrollTrigger: { trigger: ".manifesto", start: "top 72%", end: "bottom 40%", scrub: true },
      });
      gsap.to(".pin-title", {
        yPercent: 8,
        scrollTrigger: { trigger: ".journey", start: "top top", end: "bottom bottom", scrub: true, pin: ".pin-title" },
      });
      gsap.utils.toArray<HTMLElement>(".journey-card").forEach((card) => {
        gsap.from(card, { y: 80, opacity: 0, scrollTrigger: { trigger: card, start: "top 86%", end: "top 58%", scrub: true } });
      });
    }, page);
    return () => context.revert();
  }, []);

  return (
    <main ref={page} className="page-shell overflow-x-hidden w-full max-w-full">
      <nav className="nav-wrap">
        <a className="wordmark" href="#top">领客<span>.</span></a>
        <div className="nav-links"><a href="#workflow">怎么工作</a><a href="#features">能力</a><a href="#workflow">开始使用</a></div>
        <a className="nav-login" href="#workflow">登录 <span>↗</span></a>
      </nav>

      <section id="top" className="hero section-space">
        <div className="hero-copy">
          <p className="eyebrow">AI 求职助手 / 2026</p>
          <h1>把求职的每一步，<em>领</em>到更好的机会。</h1>
          <p className="hero-lede">从发现职位、整理经历，到确认网申。领客把漫长的求职流程，变成一条清晰可走的路。</p>
          <div className="hero-actions"><a className="button button-dark" href="#workflow">开始使用 <span>↗</span></a><a className="text-link" href="#workflow">看看它如何工作 <span>↓</span></a></div>
        </div>
        <div className="hero-visual group"><div className="visual-orbit" /><div className="visual-card visual-card-main"><span className="card-kicker">TODAY / NEXT MOVE</span><strong>产品经理实习</strong><span className="card-meta">上海 · 互联网 · 12 min ago</span><div className="progress-line"><i /></div></div><div className="visual-card visual-card-float"><span>已为你准备</span><strong>8</strong><small>个下一步</small></div></div>
        <div className="hero-bottom"><span>让准备成为你的优势</span><span>↓ 向下探索</span></div>
      </section>

      <section id="features" className="features section-space">
        <div className="section-intro"><p className="eyebrow">你需要的，不止一份简历</p><h2>把复杂留给领客，<br /><span>把专注留给你。</span></h2></div>
        <div className="bento-grid grid-flow-dense">{features.map((feature) => <article key={feature.title} className={`feature-card ${feature.className} group`}><div><span className="feature-index">0{features.indexOf(feature) + 1}</span><h3>{feature.title}{feature.status && <small className="feature-status">（{feature.status}）</small>}</h3><p>{feature.body}</p></div><span className="arrow">↗</span></article>)}</div>
      </section>

      <section id="workflow" className="feature-details section-space">
        <article id="profile" className="detail-panel detail-blue"><div className="detail-number">01 / 03</div><div className="detail-copy"><p className="eyebrow">资料中枢</p><h2>你的经历，<br /><i>随时就位。</i></h2><p>教育经历、项目经验和简历版本集中管理。每一段认真走过的路，都能在下一次机会到来时准确出现。</p></div><div className="detail-visual profile-visual"><span className="visual-label">PROFILE / READY</span><strong>3</strong><small>份简历版本<br />已准备好</small></div></article>
        <article id="autofill" className="detail-panel detail-white"><div className="detail-number">02 / 03</div><div className="detail-copy"><p className="eyebrow">智能填写</p><h2>少一点重复，<br /><i>多一点专注。</i></h2><p>领客识别招聘页面字段，匹配你已经保存的资料。你负责确认，领客负责把每一个空格填得恰到好处。</p></div><div className="detail-visual autofill-visual"><span className="visual-label">FORM / MATCHED</span><div className="fake-field">姓名 <b>林 先生</b><em>✓</em></div><div className="fake-field">教育经历 <b>华南理工大学</b><em>✓</em></div><div className="fake-field">项目经历 <b>增长策略项目</b><em>✓</em></div></div></article>
        <article id="applications" className="detail-panel detail-navy"><div className="detail-number">03 / 03</div><div className="detail-copy"><p className="eyebrow">投递航迹</p><h2>知道现在，<br /><i>下一步去哪。</i></h2><p>从待投递、测评、面试到 Offer，所有进展都在一条清晰的航迹里。面试、测评和截止时间，也集中在你的下一步行动里。</p></div><div className="detail-visual track-visual"><span className="visual-label">APPLICATION / TRACK</span><div className="track-line"><i /><i /><i /><i /></div><div className="track-labels"><span>已投递</span><span>测评</span><span>面试</span><span>Offer</span></div></div></article>
      </section>

      <footer><a className="wordmark" href="#top">领客<span>.</span></a><span>为每一次认真准备，留一条更好的路径。</span><span>© 2026 领客</span></footer>
    </main>
  );
}
