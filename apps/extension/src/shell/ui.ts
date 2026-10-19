import type { RunReport } from '@job-assistant/autofill-contracts';
import { reportSummary, needsReportDetail, needsAttention } from '../report/index.js';
export { reportSummary } from '../report/index.js';
import type { RunnerState } from '../runner/index.js';
import type { ShellState } from './coordinator.js';
import { LinkSquirrel } from './pet/link-squirrel.js';
declare const __AUTOFILL_BUILD_ID__: string;
export interface LauncherRunner {
  start(options?: { overwriteExisting?: boolean; allowCollegeReset?: boolean }): Promise<RunReport>; pause(): void; resume(): Promise<RunReport>; cancel(): void;
  getState(): ShellState; subscribe(listener: (state: ShellState) => void): () => void;
}
export function launcherStartOptions(location: Pick<Location, 'origin' | 'pathname'>, overwriteExisting: boolean, allowCollegeReset: boolean): { overwriteExisting: boolean; allowCollegeReset?: true } {
  return location.origin === 'https://zhaopin.meituan.com' && ['/web/delivery-confirm', '/web/personal-center/resume-detail'].includes(location.pathname) && overwriteExisting && allowCollegeReset ? { overwriteExisting, allowCollegeReset: true } : { overwriteExisting };
}
export const phaseLabels: Record<RunnerState['phase'], string> = { idle: '准备填写', analyzing: '识别页面字段', probing: '检查页面与可选项', planning: '匹配简历资料', executing: '正在填写', verifying: '核对填写结果', paused: '已暂停', completed: '本轮填写完成', partial: '填写完毕，有待填事项', cancelled: '已停止填写', failed: '填写未完成' };
export const isRunning = (phase: RunnerState['phase']) => ['analyzing', 'probing', 'planning', 'executing', 'verifying'].includes(phase);
export function reasonLabel(reason?: string): string {
  if (!reason || reason === 'pending') return '等待填写或核验';
  if (reason === 'invalid-page-snapshot') return '页面扫描结果无效，已暂停；请更新扩展并刷新招聘页面，再重新填写';
  if (reason === 'invalid-semantic-page') return '页面字段识别结果无效，已暂停；请停止本轮后重新填写';
  if (reason === 'invalid-fill-plan') return '填写方案未通过校验，已暂停；请停止本轮后重新填写';
  if (reason === 'invalid-plan-input' || reason === 'invalid-analyze-input') return '当前区块的扫描数据未通过校验，已停止；请更新扩展并刷新招聘页面后重新填写';
  if (reason === 'record-subtype-unconfirmed') return '当前方案尚未区分实习与正式工作，已跳过实习区块，请手动填写';
  if (reason === 'replan-record-type-changed') return '重新识别的经历类型与原方案不一致，已暂停；请检查该区块后停止本轮并重新填写';
  if (reason === 'pending-record-mutation-unconfirmed') return '新增或保存记录的结果尚未确认，已暂停以避免重复或写错记录';
  if (reason === 'section-identity-unconfirmed' || reason.startsWith('section-quarantined:')) return '此区块的记录归属无法确认，已跳过整个区块；其他已确认归属的区块可继续填写';
  // Free-form parser explanations are not control error codes.
  if (!/^[a-z0-9][a-z0-9:-]*$/.test(reason)) return '请在页面检查此项后再继续';
  if (/authentication-required|resume-access-denied/.test(reason)) return '请点击浏览器扩展图标，前往领客网页登录后重试';
  if (/access-denied|origin-denied/.test(reason)) return '服务拒绝访问，请检查后端授权与扩展来源配置';
  if (/backend-unavailable/.test(reason)) return '无法连接领客服务，请稍后重试';
  if (/resume-api-unavailable|resume-unavailable/.test(reason)) return '暂时无法读取简历，请检查简历服务后重试';
  if (/resume-api-invalid|invalid-resume/.test(reason)) return '简历数据格式无法使用，请先检查简历资料';
  if (/resume-version|site-parser-changed/.test(reason)) return '简历或网站规则已更新，请停止本轮后重新填写';
  if (/document-changed|page-identity|analysis-page|plan-page/.test(reason)) return '页面已切换，请在当前页面重新开始';
  if (/addition-probe-residual|addition-probe-rollback/.test(reason)) return '新增的探测行未能确认撤回，请先检查页面中的空白记录';
  if (/identity|order-changed|binding|stale|incompatible-template/.test(reason)) return '无法确认当前记录归属，请检查页面后重新开始';
  if (/college.*reset|college.*clear/.test(reason)) return '更换学校需要清理旧学院，请查看填写选项并明确授权';
  if (/missing-source/.test(reason)) return '简历缺少对应资料，请补充资料或在页面手动填写';
  if (/preserv|nonempty|existing/.test(reason)) return '已保留页面原有内容';
  if (/conditional-field-hidden/.test(reason)) return '此字段当前未显示，请检查相关选项';
  if (/cancel/.test(reason)) return '已停止，尚未填写此项';
  if (/paused/.test(reason)) return '等待继续填写';
  if (/deadline|timeout/.test(reason)) return '等待超时，请检查服务或页面后重试';
  if (/save|verification|readback|completion/.test(reason)) return '填写或保存结果未能确认，请在页面核对';
  if (/no-editable-scope|no verified editable template/.test(reason)) return '请先打开当前页面的资料编辑区，再开始填写';
  if (/needs-options|option|date-choice/.test(reason)) return '没有确认可用的匹配选项，请在页面手动选择';
  if (/unsupported|unresolved|mapping/.test(reason)) return '暂不支持自动填写此项，请在页面检查并补充';
  return '请在页面检查此项后再继续';
}
export function warningLabel(warning: string): string {
  // Only the runner's bounded, known instruction may be shown verbatim.
  return /^请先打开「[^」\r\n\u0000-\u001f]{1,100}」的编辑界面，再开始填写。$/.test(warning) ? warning : reasonLabel(warning);
}
export function renderReport(report: RunReport): string {
  const summary = reportSummary(report);
  return `已验证 ${summary.verified} · 已保留 ${summary.preserved} · 待处理字段 ${summary.attention}${summary.failed ? `（失败 ${summary.failed}）` : ''}${summary.warnings.length ? ` · 页面提醒 ${summary.warnings.length}` : ''}`;
}
export function reportDetailsLabel(report: RunReport): string {
  const summary = reportSummary(report);
  return `查看填写详情（${summary.attention + summary.preserved + summary.warnings.length}）`;
}
const detailSignatures = new WeakMap<HTMLElement, string>();
export function renderReportDetails(root: HTMLElement, report: RunReport | null): void {
  const signature = JSON.stringify(report); if (detailSignatures.get(root) === signature) return; detailSignatures.set(root, signature);
  const opened = root.querySelector('details')?.open ?? false;
  root.replaceChildren(); if (!report) return;
  const summary = reportSummary(report);
  const items = report.items.filter(needsReportDetail);
  if (!items.length && !summary.warnings.length) return;
  const doc = root.ownerDocument, details = doc.createElement('details'), heading = doc.createElement('summary');
  details.open = opened;
  heading.textContent = reportDetailsLabel(report);
  details.append(heading); const list = doc.createElement('ul');
  for (const item of items) {
    const row = doc.createElement('li'), label = doc.createElement('strong'), reason = doc.createElement('span');
    const sourceType = item.recordType ? ({ education: '教育', experience: '工作', campus: '校园', project: '项目', award: '奖项', publication: '论文', skill: '技能', language: '语言', certificate: '证书' }[item.recordType]) : '';
    const ordinal = item.targetIndex ?? item.recordIndex;
    label.textContent = `${item.sectionLabel ?? '当前区块'}${ordinal === undefined || ordinal === null ? '' : ` · 第 ${ordinal + 1} 条${sourceType ? `（${sourceType}）` : ''}`} · ${item.fieldLabel ?? '待检查字段'}`;
    reason.textContent = reasonLabel(item.reason); row.append(label, reason); list.append(row);
  }
  for (const warning of summary.warnings) { const row = doc.createElement('li'); row.textContent = warningLabel(warning); list.append(row); }
  details.append(list); root.append(details);
}
export function shellView(state: ShellState) {
  const active = isRunning(state.phase), checking = state.starting || state.readiness.status === 'checking';
  const summary = state.report ? reportSummary(state.report) : null;
  const total = state.report?.items.length ?? 0, handled = total - (summary?.pending ?? 0);
  const interrupted = state.readiness.status === 'failed' && ['cancelled', 'paused'].includes(state.readiness.reason ?? '');
  const blocked = state.readiness.status === 'failed' && !interrupted;
  const terminal = ['completed', 'partial', 'cancelled', 'failed'].includes(state.phase);
  const firstIssue = state.report?.items.find(item => needsAttention(item) && item.reason !== 'paused');
  let note = '自动识别、匹配并填写当前页面；完成后请核对。';
  if (checking) note = '正在检查服务授权与简历，检查通过后自动开始。';
  else if (interrupted) note = '检查已停止；已填写内容保留。';
  else if (blocked) note = reasonLabel(state.readiness.reason);
  else if (active) note = total ? `已处理 ${handled} / ${total} 项 · 正在逐项核验` : '正在准备当前页面的填写计划';
  else if (state.phase === 'paused') note = state.report?.warnings.length ? warningLabel(summary?.warnings.at(-1) ?? 'paused') : '继续前会重新检查页面与简历；已填写内容保留。';
  else if (terminal && summary) note = summary.warnings.length ? warningLabel(summary.warnings.at(-1)!) : firstIssue ? reasonLabel(firstIssue.reason) : state.phase === 'cancelled' ? '已填写内容保留，请在页面核对。' : summary.saved ? `其中 ${summary.saved} 项已核验局部保存；请自行确认页面最终保存。` : '已验证的是页面回读结果；请自行确认页面保存。';
  return { status: checking ? '检查连接与简历' : interrupted ? '检查已停止' : blocked ? '暂时无法开始' : phaseLabels[state.phase], command: active ? 'pause' as const : state.phase === 'paused' ? 'resume' as const : 'start' as const, primary: checking ? '检查中…' : active ? '暂停填写' : blocked ? '重新检查' : state.phase === 'paused' ? '继续填写' : terminal ? '重新扫描填写' : '一键填写', disabled: checking, cancel: checking || active || state.phase === 'paused', active, terminal, blocked, note, total, handled, progress: total ? Math.round(handled / total * 100) : null };
}
export function nextOptionState(state: ShellState, selected: { overwriteExisting: boolean; allowCollegeReset: boolean }, wasLocked: boolean) {
  const locked = shellView(state).cancel;
  if (locked && state.effectiveOptions) return { locked, overwriteExisting: state.effectiveOptions.overwriteExisting, allowCollegeReset: state.effectiveOptions.allowCollegeReset === true };
  if (wasLocked && !locked) return { locked, overwriteExisting: false, allowCollegeReset: false };
  return { locked, ...selected };
}
export function launcherBubble(state: ShellState): { kind: 'action' | 'status'; text: string; warning: boolean } {
  if (state.starting || state.readiness.status === 'checking') return { kind: 'status', text: '正在检查连接与简历…', warning: false };
  if (state.readiness.status === 'failed' && state.phase === 'idle') {
    const authentication = /authentication-required|resume-access-denied/.test(state.readiness.reason ?? '');
    return { kind: 'status', text: authentication ? '请点扩展图标前往网页登录' : '暂时无法开始，请点扩展图标', warning: true };
  }
  const summary = state.report ? reportSummary(state.report) : null;
  switch (state.phase) {
    case 'idle': return { kind: 'action', text: '开始填写', warning: false };
    case 'analyzing': return { kind: 'status', text: '正在扫描页面字段…', warning: false };
    case 'probing': return { kind: 'status', text: '正在确认经历与选项…', warning: false };
    case 'planning': return { kind: 'status', text: '正在匹配简历与页面…', warning: false };
    case 'executing': {
      const total = state.report?.items.length ?? 0, handled = total - (summary?.pending ?? 0);
      return { kind: 'status', text: total ? `正在填写，已处理 ${handled}/${total} 项` : '正在填写页面字段…', warning: false };
    }
    case 'verifying': return { kind: 'status', text: '正在核对填写结果…', warning: false };
    case 'paused': return { kind: 'action', text: '继续填写', warning: false };
    case 'completed': return { kind: 'status', text: `填写完成，已核验 ${summary?.verified ?? 0} 项`, warning: false };
    case 'partial': return { kind: 'status', text: phaseLabels.partial, warning: true };
    case 'cancelled': return { kind: 'status', text: '已停止填写', warning: false };
    case 'failed': return { kind: 'status', text: '填写未完成，请点扩展图标', warning: true };
  }
}

