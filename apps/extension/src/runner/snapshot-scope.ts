import type { RecordSnapshot, SectionSnapshot } from '@job-assistant/autofill-contracts';

/** A record-only request must not retain actions pointing at excluded records. */
export function scopeSectionToRecords(section: SectionSnapshot, records: RecordSnapshot[]): SectionSnapshot {
  const retained = new Set(records.map(record => record.viewId));
  return { ...section, records, actions: section.actions.filter(action => action.viewId === undefined || retained.has(action.viewId)) };
}
