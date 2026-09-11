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
        <div className="nav-links"><a href="#workflow">怎么工作</a><a href="#features">能力</a><a href="#start">开始使用</a></div>
        <a className="nav-login" href="#start">登录 <span>↗</span></a>
      </nav>

      <section id="top" className="hero section-space">
        <div className="hero-copy">
          <p className="eyebrow">AI 求职助手 / 2026</p>
          <h1>把求职的每一步，<em>领</em>到更好的机会。</h1>
          <p className="hero-lede">从发现职位、整理经历，到确认网申。领客把漫长的求职流程，变成一条清晰可走的路。</p>
          <div className="hero-actions"><a className="button button-dark" href="#start">开始使用 <span>↗</span></a><a className="text-link" href="#workflow">看看它如何工作 <span>↓</span></a></div>
        </div>
        <div className="hero-visual group"><div className="visual-orbit" /><div className="visual-card visual-card-main"><span className="card-kicker">TODAY / NEXT MOVE</span><strong>产品经理实习</strong><span className="card-meta">上海 · 互联网 · 12 min ago</span><div className="progress-line"><i /></div></div><div className="visual-card visual-card-float"><span>已为你准备</span><strong>8</strong><small>个下一步</small></div></div>
        <div className="hero-bottom"><span>让准备成为你的优势</span><span>↓ 向下探索</span></div>
      </section>

      <section id="features" className="features section-space">
        <div className="section-intro"><p className="eyebrow">你需要的，不止一份简历</p><h2>把复杂留给领客，<br /><span>把专注留给你。</span></h2></div>
        <div className="bento-grid grid-flow-dense">{features.map((feature) => <article key={feature.title} className={`feature-card ${feature.className} group`}><div><span className="feature-index">0{features.indexOf(feature) + 1}</span><h3>{feature.title}{feature.status && <small className="feature-status">（{feature.status}）</small>}</h3><p>{feature.body}</p></div><span className="arrow">↗</span></article>)}</div>
      </section>

      <section id="workflow" className="journey section-space"><div className="pin-title"><p className="eyebrow">从打开岗位，到准备出发</p><h2>让每个<br /><i>下一步</i><br />更确定。</h2></div><div className="journey-stack"><article className="journey-card"><span>01</span><h3>发现机会</h3><p>浏览你熟悉的招聘网站，领客帮你把值得关注的职位保存下来。</p></article><article className="journey-card"><span>02</span><h3>匹配资料</h3><p>岗位要求与个人经历自动建立联系，每次申请都有恰到好处的准备。</p></article><article className="journey-card"><span>03</span><h3>确认填写</h3><p>看见、核对、填写。最终决定始终在你手里。</p></article></div></section>

      <footer><a className="wordmark" href="#top">领客<span>.</span></a><span>为每一次认真准备，留一条更好的路径。</span><span>© 2026 领客</span></footer>
    </main>
  );
}