export function mountLauncher({ runner, root, spriteUrl }: { runner: LauncherRunner; root: HTMLElement; spriteUrl: string }): () => void {
  const doc = root.ownerDocument, win = doc.defaultView!;
  root.dataset.buildId = typeof __AUTOFILL_BUILD_ID__ === 'string' ? __AUTOFILL_BUILD_ID__ : 'development';
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
:host{all:initial;position:fixed;right:28px;bottom:56px;z-index:2147483647;display:block;width:96px;height:96px;font:13px/1.4 Geist,-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#20314d;color-scheme:light}
:host([hidden]){display:none!important}*{box-sizing:border-box}[hidden]{display:none!important}
.pet{display:block;width:96px;height:96px;cursor:grab;touch-action:none}.pet:active{cursor:grabbing}.pet::part(button){touch-action:none}
.bubble{position:absolute;top:84px;left:0;display:flex;align-items:center;justify-content:center;width:max-content;max-width:min(176px,calc(100vw - 16px));min-height:28px;padding:0 8px;border:1px solid #e4eaf2;border-radius:999px;background:#f5f7fb;box-shadow:0 4px 12px rgba(32,49,77,.12);color:#20314d;text-align:center;white-space:nowrap;animation:pill-drop 180ms cubic-bezier(.2,.8,.2,1) both}
.bubble[data-kind=action]{min-width:72px;padding:0}.bubble[data-warning=true]{border-color:#d3b590}
.bubble button{display:flex;align-items:center;justify-content:center;gap:4px;width:100%;min-height:26px;padding:0 6px;border:0;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:11px;font-weight:600;cursor:pointer}.bubble button:hover{background:#e8f0ff}
.bubble button svg{display:block;flex:none;width:12px;height:12px}
.bubble button:focus-visible,.pet:focus-visible{outline:2px solid #0755c7;outline-offset:2px}
.bubble [role=status]{display:block;overflow:hidden;text-overflow:ellipsis;max-width:100%;font-size:10.5px;font-weight:550;letter-spacing:.01em}
@keyframes pill-drop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.bubble{animation:none}}
</style><div class="pet-slot"></div><div class="bubble" hidden data-kind="action" data-warning="false"><button type="button" data-action="start"><svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H5.5A2.5 2.5 0 0 0 3 6.5v8A2.5 2.5 0 0 0 5.5 17h8a2.5 2.5 0 0 0 2.5-2.5V9"/><path d="m8 13.8 3-.8 6.5-6.5a1.4 1.4 0 0 0-2-2L9 11z"/></svg><span class="action-label">开始填写</span></button><span role="status" aria-live="polite" hidden></span></div>`;
  const pet = doc.createElement('link-squirrel');
  pet.className = 'pet'; pet.setAttribute('src', spriteUrl); pet.setAttribute('label', '展开领客填写入口');
  const squirrel = new LinkSquirrel(pet);
  shadow.querySelector('.pet-slot')!.replaceWith(pet); squirrel.connectedCallback();
  const bubble = shadow.querySelector('.bubble') as HTMLElement;
  const action = bubble.querySelector('[data-action=start]') as HTMLButtonElement;
  const actionLabel = action.querySelector('.action-label') as HTMLElement;
  const message = bubble.querySelector('[role=status]') as HTMLElement;
  const initialState = runner.getState(); let disposed = false, hovered = false, focused = false;
  let hideTimer: number | undefined, suppressPetClick = false;
  let dragging: { pointerId: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  const initialPosition = () => ({ left: win.innerWidth - 96 - 28, top: win.innerHeight - 96 - 56 });
  const positionBubble = () => {
    if (bubble.hidden) return;
    const rect = root.getBoundingClientRect(), width = bubble.getBoundingClientRect().width;
    const desired = rect.left + (96 - width) / 2;
    const left = Math.max(8, Math.min(desired, win.innerWidth - width - 8));
    bubble.style.left = `${left - rect.left}px`;
  };
  const place = (left: number, top: number) => {
    root.style.right = root.style.bottom = 'auto';
    root.style.left = `${Math.max(16, Math.min(left, Math.max(16, win.innerWidth - 96 - 16)))}px`;
    root.style.top = `${Math.max(16, Math.min(top, Math.max(16, win.innerHeight - 96 - 56)))}px`;
    positionBubble();
  };
  const updateVisibility = () => { bubble.hidden = !(hovered || focused); positionBubble(); };
  const render = (state: ShellState) => {
    const view = launcherBubble(state);
    root.dataset.phase = state.phase;
    bubble.dataset.kind = view.kind; bubble.dataset.warning = String(view.warning);
    action.hidden = view.kind !== 'action'; message.hidden = view.kind !== 'status';
    actionLabel.textContent = view.text; message.textContent = view.text;
    squirrel.setLabel(view.kind === 'action' ? `展开${view.text}按钮` : `领客填写助手：${view.text}`);
    updateVisibility();
  };
  const runPrimary = () => {
    const view = shellView(runner.getState());
    if (view.disabled || view.active || !['start', 'resume'].includes(view.command)) return;
    const operation = view.command === 'resume' ? runner.resume() : runner.start({ overwriteExisting: false });
    void operation.catch(() => { if (!disposed) render(runner.getState()); }).finally(() => { if (!disposed) render(runner.getState()); });
  };
  const click = (event: Event) => {
    if (!event.isTrusted || event instanceof MouseEvent && event.detail > 1) return;
    if ((event.target as HTMLElement).closest('[data-action=start]')) { runPrimary(); return; }
    if (suppressPetClick) { suppressPetClick = false; return; }
    if (event.composedPath().includes(pet)) { hovered = true; updateVisibility(); }
  };
  const showHover = () => { if (hideTimer !== undefined) win.clearTimeout(hideTimer); hovered = true; updateVisibility(); };
  const hideHover = () => { if (hideTimer !== undefined) win.clearTimeout(hideTimer); hideTimer = win.setTimeout(() => { hovered = false; updateVisibility(); }, 180); };
  const focusVisible = () => Boolean(shadow.querySelector(':focus-visible') || pet.shadowRoot?.querySelector(':focus-visible'));
  const focusIn = () => { focused = focusVisible(); updateVisibility(); };
  const focusOut = () => { win.setTimeout(() => { if (disposed) return; focused = focusVisible(); updateVisibility(); }, 0); };
  const pointerDown = (event: PointerEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    const rect = root.getBoundingClientRect();
    dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    pet.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (dragging?.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
    if (!dragging.moved && dx * dx + dy * dy < 36) return;
    dragging.moved = true; place(dragging.left + dx, dragging.top + dy); event.preventDefault();
  };
  const pointerEnd = (event: PointerEvent) => {
    if (dragging?.pointerId !== event.pointerId) return;
    if (dragging.moved) { suppressPetClick = true; win.setTimeout(() => { suppressPetClick = false; }, 0); }
    dragging = null;
  };
  const keydown = (rawEvent: Event) => {
    const event = rawEvent as KeyboardEvent;
    if (!event.isTrusted || !event.composedPath().includes(pet)) return;
    if (event.key === 'Escape') { hovered = focused = false; updateVisibility(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const rect = root.getBoundingClientRect(), step = event.shiftKey ? 60 : 24;
    if (event.key === 'Home') { const initial = initialPosition(); place(initial.left, initial.top); }
    else place(rect.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), rect.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
  };
  const resize = () => { const rect = root.getBoundingClientRect(); place(rect.left, rect.top); };
  shadow.addEventListener('click', click); shadow.addEventListener('keydown', keydown);
  root.addEventListener('pointerenter', showHover); root.addEventListener('pointerleave', hideHover);
  root.addEventListener('focusin', focusIn); root.addEventListener('focusout', focusOut);
  pet.addEventListener('pointerdown', pointerDown); pet.addEventListener('pointermove', pointerMove);
  pet.addEventListener('pointerup', pointerEnd); pet.addEventListener('pointercancel', pointerEnd);
  win.addEventListener('resize', resize);
  const unsubscribe = runner.subscribe(render); render(initialState); const initial = initialPosition(); place(initial.left, initial.top);
  return () => {
    disposed = true; unsubscribe(); if (hideTimer !== undefined) win.clearTimeout(hideTimer);
    win.removeEventListener('resize', resize); shadow.removeEventListener('click', click); shadow.removeEventListener('keydown', keydown);
    root.removeEventListener('pointerenter', showHover); root.removeEventListener('pointerleave', hideHover);
    root.removeEventListener('focusin', focusIn); root.removeEventListener('focusout', focusOut);
    pet.removeEventListener('pointerdown', pointerDown); pet.removeEventListener('pointermove', pointerMove);
    pet.removeEventListener('pointerup', pointerEnd); pet.removeEventListener('pointercancel', pointerEnd);
    squirrel.disconnectedCallback(); root.remove();
  };
}
