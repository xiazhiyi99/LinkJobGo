import type { RunItem, RunReport } from '@job-assistant/autofill-contracts';

const verified = (item: RunItem) => ['filled', 'already-correct'].includes(item.status) && item.verification !== 'none';
const preserved = (item: RunItem) => item.status === 'skipped' && /preserv|nonempty|existing/.test(item.reason ?? '');
const inactive = (item: RunItem) => item.status === 'skipped' && item.reason === 'conditional-field-hidden';
const parserStamp = (warning: string) => /^site-parser:[^@\s]+@[^@\s]+$/.test(warning);

export const needsReportDetail = (item: RunItem) => !verified(item) && !inactive(item) && item.reason !== 'pending';
export const needsAttention = (item: RunItem) => needsReportDetail(item) && !preserved(item);
export function reportSummary(report: RunReport) {
  return {
    verified: report.items.filter(verified).length,
    saved: report.items.filter(item => verified(item) && item.verification === 'saved').length,
    preserved: report.items.filter(preserved).length,
    notApplicable: report.items.filter(inactive).length,
    pending: report.items.filter(item => item.reason === 'pending').length,
    attention: report.items.filter(needsAttention).length,
    failed: report.items.filter(item => item.status === 'failed').length,
    warnings: [...new Set(report.warnings)].filter(warning => !parserStamp(warning)),
  };
}
export const isReportComplete = (report: RunReport) => report.items.every(item => verified(item) || inactive(item)) && report.warnings.every(parserStamp);
