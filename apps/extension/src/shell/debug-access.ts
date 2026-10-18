import type { ShellState } from './coordinator.js';

// Ordinary popup messages expose progress, not diagnostic IDs/timings/actions.
export function publicPopupState<T extends ShellState>(state: T): T {
  const { timing: _timing, commandTiming: _commandTiming, ...publicState } = state;
  return { ...publicState, runId: null, report: state.report ? {
    status: state.report.status, runId: '', documentId: '', profileVersion: '', actions: [],
    warnings: state.report.warnings.filter(value => !value.startsWith('site-parser:')),
    items: state.report.items.map(item => ({
      sectionId: '', recordId: null, templateFieldId: '', sectionLabel: item.sectionLabel,
      fieldLabel: item.fieldLabel, recordType: item.recordType, recordIndex: item.recordIndex,
      targetIndex: item.targetIndex, status: item.status, reason: item.reason, verification: item.verification,
    })),
  } : null } as T;
}

export async function adminOnly<T>(check: () => Promise<{ allowed?: boolean }>, work: () => Promise<T>): Promise<T> {
  if ((await check()).allowed !== true) throw new Error('admin-required');
  const value = await work();
  // A role change or logout during collection must not release the result.
  if ((await check()).allowed !== true) throw new Error('admin-required');
  return value;
}
