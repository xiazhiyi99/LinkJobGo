export type CalendarItem = {
  type: string;
  id: string;
  title: string;
  start: string | null;
  end?: string | null;
  status?: string | null;
  applicationId?: string | null;
};

export type CalendarMode = 'month' | 'week' | 'day';
export type CalendarRange = { from: string; to: string };
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const HOUR_HEIGHT = 64;
const MIN_EVENT_HEIGHT = 28;
export const STATUS_LABELS: Record<string, string> = {
  saved: '待投递', applied: '已投递', screening: '筛选中', interview: '笔试/面试中',
  offer: '已获 offer', closed: '已结束', open: '待办', done: '已完成', completed: '已完成', cancelled: '已取消',
};

// UTC Dates represent calendar labels only. Instants are converted at local
// midnight so the editor, ranges and display share the browser's timezone.
export const dateKey = (date: Date) => date.toISOString().slice(0, 10);
export const todayKey = () => localDateKey(new Date());
const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const civilDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
export const validDateKey = (key?: string): key is string => Boolean(key && /^\d{4}-\d{2}-\d{2}$/.test(key)
  && Number.isFinite(civilDate(key).getTime()) && dateKey(civilDate(key)) === key);
export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const mondayOf = (date: Date) => addDays(date, -((date.getUTCDay() + 6) % 7));
const dayStart = (date: Date) => new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime();
export const itemKey = (item: CalendarItem) => `${item.type}:${item.id}`;
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;
export const shortDate = (date: Date) => `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;

export function visibleDays(selectedDate: string, mode: CalendarMode) {
  const selected = civilDate(selectedDate);
  const first = mode === 'month'
    ? mondayOf(new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), 1)))
    : mode === 'week' ? mondayOf(selected) : selected;
  return Array.from({ length: mode === 'month' ? 42 : mode === 'week' ? 7 : 1 }, (_, index) => addDays(first, index));
}

/** Inclusive bounds, matching the API's gte/lte calendar query. */
export function getCalendarRange(selectedDate: string, mode: CalendarMode): CalendarRange {
  const days = visibleDays(selectedDate, mode);
  return {
    from: new Date(dayStart(days[0])).toISOString(),
    to: new Date(dayStart(addDays(days[days.length - 1], 1)) - 1).toISOString(),
  };
}

function parseInstant(value?: string | null) {
  if (!value) return NaN;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value.replace(' ', 'T');
  return Date.parse(normalized);
}

type ParsedItem = { item: CalendarItem; start: number; end: number; hasEnd: boolean };
export type CalendarSegment = {
  item: CalendarItem;
  startMinute: number;
  endMinute: number;
  visualStart: number;
  visualEnd: number;
  timeLabel: string;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export function parseItems(items: CalendarItem[]): ParsedItem[] {
  return items.flatMap((item) => {
    const start = parseInstant(item.start);
    if (!Number.isFinite(start)) return [];
    const suppliedEnd = parseInstant(item.end);
    const hasEnd = Number.isFinite(suppliedEnd) && suppliedEnd > start;
    return [{ item, start, end: hasEnd ? suppliedEnd : start + 30 * MINUTE_MS, hasEnd }];
  });
}

export function segmentsForDay(items: ParsedItem[], date: Date): CalendarSegment[] {
  const startOfDay = dayStart(date);
  const endOfDay = dayStart(addDays(date, 1));
  return items.flatMap(({ item, start, end, hasEnd }) => {
    // The footprint for an unknown end must not create another day's event.
    if (start >= endOfDay || (hasEnd ? end <= startOfDay : start < startOfDay)) return [];
    const wallMinute = (instant: number) => { const local = new Date(instant); return local.getHours() * 60 + local.getMinutes() + local.getSeconds() / 60; };
    const startMinute = start < startOfDay ? 0 : wallMinute(start);
    const endMinute = end >= endOfDay ? 1440 : wallMinute(end);
    const visualDuration = Math.max(endMinute - startMinute, MIN_EVENT_HEIGHT / HOUR_HEIGHT * 60);
    const visualStart = Math.min(startMinute, 1440 - visualDuration);
    const continuesBefore = start < startOfDay;
    const continuesAfter = hasEnd && end > endOfDay;
    const timeLabel = item.type === 'task' || item.type === 'follow_up' ? `${clock(startMinute)} · ${item.type === 'follow_up' ? '跟进' : STATUS_LABELS[item.status || 'open'] || '待办'}`
      : hasEnd ? `${continuesBefore ? '前日 ' : ''}${clock(startMinute)}–${clock(endMinute)}${continuesAfter ? ' 继续' : ''}`
        : clock(startMinute);
    return [{ item, startMinute, endMinute, visualStart, visualEnd: visualStart + visualDuration, timeLabel, continuesBefore, continuesAfter }];
  }).sort((left, right) => left.startMinute - right.startMinute || right.endMinute - left.endMinute || itemKey(left.item).localeCompare(itemKey(right.item)));
}

/** Place every connected overlap group in separate horizontal lanes. */
export function layoutCalendarSegments(segments: CalendarSegment[]) {
  const sorted = [...segments].sort((left, right) => left.visualStart - right.visualStart || right.visualEnd - left.visualEnd);
  const groups: CalendarSegment[][] = [];
  let group: CalendarSegment[] = [];
  let groupEnd = -1;
  for (const segment of sorted) {
    if (group.length && segment.visualStart >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = -1;
    }
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.visualEnd);
  }
  if (group.length) groups.push(group);
  return groups.flatMap((overlapping) => {
    const laneEnds: number[] = [];
    const placed = overlapping.map((segment) => {
      let lane = laneEnds.findIndex((end) => end <= segment.visualStart);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = segment.visualEnd;
      return { ...segment, lane };
    });
    return placed.map((segment) => ({ ...segment, lanes: laneEnds.length }));
  });
}

export function eventTone(item: CalendarItem) {
  if (item.status === 'done' || item.status === 'completed' || item.status === 'offer') return 'success';
  if (item.status === 'closed' || item.status === 'cancelled') return 'muted';
  if (item.type === 'task' || item.type === 'follow_up') return 'task';
  if (item.status === 'interview') return 'interview';
  if (item.status === 'screening') return 'screening';
  return 'default';
}

