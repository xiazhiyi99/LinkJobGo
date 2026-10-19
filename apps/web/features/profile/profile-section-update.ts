type RecordValues = Record<string, string> & { id: string };
type Section = { title: string; kind: 'single' | 'repeat'; fields: Array<{ key: string; readOnly?: boolean }> };
const aliases: Record<string, string> = { homeCity: 'city', website: 'personalWebsite', github: 'githubUrl' };

export function skillRecords(items: RecordValues[]) {
  return items.filter(item => !['language', 'certificate'].includes(item.kind));
}

// Send the edited section only; hydrated metadata is never written back.
export function profileSectionUpdate(section: Section, values: Record<string, string>, previousValues: Record<string, string>, records: RecordValues[], previousRecords: RecordValues[]) {
  const changedFields = (current: Record<string, string>, previous: Record<string, string>) => Object.fromEntries(
    section.fields.filter(field => !field.readOnly && (current[field.key] || '') !== (previous[field.key] || ''))
      .map(field => [field.key, current[field.key] || '']),
  );
  if (section.kind === 'single') {
    const fields = changedFields(values, previousValues);
    const key = section.title === '求职意向' ? 'preferences' : 'profile';
    return { [key]: Object.fromEntries(Object.entries(fields).map(([field, value]) => [key === 'profile' ? aliases[field] || field : field, value])) };
  }
  const byId = new Map(previousRecords.map(record => [record.id, record]));
  return { records: { [section.title]: records.map(record => {
    const previous = byId.get(record.id);
    return previous ? { id: previous.id, ...changedFields(record, previous) }
      : Object.fromEntries(section.fields.filter(field => !field.readOnly).map(field => [field.key, record[field.key] || '']));
  }) } };
}
