import { extension } from './chrome.js';
import { normalizeUiPreferences } from './preferences.js';

import { renderReport, renderReportDetails, shellView, nextOptionState } from './ui.js';
import type { ShellState } from './coordinator.js';
declare const __AUTOFILL_BUILD_ID__: string;
const status = document.getElementById('status')!, report = document.getElementById('report')!;
const loginStatus = document.getElementById('login-status')!, webLogin = document.getElementById('web-login') as HTMLButtonElement;
let admin = false, signedIn = false;
const primary = document.querySelector<HTMLButtonElement>('[data-command=start]')!, cancel = document.querySelector<HTMLButtonElement>('[data-command=cancel]')!;
const overwrite = document.getElementById('overwrite-existing') as HTMLInputElement, college = document.getElementById('allow-college-reset') as HTMLInputElement;
const collectButton = document.getElementById('collect-page') as HTMLButtonElement, collectionOutput = document.getElementById('collection-json') as HTMLTextAreaElement;
const collectionStatus = document.getElementById('collection-status')!;
let collecting = false;
let lastAuthFailure: string | undefined;
let settingsLoadSequence = 0;
let diagnosticsKey = '';
function setAdmin(allowed: boolean) {
  admin = allowed;
  document.getElementById('admin-tools')!.hidden = !admin;
  document.getElementById('rule-collection')!.hidden = !admin;
  if (!admin) {
    diagnosticsKey = '';
    document.getElementById('run-diagnostics')!.hidden = true;
    (document.getElementById('run-json') as HTMLTextAreaElement).value = '';
    collectionOutput.value = ''; collectionOutput.hidden = true; collectionStatus.textContent = '';
    document.getElementById('backend-origin')!.textContent = '';
    document.getElementById('auth-build')!.textContent = '';
  }
}
async function refreshSettings() {
  const sequence = ++settingsLoadSequence;
  try {
    const account = await extension.runtime.sendMessage({ type: 'autofill-auth-status' });
    if (sequence !== settingsLoadSequence) return;
    signedIn = account.authenticated === true;
    const connection = document.getElementById('connection-status')!;
    connection.textContent = signedIn ? '已连接' : account.error ? '连接失败' : '未登录'; connection.dataset.connected = String(signedIn);
    setAdmin(signedIn && account.role === 'admin' && account.capabilities?.extensionDebug === true);
    webLogin.hidden = signedIn;
    loginStatus.textContent = signedIn ? '' : account.error ? '暂时无法连接领客，请稍后重试' : '请在领客网页完成登录，返回后即可填写';
    if (admin) {
      document.getElementById('backend-origin')!.textContent = account.backendUrl ?? '';
      document.getElementById('auth-build')!.textContent = `平台扩展 · ${__AUTOFILL_BUILD_ID__}`;
    }
    if (current) render(current);
  } catch { if (sequence === settingsLoadSequence) { signedIn = false; setAdmin(false); webLogin.hidden = false; loginStatus.textContent = '无法读取网页登录状态，请稍后重试'; const connection = document.getElementById('connection-status')!; connection.textContent = '连接失败'; connection.dataset.connected = 'false'; } }
}
const launcherEnabled = document.getElementById('launcher-enabled') as HTMLInputElement;
const preferenceStatus = document.getElementById('preference-status')!;
let preferenceSaving = false, preferenceSequence = 0;
async function refreshPreferences() {
  if (preferenceSaving) return;
  const sequence = ++preferenceSequence;
  try {
    const result = await extension.runtime.sendMessage({ type: 'autofill-ui-preferences-get' });
    if (sequence !== preferenceSequence) return;
    if (!result?.ok) throw new Error('preferences-unavailable');
    launcherEnabled.checked = normalizeUiPreferences(result.preferences).launcherEnabled;
    launcherEnabled.disabled = false; preferenceStatus.hidden = true;
  } catch { if (sequence === preferenceSequence) { launcherEnabled.disabled = false; preferenceStatus.hidden = false; preferenceStatus.textContent = '暂时无法读取设置，请重试'; } }
}
launcherEnabled.addEventListener('change', event => {
  if (!event.isTrusted || preferenceSaving) return;
  const requested = launcherEnabled.checked, previous = !requested;
  preferenceSaving = true; preferenceSequence++; launcherEnabled.disabled = true;
  preferenceStatus.hidden = true;
  void extension.runtime.sendMessage({ type: 'autofill-ui-preferences-set', launcherEnabled: requested }).then(result => {
    if (!result?.ok || result.preferences?.launcherEnabled !== requested) throw new Error('preferences-not-saved');
  }).catch(() => { launcherEnabled.checked = previous; preferenceStatus.textContent = '暂时无法保存设置，请重试'; preferenceStatus.hidden = false; }).finally(() => { preferenceSaving = false; launcherEnabled.disabled = false; });
});
const targetTabId = extension.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]?.id);
type PopupState = ShellState & { commandDocumentId?: string; supportsCollegeReset?: boolean };
let optionsLocked = false;
let commandDocumentId: string | undefined, current: PopupState | undefined, stale = false, sending = false, pendingCommand: 'pause' | 'cancel' | null = null;
const modeNote = () => { document.getElementById('mode-note')!.textContent = overwrite.checked ? '本次将覆盖页面已有内容' : '保留页面已有内容'; document.getElementById('mode-note')!.classList.toggle('warning', overwrite.checked); };
function render(state: PopupState) {
  current = state; if (!state.report || state.starting) diagnosticsKey = ''; const view = shellView(state);
  const authFailure = state.readiness.status === 'failed' ? state.readiness.reason : undefined;
  if (authFailure !== lastAuthFailure && ['authentication-required', 'access-denied'].includes(authFailure ?? '')) void refreshSettings();
  lastAuthFailure = authFailure;
  if (!view.active && !state.starting) pendingCommand = null;
  status.textContent = pendingCommand === 'pause' ? '正在暂停…' : pendingCommand === 'cancel' ? '正在停止…' : view.status; status.dataset.phase = state.phase;
  status.classList.toggle('warning', view.blocked || state.phase === 'partial');
  document.getElementById('progress-note')!.textContent = view.note;
  primary.textContent = pendingCommand ? status.textContent : view.primary; primary.disabled = view.disabled || sending || stale || collecting || !!pendingCommand;
  collectButton.disabled = !admin || collecting || sending || stale || state.starting || !['idle', 'completed', 'partial', 'cancelled', 'failed'].includes(state.phase);
  cancel.hidden = !view.cancel || view.command === 'cancel'; cancel.disabled = pendingCommand === 'cancel' || stale;
  const selected = nextOptionState(state, { overwriteExisting: overwrite.checked, allowCollegeReset: college.checked }, optionsLocked);
  overwrite.checked = selected.overwriteExisting; college.checked = selected.allowCollegeReset; optionsLocked = selected.locked;
  overwrite.disabled = college.disabled = selected.locked;
  document.getElementById('college-reset-option')!.hidden = state.supportsCollegeReset !== true;
  if (!state.supportsCollegeReset) college.checked = false;
  const progress = document.getElementById('progress') as HTMLProgressElement; progress.hidden = !view.active && !state.starting;
  if (view.progress === null || state.starting) progress.removeAttribute('value'); else progress.value = view.progress;
  report.hidden = !state.report?.items.length; report.textContent = state.report ? renderReport(state.report) : '';
  renderReportDetails(document.getElementById('report-details')!, state.report); modeNote();
  if (admin && state.report && !view.active && !state.starting) void loadDiagnostics();
  else document.getElementById('run-diagnostics')!.hidden = true;
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
  if (!event.isTrusted || !admin || collectButton.disabled || stale || !current || !commandDocumentId) return;
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
    if (!admin) return;
    collectionOutput.value = JSON.stringify(result.data, null, 2); collectionOutput.hidden = false;
    collectionStatus.textContent = '只读扫描完成，可选中下方原始 JSON 复制';
  })().catch(() => { if (!stale) collectionStatus.textContent = '扫描失败，请刷新页面后重试'; }).finally(() => { collecting = false; if (current && !stale) render(current); });
});
overwrite.addEventListener('change', event => { if (!event.isTrusted) return; if (!overwrite.checked) college.checked = false; modeNote(); });
async function loadDiagnostics() {
  const key = commandDocumentId + ':' + current?.phase;
  if (!admin || diagnosticsKey === key) return;
  diagnosticsKey = key;
  try {
    const id = await targetTabId;
    if (id === undefined) return;
    const result = await extension.tabs.sendMessage(id, { type: 'autofill-debug-state', commandDocumentId });
    if (!admin || diagnosticsKey !== key || !result?.ok) return;
    (document.getElementById('run-json') as HTMLTextAreaElement).value = JSON.stringify(result.data, null, 2);
    document.getElementById('run-diagnostics')!.hidden = false;
  } catch { diagnosticsKey = ''; }
}
webLogin.addEventListener('click', event => {
  if (!event.isTrusted) return;
  void extension.runtime.sendMessage({ type: 'autofill-open-login' }).catch(() => { loginStatus.textContent = '无法打开领客网页，请重试'; });
});
void refreshSettings(); void refreshPreferences(); void refresh();
const timer = setInterval(() => void refresh(), 500);
const authTimer = setInterval(() => void refreshSettings(), 5000);
window.addEventListener('focus', () => { void refreshSettings(); void refreshPreferences(); });
window.addEventListener('unload', () => { clearInterval(timer); clearInterval(authTimer); }, { once: true });
