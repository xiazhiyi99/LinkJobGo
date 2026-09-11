"use client";

import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const features = [
  { title: "资料中枢", body: "经历、项目和简历版本各就各位，随时准备出发。", href: "#profile" },
  { title: "智能填写", body: "识别页面字段，匹配你的资料，确认之后一键完成填写。", href: "#autofill" },
  { title: "投递航迹", body: "从待投递到 Offer，每一次进展都有清晰记录。", href: "#applications" },
  { title: "职位雷达", body: "把散落在不同招聘官网的机会，收进一个清晰的求职视野。", href: "#features", status: "测试中" },
];

export default function HomePage() {
  const page = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const context = gsap.context(() => {
      gsap.from(".hero-copy > *", { y: 18, opacity: 0, duration: 0.6, stagger: 0.08, ease: "power2.out" });
      gsap.from(".product-preview", { y: 18, opacity: 0, duration: 0.7, delay: 0.18, ease: "power2.out" });
      gsap.utils.toArray<HTMLElement>(".reveal").forEach((element) => {
        gsap.from(element, { y: 24, opacity: 0, duration: 0.55, ease: "power2.out", scrollTrigger: { trigger: element, start: "top 86%", once: true } });
      });
    }, page);
    return () => context.revert();
  }, []);

  return (
    <main ref={page} className="page-shell overflow-x-hidden w-full max-w-full">
      <nav className="nav-wrap">
        <a className="wordmark" href="#top">领客<span>.</span></a>
        <div className="nav-links"><a href="#features">功能</a><a href="#profile">资料中枢</a><a href="#autofill">智能填写</a><a href="#applications">投递航迹</a></div>
        <a className="nav-login" href="#workflow">登录</a>
      </nav>

      <section id="top" className="hero section-space">
        <div className="hero-copy">
          <p className="eyebrow">AI 求职助手</p>
          <h1>让每一次求职准备，<span>更清晰。</span></h1>
          <p className="hero-lede">从发现职位、整理经历，到确认网申，领客把求职流程放在一个地方。</p>
          <div className="hero-actions"><a className="button button-primary" href="#workflow">开始使用</a><a className="text-link" href="#features">了解功能 <span>↓</span></a></div>
        </div>
        <div className="product-preview" aria-label="领客产品界面示意">
          <div className="preview-top"><span>领客工作台</span><span className="preview-dot" /></div>
          <div className="preview-body"><div className="preview-sidebar"><span className="active">工作台</span><span>我的资料</span><span>投递记录</span></div><div className="preview-content"><span className="preview-label">今日进展</span><strong>3 个下一步</strong><div className="preview-task"><i />确认产品经理实习网申</div><div className="preview-task"><i />准备明日面试问题</div><div className="preview-task muted"><i />更新项目经历</div></div></div>
        </div>
        <div className="hero-bottom"><span>职位 · 资料 · 投递</span><span>向下了解领客</span></div>
      </section>

      <section id="features" className="features section-space">
        <div className="section-intro reveal"><div><p className="eyebrow">一个工作台，处理求职中的重要事情</p><h2>从准备开始，<br /><span>让行动更有把握。</span></h2></div><p className="section-note">领客把信息、工具和进度放在一起，减少重复操作，把时间留给真正重要的准备。</p></div>
        <div className="feature-grid grid-flow-dense">{features.map((feature, index) => <a key={feature.title} href={feature.href} className="feature-card reveal"><span className="feature-index">0{index + 1}</span><div><h3>{feature.title}{feature.status && <small>（{feature.status}）</small>}</h3><p>{feature.body}</p></div><span className="arrow">↗</span></a>)}</div>
      </section>

      <section id="workflow" className="feature-details">
        <article id="profile" className="detail-panel detail-blue reveal"><div className="detail-copy"><p className="eyebrow">资料中枢</p><h2>你的经历，<br /><span>随时就位。</span></h2><p>教育经历、项目经验和简历版本集中管理。每一段认真走过的路，都能在下一次机会到来时准确出现。</p></div><div className="detail-visual profile-visual"><span className="visual-label">我的资料</span><strong>已完成</strong><div className="profile-progress"><i /></div><small>个人资料完整度 86%</small></div></article>
        <article id="autofill" className="detail-panel detail-white reveal"><div className="detail-copy"><p className="eyebrow">智能填写</p><h2>少一点重复，<br /><span>多一点专注。</span></h2><p>领客识别招聘页面字段，匹配你已经保存的资料。你负责确认，领客负责把每一个空格填得恰到好处。</p></div><div className="detail-visual autofill-visual"><span className="visual-label">网申字段匹配</span><div className="fake-field">姓名 <b>林 先生</b><em>已匹配</em></div><div className="fake-field">教育经历 <b>华南理工大学</b><em>已匹配</em></div><div className="fake-field">项目经历 <b>增长策略项目</b><em>已匹配</em></div></div></article>
        <article id="applications" className="detail-panel detail-soft reveal"><div className="detail-copy"><p className="eyebrow">投递航迹</p><h2>知道现在，<br /><span>下一步去哪。</span></h2><p>从待投递、测评、面试到 Offer，所有进展都在一条清晰的时间线上。不错过截止时间，也不忘记已经走过的路。</p></div><div className="detail-visual track-visual"><span className="visual-label">投递进度</span><div className="status-list"><div><i className="done" /><span>已投递</span><b>3</b></div><div><i className="current" /><span>面试中</span><b>1</b></div><div><i /><span>待处理</span><b>2</b></div></div></div></article>
      </section>

      <footer><a className="wordmark" href="#top">领客<span>.</span></a><span>为每一次认真准备，留一条更好的路径。</span><span>© 2026 领客</span></footer>
    </main>
  );
}
