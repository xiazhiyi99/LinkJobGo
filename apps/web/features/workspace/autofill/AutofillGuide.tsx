"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./guide.module.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const installSteps = [
  { title: "下载并解压", text: "下载扩展安装包，解压到一个固定文件夹。安装后请保留这个文件夹。" },
  { title: "打开扩展管理", text: "复制下方地址，在 Chrome 新标签页的地址栏粘贴并打开。" },
  { title: "加载领客扩展", text: "打开右上角「开发者模式」，点击「加载已解压的扩展程序」，选择解压后的 lingke-extension 文件夹。" },
];
const useSteps = [
  { title: "准备好个人资料", text: "在领客完善个人资料并保持网页登录，扩展会自动使用当前账号的资料。" },
  { title: "打开招聘表单", text: "进入目标岗位的简历填写页。刚装好扩展？先刷新一下页面。" },
  { title: "让飞鼠帮你填写", text: "鼠标移到页面上的飞鼠，点击「开始填写」。进度会显示在飞鼠下方。" },
  { title: "核对后，自行提交", text: "检查填写结果，补充缺失内容，再提交申请。领客不会替你点击提交。" },
];

export function AutofillGuide() {
  const [mode, setMode] = useState<"install" | "use">("install");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState("");
  const steps = mode === "install" ? installSteps : useSteps;
  useEffect(() => {
    if (!playing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPlaying(false); return; }
    const timer = setInterval(() => setStep(value => (value + 1) % steps.length), 3600);
    return () => clearInterval(timer);
  }, [playing, steps.length]);
  function selectMode(next: typeof mode) { setMode(next); setStep(0); setPlaying(false); }
  async function copyAddress() {
    try { await navigator.clipboard.writeText("chrome://extensions"); setCopied("已复制，在新标签页地址栏粘贴即可"); }
    catch { setCopied("请手动选中并复制：chrome://extensions"); }
  }
  return <div className={styles.guide}>
    <section className={styles.intro} aria-labelledby="autofill-heading">
      <div>
        <span className={styles.eyebrow}>领客浏览器扩展</span>
        <h2 id="autofill-heading">资料备好，<br />重复填写交给领客。</h2>
        <p>把保存的个人资料带到招聘页面。<br />点击一次，开始填写你的网申简历。</p>
        <div className={styles.ctas}>
          <a className={styles.download} href={`${basePath}/downloads/lingke-extension.zip`} download="lingke-extension.zip"><span aria-hidden="true">↓</span> 下载 Chrome 扩展</a>
          <Link href="/workspace/profile" className={styles.profileLink}>完善个人资料 <span aria-hidden="true">↗</span></Link>
        </div>
        <small className={styles.downloadNote}>桌面版 Chrome · ZIP 安装包 · 按下方教程安装</small>
      </div>
      <div className={styles.introVisual} aria-label="领客将个人资料填写到招聘表单的示意">
        <div className={styles.resumeSheet}><span>我的资料</span><strong>教育经历</strong><div /><div /><small>工作经历 · 项目经历</small></div>
        <div className={styles.transfer} aria-hidden="true">→</div>
        <div className={styles.formSheet}><span>招聘表单</span>{["姓名", "学校", "专业"].map((label, index) => <div className={styles.previewField} key={label}><span>{label}</span><i style={{ animationDelay: `${index * 180}ms` }} /><b aria-hidden="true">✓</b></div>)}</div>
        <span className={styles.visualCaption}>资料只需维护一份</span>
      </div>
    </section>

    <section className={styles.tutorial} aria-labelledby="guide-title">
      <div className={styles.tutorialHeading}><div><h3 id="guide-title">从安装到第一次填写</h3><p>跟着演示走，随时点击步骤查看。</p></div><button className={styles.play} onClick={() => setPlaying(!playing)} aria-pressed={playing}>{playing ? "暂停演示" : "播放演示"}<span aria-hidden="true">{playing ? "Ⅱ" : "▷"}</span></button></div>
      <div className={styles.modeSwitch} role="group" aria-label="教程类型">
        <button aria-pressed={mode === "install"} onClick={() => selectMode("install")}>安装扩展</button>
        <button aria-pressed={mode === "use"} onClick={() => selectMode("use")}>开始使用</button>
      </div>
      <div className={styles.walkthrough}>
        <div className={styles.instructions}>
          <ol>{steps.map((item, index) => <li key={item.title}><button aria-current={step === index ? "step" : undefined} onClick={() => { setStep(index); setPlaying(false); }}><span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span><span><strong>{item.title}</strong><span className={styles.stepText}>{item.text}</span></span></button></li>)}</ol>
          {mode === "install" ? <div className={styles.copyBox}><code>chrome://extensions</code><button onClick={copyAddress}>复制地址</button><span role="status">{copied || "浏览器内部地址，需要在地址栏打开"}</span></div> : <p className={styles.tip}>更多填写选项，可点击浏览器右上角的领客扩展图标。</p>}
        </div>
        <div className={styles.demo}>
          <div className={styles.browserBar}><span aria-hidden="true">● ● ●</span><span>{mode === "install" ? (step === 0 ? "下载文件" : "chrome://extensions") : (step === 0 ? "领客 · 个人资料" : "招聘网站 · 填写简历")}</span><small>操作示意</small></div>
          <div key={`${mode}-${step}`} className={styles.scene}>
            {mode === "install" ? <>
              {step === 0 ? <div className={styles.unpack}><div className={styles.zipIcon}>ZIP</div><span className={styles.unpackArrow}>↓ 解压</span><div className={styles.folder}><strong>lingke-extension</strong><span>manifest.json</span><span>content.js</span><span>…</span></div></div> : <div className={styles.extensionsDemo}>
                <div className={styles.extensionTitle}><strong>扩展程序</strong><span>开发者模式 <i className={step === 2 ? styles.toggleOn : styles.toggle} /></span></div>
                <span className={step === 2 ? styles.loadActive : styles.loadButton}>加载已解压的扩展程序</span>
                {step === 1 ? <div className={styles.emptyDemo}>先打开右上角的开发者模式</div> : <div className={styles.installed}><b>领</b><div><strong>领客 · 平台填写</strong><span>已加载，可以开始填写</span></div><em>✓</em></div>}
              </div>}
            </> : <div className={styles.fillDemo}>
              <div className={styles.formTitle}><strong>{step === 0 ? "个人资料" : "个人信息"}</strong><span>{step === 3 ? "待你核对" : "简历填写"}</span></div>
              {[["姓名", "林同学"], ["学校", "示例大学"], ["专业", "计算机科学与技术"]].map(([label, value], index) => <div className={styles.fillRow} key={label}><span>{label}</span><div>{step !== 1 ? <b className={step === 2 ? styles.fillValue : ""} style={{ animationDelay: `${index * 450}ms` }}>{value}</b> : <i>请输入{label}</i>}</div></div>)}
              {step === 0 ? <span className={styles.saved}>✓ 已保存，扩展自动使用网页登录状态</span> : <div className={styles.demoPet}><span className={styles.squirrel} style={{ backgroundImage: `url(${basePath}/downloads/squirrel-motion.webp)` }} role="img" aria-label="领客飞鼠" /><span className={styles.petBubble}>{step === 1 ? "开始填写" : step === 2 ? "正在填写个人信息…" : "填写结束，请核对"}</span></div>}
            </div>}
          </div>
          <div className={styles.demoFooter}><span>{String(step + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</span><span aria-live={playing ? "off" : "polite"}>{steps[step].title}</span><button onClick={() => { setStep((step + 1) % steps.length); setPlaying(false); }} aria-label="查看下一步">下一步 →</button></div>
        </div>
      </div>
    </section>
    <aside className={styles.help}><strong>没有看到飞鼠？</strong><p>确认扩展已开启，再刷新招聘页面。若提示未登录，点击扩展内「前往网页登录」，登录后返回即可。</p><a href="https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked" target="_blank" rel="noreferrer">Chrome 安装说明 ↗</a></aside>
  </div>;
}
