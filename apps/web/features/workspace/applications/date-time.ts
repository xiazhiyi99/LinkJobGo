export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function dateInput(value?: string, time = false) {
  if (!value) return '';
  // appliedOn is a calendar date, not a local instant. Keep its stored day.
  if (!time) return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] || '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function inputDateValue(value: string, time = false) {
  if (!value) return null;
  const date = new Date(time ? value : `${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || dateInput(date.toISOString(), time) !== value) {
    throw new Error('日期时间无效，请重新选择（请避开夏令时跳过的时间）。');
  }
  return date.toISOString();
}

export function dateOnlyText(value?: string) {
  const key = dateInput(value);
  if (!key) return '—';
  const [, month, day] = key.split('-');
  return `${Number(month)}/${Number(day)}`;
}
