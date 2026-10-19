type DatePrecision = 'day' | 'month';
type DateDisplay = { type: 'date' | 'month' | 'text'; value: string };

// Format only the control's displayed value. The original draft stays intact
// until the user changes the field, so opening/saving cannot rewrite precision.
export function dateFieldDisplay(value: string, precision: DatePrecision = 'day'): DateDisplay {
  if (!value) return { type: precision === 'month' ? 'month' : 'date', value: '' };
  const raw = value.trim();
  const match = raw.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/)
    || raw.match(/^(\d{4})年(\d{1,2})月(?:(\d{1,2})日?)?$/)
    || raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!match) return { type: 'text', value };
  const year = Number(match[1]), month = Number(match[2]), day = match[3] ? Number(match[3]) : undefined;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || !maxDay || (day !== undefined && (day < 1 || day > maxDay))) return { type: 'text', value };
  const date = `${match[1]}-${String(month).padStart(2, '0')}`;
  return day === undefined ? { type: 'month', value: date } : { type: 'date', value: `${date}-${String(day).padStart(2, '0')}` };
}

export function selectFieldOptions(value: string, options: string[] = []) {
  const choices = options.map(label => ({ value: label.startsWith('请选择') ? '' : label, label }));
  if (!choices.some(choice => choice.value === value)) choices.unshift({ value, label: value || '请选择' });
  return choices;
}
