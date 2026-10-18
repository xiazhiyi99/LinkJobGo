import { extension } from './chrome.js';

import { renderReport, renderReportDetails, shellView, nextOptionState } from './ui.js';
import type { ShellState } from './coordinator.js';
declare const __AUTOFILL_BUILD_ID__: string;
const status = document.getElementById('status')!, report = document.getElementById('report')!;
const settingsStatus = document.getElementById('settings-status')!, settingsMetadata = document.getElementById('settings-metadata')!;
const primary = document.querySelector<HTMLButtonElement>('[data-command=start]')!, cancel = document.querySelector<HTMLButtonElement>('[data-command=cancel]')!;
const overwrite = document.getElementById('overwrite-existing') as HTMLInputElement, college = document.getElementById('allow-college-reset') as HTMLInputElement;
const collectButton = document.getElementById('collect-page') as HTMLButtonElement, collectionOutput = document.getElementById('collection-json') as HTMLTextAreaElement;
const collectionStatus = document.getElementById('collection-status')!;
let collecting = false;
let lastAuthFailure: string | undefined;
let settingsLoadSequence = 0;
let authenticating = false;
async function refreshSettings() {
  const sequence = ++settingsLoadSequence;
  try {
    const account = await extension.runtime.sendMessage({ type: 'autofill-auth-status' });
    if (sequence !== settingsLoadSequence) return;
    document.getElementById('backend-origin')!.textContent = account.backendUrl ?? '服务不可用';
    settingsMetadata.textContent = account.state === 'authenticated' ? `已登录：${account.email}` : account.state === 'needs-login' ? '登录已失效，请重新登录。' : '尚未登录领客账号';
    document.getElementById('auth-build')!.textContent = `平台扩展 · ${__AUTOFILL_BUILD_ID__}`;
  } catch { if (sequence === settingsLoadSequence) settingsMetadata.textContent = '无法读取登录状态'; }
}
const targetTabId = extension.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]?.id);
type PopupState = ShellState & { commandDocumentId?: string; supportsCollegeReset?: boolean };
let optionsLocked = false;
let commandDocumentId: string | undefined, current: PopupState | undefined, stale = false, sending = false, pendingCommand: 'pause' | 'cancel' | null = null;
const modeNote = () => { document.getElementById('mode-note')!.textContent = overwrite.checked ? '本次将覆盖页面已有内容' : '保留页面已有内容'; document.getElementById('mode-note')!.classList.toggle('warning', overwrite.checked); };
function render(state: PopupState) {
  current = state; const view = shellView(state);
  const authFailure = state.readiness.status === 'failed' ? state.readiness.reason : undefined;
  if (authFailure !== lastAuthFailure && ['authentication-required', 'access-denied'].includes(authFailure ?? '')) void refreshSettings();
  lastAuthFailure = authFailure;
  if (!view.active && !state.starting) pendingCommand = null;
  status.textContent = pendingCommand === 'pause' ? '正在暂停…' : pendingCommand === 'cancel' ? '正在停止…' : view.status; status.dataset.phase = state.phase;
  status.classList.toggle('warning', view.blocked || state.phase === 'partial');
  document.getElementById('progress-note')!.textContent = view.note;
  primary.textContent = pendingCommand ? status.textContent : view.primary; primary.disabled = view.disabled || sending || stale || collecting || !!pendingCommand;
  collectButton.disabled = collecting || sending || stale || state.starting || !['idle', 'completed', 'partial', 'cancelled', 'failed'].includes(state.phase);
  cancel.hidden = !view.cancel; cancel.disabled = pendingCommand === 'cancel' || stale;
  const selected = nextOptionState(state, { overwriteExisting: overwrite.checked, allowCollegeReset: college.checked }, optionsLocked);
  overwrite.checked = selected.overwriteExisting; college.checked = selected.allowCollegeReset; optionsLocked = selected.locked;
  overwrite.disabled = college.disabled = selected.locked;
  document.getElementById('college-reset-option')!.hidden = state.supportsCollegeReset !== true;
  if (!state.supportsCollegeReset) college.checked = false;
  const progress = document.getElementById('progress') as HTMLProgressElement; progress.hidden = !view.active && !state.starting;
  if (view.progress === null || state.starting) progress.removeAttribute('value'); else progress.value = view.progress;
  report.hidden = !state.report?.items.length; report.textContent = state.report ? renderReport(state.report) : '';
  renderReportDetails(document.getElementById('report-details')!, state.report); modeNote();
  const diagnostic = document.getElementById('run-diagnostics')!;
  diagnostic.hidden = !state.report || view.active || state.starting;
  if (!diagnostic.hidden) (document.getElementById('run-json') as HTMLTextAreaElement).value = JSON.stringify({ buildId: __AUTOFILL_BUILD_ID__, phase: state.phase, commandTiming: state.commandTiming, timing: state.timing, report: state.report }, null, 2);
}
function unavailable(message: string) { status.textContent = message; primary.disabled = true; collectButton.disabled = true; cancel.hidden = true; commandDocumentId = undefined; current = undefined; document.getElementById('progress')!.hidden = true; collectionOutput.value = ''; collectionOutput.hidden = true; collectionStatus.textContent = ''; }
async function refresh() {
  if (stale) return;
  try {
    const id = await targetTabId; if (id === undefined) throw new Error('No tab');
    const state = await extension.tabs.sendMessage(id, { type: 'autofill-state' }) as PopupState;
    if (stale) return;
    if (commandDocumentId && commandDocumentId !== state.commandDocumentId) { stale = true; unavailable('页面已切换，请重新打开扩展'); return; }
    commandDocumentId = state.commandDocumentId; render(state);
  } catch { unavailable('此页面无法运行扩展，请打开普通网页并刷新'); }
}
document.querySelector('.actions')!.addEventListener('click', event => {
  if (!event.isTrusted || event instanceof MouseEvent && event.detail > 1 || stale || !current) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-command]'); if (!button || button.disabled) return;
  const command = button.dataset.command === 'cancel' ? 'cancel' : shellView(current).command;
  if (sending && command !== 'cancel') return;
  const intendedDocument = commandDocumentId, options = { overwriteExisting: overwrite.checked, allowCollegeReset: college.checked && current.supportsCollegeReset === true };
  sending = true; if (command === 'pause' || command === 'cancel') pendingCommand = command; render(current);
  void (async () => {
    const id = await targetTabId; if (id === undefined || !intendedDocument) throw new Error('No current document');
    const result = await extension.tabs.sendMessage(id, { type: 'autofill-command', command, commandDocumentId: intendedDocument, ...options });
    if (result?.commandRejected) { stale = true; unavailable('页面已切换，请重新打开扩展'); return; }
    sending = false; await refresh();
  })().catch(() => { unavailable('页面操作失败，请重新打开扩展'); }).finally(() => { sending = false; if (current && !stale) render(current); });
});
collectButton.addEventListener('click', event => {
  if (!event.isTrusted || collectButton.disabled || stale || !current || !commandDocumentId) return;
  const intendedDocument = commandDocumentId;
  collecting = true; collectionOutput.value = ''; collectionOutput.hidden = true; collectionStatus.textContent = '正在只读扫描…'; render(current);
  void (async () => {
    const id = await targetTabId; if (id === undefined) throw new Error('No current tab');
    const result = await extension.tabs.sendMessage(id, { type: 'autofill-collect-page', commandDocumentId: intendedDocument });
    if (stale || commandDocumentId !== intendedDocument) return;
    if (!result?.ok) {
      const messages: Record<string, string> = { 'document-changed': '页面已切换，请重新打开扩展', 'run-in-progress': '请在填写结束或停止后采集，暂停时也不可采集', 'snapshot-too-large': '扫描结果超过 512 KB，请按页面区块采集', 'scan-failed': '扫描失败，请刷新页面后重试' };
      collectionStatus.textContent = messages[result?.error?.code] ?? '扫描失败，未获得有效结果'; return;
    }
    if (result.commandDocumentId !== intendedDocument || !result.data?.snapshot) { collectionStatus.textContent = '页面已切换，请重新打开扩展'; return; }
    collectionOutput.value = JSON.stringify(result.data, null, 2); collectionOutput.hidden = false;
    collectionStatus.textContent = '只读扫描完成，可选中下方原始 JSON 复制';
  })().catch(() => { if (!stale) collectionStatus.textContent = '扫描失败，请刷新页面后重试'; }).finally(() => { collecting = false; if (current && !stale) render(current); });
});
overwrite.addEventListener('change', event => { if (!event.isTrusted) return; if (!overwrite.checked) college.checked = false; modeNote(); });
const form = document.getElementById('settings') as HTMLFormElement;
form.addEventListener('submit', event => event.preventDefault());
const login = (event: Event) => {
  event.preventDefault();
  if (!event.isTrusted || authenticating || !form.reportValidity()) return;
  if (current?.starting || current && !['idle', 'completed', 'partial', 'cancelled', 'failed'].includes(current.phase)) { settingsStatus.textContent = '请先停止当前填写，再切换账号'; return; }
  const email = (document.getElementById('account-email') as HTMLInputElement).value;
  const passwordInput = document.getElementById('account-password') as HTMLInputElement;
  const password = passwordInput.value; passwordInput.value = '';
  authenticating = true; settingsLoadSequence++; settingsStatus.textContent = '正在登录…';
  void extension.runtime.sendMessage({ type: 'autofill-auth-login', email, password }).then(result => {
    const errors: Record<string, string> = { 'invalid-credentials': '邮箱或密码不正确', 'access-denied': '账号暂不可用，请在领客网页检查邮箱验证状态', 'deadline-exceeded': '登录超时，请重试', 'cancelled': '登录已取消', 'backend-unavailable': '无法连接领客服务，请稍后重试' };
    settingsStatus.textContent = result?.ok ? '登录成功' : errors[result?.error?.code] ?? '登录失败，请检查服务配置';
  }, () => { settingsStatus.textContent = '登录失败，请重试'; }).finally(() => { authenticating = false; void refreshSettings(); });
};
form.querySelector('button[type=submit]')!.addEventListener('click', login);
form.addEventListener('keydown', event => { if (event.key === 'Enter') login(event); });
document.getElementById('disconnect-settings')!.addEventListener('click', event => {
  if (!event.isTrusted) return;
  settingsLoadSequence++;
  // Stop the current document via its existing command before disconnecting.
  void (async () => {
    const id = await targetTabId;
    if (id !== undefined && commandDocumentId) await extension.tabs.sendMessage(id, { type: 'autofill-command', command: 'cancel', commandDocumentId }).catch(() => {});
    const result = await extension.runtime.sendMessage({ type: 'autofill-auth-logout' });
    settingsStatus.textContent = result?.ok ? result.serverRevoked ? '已退出登录' : '已清除本地登录；服务器会话未确认撤销' : '退出失败，请重试';
    await refreshSettings();
  })().catch(() => { settingsStatus.textContent = '退出失败，请重试'; });
});
void refreshSettings(); void refresh(); const timer = setInterval(() => void refresh(), 500); window.addEventListener('unload', () => clearInterval(timer), { once: true });
