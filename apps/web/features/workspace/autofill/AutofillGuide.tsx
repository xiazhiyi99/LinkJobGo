"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { browserSteps, extensionDownloadFilename, installSteps, profilePreview, useSteps, type GuideScreenshot } from "./guide-content";
import styles from "./guide.module.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const downloadPath = `${basePath}/downloads/${encodeURIComponent(extensionDownloadFilename)}`;
const imageUrl = (image: GuideScreenshot) => `${basePath}/autofill-guide/${image.src}`;
const tutorials = {
  browser: { title: "安装浏览器", steps: browserSteps, next: "install" },
  install: { title: "安装扩展", steps: installSteps, next: "use" },
  use: { title: "开始使用", steps: useSteps, next: "use" },
} as const;
type GuideMode = keyof typeof tutorials;

export function AutofillGuide() {
  const [mode, setMode] = useState<GuideMode>("install");
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState("");
  const [zoomed, setZoomed] = useState<GuideScreenshot | null>(null);
  const lightbox = useRef<HTMLDialogElement>(null);
  const steps = tutorials[mode].steps;
  const current = steps[step];

  useEffect(() => {
    const dialog = lightbox.current;
    if (!dialog) return;
    if (zoomed && !dialog.open) dialog.showModal();
    if (!zoomed && dialog.open) dialog.close();
  }, [zoomed]);

  function selectMode(next: GuideMode) { setMode(next); selectStep(0); }
  function selectStep(next: number) { setStep(next); setCopied(""); }
  function nextStep() {
    if (step === steps.length - 1) selectMode(tutorials[mode].next);
    else selectStep(step + 1);
  }
  async function copyAddress(address: string) {
    try { await navigator.clipboard.writeText(address); setCopied("已复制，在新标签页地址栏粘贴即可"); }
    catch { setCopied(`请手动选中并复制：${address}`); }
  }
  const stepAction = current.action === "extensionsAddress" ? <div className={styles.copyBox}><code>chrome://extensions</code><button onClick={() => copyAddress("chrome://extensions")}>复制管理页地址</button><span role="status">{copied || "浏览器内部地址，需要在地址栏打开"}</span></div> : null;

  return <div className={styles.guide}>
    <section className={styles.intro} aria-labelledby="autofill-heading">
      <div>
        <span className={styles.eyebrow}>领客浏览器扩展</span>
        <h2 id="autofill-heading">资料备好，<br />重复填写交给领客。</h2>
        <p>把保存的个人资料带到招聘页面。<br />点击一次，开始填写你的网申简历。</p>
        <div className={styles.ctas}>
          <a className={styles.download} href={downloadPath} download={extensionDownloadFilename}><span aria-hidden="true">↓</span> 下载 Chrome 扩展</a>
          <Link href="/workspace/profile" className={styles.profileLink}>完善个人资料 <span aria-hidden="true">↗</span></Link>
        </div>
        <small className={styles.downloadNote}>桌面版 Chrome · ZIP 安装包 · 按下方图解安装</small>
      </div>
      <figure className={styles.introVisual}>
        <button onClick={() => setZoomed(profilePreview)} aria-label="放大领客界面实拍截图">
          <Image src={imageUrl(profilePreview)} width={profilePreview.width} height={profilePreview.height} alt={profilePreview.alt} unoptimized />
        </button>
        <figcaption>{profilePreview.caption}</figcaption>
      </figure>
    </section>

    <section className={styles.tutorial} aria-labelledby="guide-title">
      <div className={styles.tutorialHeading}><h3 id="guide-title">从安装到第一次填写</h3><p>点击步骤看实拍，点击截图可放大。</p></div>
      <div className={styles.modeSwitch} role="group" aria-label="教程类型">
        <button aria-pressed={mode === "browser"} onClick={() => selectMode("browser")}>安装浏览器</button>
        <button aria-pressed={mode === "install"} onClick={() => selectMode("install")}>安装扩展</button>
        <button aria-pressed={mode === "use"} onClick={() => selectMode("use")}>开始使用</button>
      </div>
      <div className={styles.walkthrough}>
        <div className={styles.instructions}>
          <ol>{steps.map((item, index) => <li key={item.title}><button aria-current={step === index ? "step" : undefined} onClick={() => selectStep(index)}><span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span><span><strong>{item.title}</strong><span className={styles.stepText}>{item.text}</span></span></button>{step === index && stepAction}</li>)}</ol>
          {mode === "browser" && <div className={styles.chromeInstall}>{step === 0 && <a href="https://www.google.cn/chrome/" target="_blank" rel="noopener noreferrer">下载 Chrome 浏览器 ↗</a>}<button onClick={() => selectMode("install")}>已安装，去安装扩展 →</button></div>}
          {mode === "use" && <p className={styles.tip}>更多填写选项，可点击浏览器右上角的领客扩展图标。</p>}
        </div>
        <figure className={styles.screenshot}>
          <div className={styles.screenshotHeading}><span>{tutorials[mode].title}图解</span><button onClick={() => setZoomed(current.screenshot)} aria-label={`放大截图：${current.title}`}>放大查看 ↗</button></div>
          <button className={styles.imageButton} onClick={() => setZoomed(current.screenshot)} aria-label={`查看${current.title}的完整截图`}>
            <Image src={imageUrl(current.screenshot)} width={current.screenshot.width} height={current.screenshot.height} alt={current.screenshot.alt} unoptimized />
          </button>
          <figcaption>{current.screenshot.caption}</figcaption>
          <div className={styles.screenshotFooter}><span>{String(step + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</span><button disabled={step === 0} onClick={() => selectStep(step - 1)}>上一步</button><button onClick={nextStep}>{step === steps.length - 1 ? mode === "use" ? "回到第一步" : `${tutorials[tutorials[mode].next].title} →` : "下一步 →"}</button></div>
        </figure>
      </div>
    </section>
    <aside className={styles.help}><strong>没有看到飞鼠？</strong><p>确认扩展已开启，再刷新招聘页面。若提示未登录，点击扩展内「前往网页登录」，登录后返回即可。</p></aside>

    <dialog ref={lightbox} className={styles.lightbox} aria-label="操作截图大图" onClose={() => setZoomed(null)} onClick={event => { if (event.target === event.currentTarget) setZoomed(null); }}>
      {zoomed && <div><header><span>{zoomed.caption}</span><button onClick={() => setZoomed(null)} aria-label="关闭截图大图">关闭 ×</button></header><Image src={imageUrl(zoomed)} width={zoomed.width} height={zoomed.height} alt={zoomed.alt} unoptimized /></div>}
    </dialog>
  </div>;
}
