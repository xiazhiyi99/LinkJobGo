'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

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
export type ApplicationsCalendarProps = {
  items: CalendarItem[];
  onSelect?: (item: CalendarItem) => void;
  onRangeChange?: (range: CalendarRange) => void;
  loading?: boolean;
  initialMode?: CalendarMode;
  initialDate?: string;
};

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const SHANGHAI_OFFSET = 8 * 60 * MINUTE_MS;
const HOUR_HEIGHT = 64;
const MIN_EVENT_HEIGHT = 28;
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const MODES: Array<{ value: CalendarMode; label: string }> = [
  { value: 'day', label: '日' }, { value: 'week', label: '周' }, { value: 'month', label: '月' },
];
const STATUS_LABELS: Record<string, string> = {
  saved: '待投递', applied: '已投递', screening: '筛选中', interview: '笔试/面试中',
  offer: '已获 offer', closed: '已结束', open: '待办', completed: '已完成', cancelled: '已取消',
};

// Civil calendar dates use UTC methods with a fixed Shanghai offset, independent
// of the browser timezone. API ranges and displayed times therefore stay aligned.
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const todayKey = () => dateKey(new Date(Date.now() + SHANGHAI_OFFSET));
const civilDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
const validDateKey = (key?: string): key is string => Boolean(key && /^\d{4}-\d{2}-\d{2}$/.test(key)
  && Number.isFinite(civilDate(key).getTime()) && dateKey(civilDate(key)) === key);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const mondayOf = (date: Date) => addDays(date, -((date.getUTCDay() + 6) % 7));
const dayStart = (date: Date) => date.getTime() - SHANGHAI_OFFSET;
const itemKey = (item: CalendarItem) => `${item.type}:${item.id}`;
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;
const shortDate = (date: Date) => `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;

function visibleDays(selectedDate: string, mode: CalendarMode) {
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
  // Date-only and timezone-less API values are interpreted in the UI timezone.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)
      ? `${value.replace(' ', 'T')}+08:00` : value;
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

function parseItems(items: CalendarItem[]): ParsedItem[] {
  return items.flatMap((item) => {
    const start = parseInstant(item.start);
    if (!Number.isFinite(start)) return [];
    const suppliedEnd = parseInstant(item.end);
    const hasEnd = Number.isFinite(suppliedEnd) && suppliedEnd > start;
    return [{ item, start, end: hasEnd ? suppliedEnd : start + 30 * MINUTE_MS, hasEnd }];
  });
}

function segmentsForDay(items: ParsedItem[], date: Date): CalendarSegment[] {
  const startOfDay = dayStart(date);
  const endOfDay = startOfDay + DAY_MS;
  return items.flatMap(({ item, start, end, hasEnd }) => {
    // The footprint for an unknown end must not create another day's event.
    if (start >= endOfDay || (hasEnd ? end <= startOfDay : start < startOfDay)) return [];
    const startMinute = Math.max(0, (start - startOfDay) / MINUTE_MS);
    const endMinute = Math.min(1440, (end - startOfDay) / MINUTE_MS);
    const visualDuration = Math.max(endMinute - startMinute, MIN_EVENT_HEIGHT / HOUR_HEIGHT * 60);
    const visualStart = Math.min(startMinute, 1440 - visualDuration);
    const continuesBefore = start < startOfDay;
    const continuesAfter = hasEnd && end > endOfDay;
    const timeLabel = item.type === 'task' ? `${clock(startMinute)} · 待办`
      : hasEnd ? `${continuesBefore ? '前日 ' : ''}${clock(startMinute)}–${clock(endMinute)}${continuesAfter ? ' 继续' : ''}`
        : `${clock(startMinute)} · 结束时间待定`;
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

function eventTone(item: CalendarItem) {
  if (item.status === 'completed' || item.status === 'offer') return 'success';
  if (item.status === 'closed' || item.status === 'cancelled') return 'muted';
  if (item.type === 'task') return 'task';
  if (item.status === 'interview') return 'interview';
  if (item.status === 'screening') return 'screening';
  return 'default';
}

export function ApplicationsCalendar({ items, onSelect, onRangeChange, loading = false, initialMode = 'month', initialDate }: ApplicationsCalendarProps) {
  const [mode, setMode] = useState<CalendarMode>(initialMode);
  const [selectedDate, setSelectedDate] = useState(() => validDateKey(initialDate) ? initialDate : todayKey());
  const rangeCallback = useRef(onRangeChange);
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => visibleDays(selectedDate, mode), [selectedDate, mode]);
  const range = useMemo(() => getCalendarRange(selectedDate, mode), [selectedDate, mode]);
  const parsedItems = useMemo(() => parseItems(items), [items]);
  const daysWithEvents = useMemo(() => days.map((date) => ({ date, segments: segmentsForDay(parsedItems, date) })), [days, parsedItems]);
  const today = todayKey();
  const selected = civilDate(selectedDate);
  const visibleCount = new Set(daysWithEvents.flatMap(({ segments }) => segments.map(({ item }) => itemKey(item)))).size;
  const earliestHour = Math.min(8, ...daysWithEvents.flatMap(({ segments }) => segments.map(({ startMinute }) => Math.floor(startMinute / 60))));

  useEffect(() => { rangeCallback.current = onRangeChange; }, [onRangeChange]);
  useEffect(() => { rangeCallback.current?.(range); }, [range.from, range.to]);
  useEffect(() => {
    if (mode !== 'month' && scrollRef.current) scrollRef.current.scrollTop = earliestHour * HOUR_HEIGHT;
  }, [mode, selectedDate, earliestHour]);

  const navigate = (direction: number) => {
    if (mode === 'month') {
      // Starting at day one prevents Jan 31 + one month from skipping February.
      setSelectedDate(dateKey(new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + direction, 1))));
    } else setSelectedDate(dateKey(addDays(selected, direction * (mode === 'week' ? 7 : 1))));
  };
  const openDay = (date: Date) => { setSelectedDate(dateKey(date)); setMode('day'); };
  const title = mode === 'month' ? `${selected.getUTCFullYear()} 年 ${selected.getUTCMonth() + 1} 月`
    : mode === 'day' ? `${selected.getUTCFullYear()} 年 ${shortDate(selected)}`
      : `${days[0].getUTCFullYear()} 年 ${shortDate(days[0])} – ${days[6].getUTCFullYear() !== days[0].getUTCFullYear() ? `${days[6].getUTCFullYear()} 年 ` : ''}${shortDate(days[6])}`;
  const navigationLabel = mode === 'month' ? '月' : mode === 'week' ? '周' : '天';

  const eventButton = (segment: CalendarSegment, timed = false, style?: CSSProperties) => {
    const label = `${segment.item.title || '未命名日程'}，${segment.timeLabel}，${STATUS_LABELS[segment.item.status || ''] || (segment.item.type === 'task' ? '待办' : '日程')}`;
    return <button
      key={itemKey(segment.item)} type="button"
      className={`application-calendar-event application-calendar-event--${eventTone(segment.item)}${timed ? ' application-calendar-event--timed' : ''}`}
      style={style} onClick={() => onSelect?.(segment.item)} title={label} aria-label={label}
    >
      <strong>{segment.item.title || '未命名日程'}</strong>
      <span>{segment.timeLabel}</span>
      {timed && segment.visualEnd - segment.visualStart >= 55 && <small>{STATUS_LABELS[segment.item.status || ''] || (segment.item.type === 'task' ? '待办' : '日程')}</small>}
    </button>;
  };

  return <section className="applications-calendar" aria-label="投递日历" aria-busy={loading}>
    <div className="application-calendar-toolbar">
      <div className="application-calendar-navigation">
        <button type="button" className="application-calendar-arrow" aria-label={`上一${navigationLabel}`} onClick={() => navigate(-1)}>‹</button>
        <button type="button" onClick={() => setSelectedDate(todayKey())}>今天</button>
        <button type="button" className="application-calendar-arrow" aria-label={`下一${navigationLabel}`} onClick={() => navigate(1)}>›</button>
      </div>
      <h3 aria-live="polite">{title}</h3>
      <div className="application-calendar-controls">
        <label className="application-calendar-date"><span className="application-calendar-sr-only">跳转到日期</span><input type="date" value={selectedDate} onChange={(event) => { if (validDateKey(event.target.value)) setSelectedDate(event.target.value); }} /></label>
        <div className="application-calendar-mode" role="group" aria-label="日历视图">
          {MODES.map((option) => <button key={option.value} type="button" aria-pressed={mode === option.value} onClick={() => setMode(option.value)}>{option.label}</button>)}
        </div>
      </div>
    </div>
    <div className="application-calendar-summary" aria-live="polite"><span>{loading ? '正在加载日程…' : visibleCount ? `${visibleCount} 项日程` : '这段时间暂无日程'}</span><span>北京时间 · GMT+8</span></div>

    {mode === 'month' ? <div className="application-calendar-month-scroll">
      <div className="application-calendar-month">
        <div className="application-calendar-weekdays">{WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
        <div className="application-calendar-month-grid">
          {daysWithEvents.map(({ date, segments }) => <div key={dateKey(date)} className={`application-calendar-month-day${date.getUTCMonth() !== selected.getUTCMonth() ? ' is-outside' : ''}${dateKey(date) === today ? ' is-today' : ''}`}>
            <button type="button" className="application-calendar-day-number" onClick={() => openDay(date)} aria-label={`查看 ${date.getUTCFullYear()} 年 ${shortDate(date)}日程`} aria-current={dateKey(date) === today ? 'date' : undefined}>{date.getUTCDate()}</button>
            <div className="application-calendar-month-events">{segments.slice(0, 3).map((segment) => eventButton(segment))}</div>
            {segments.length > 3 && <button className="application-calendar-more" type="button" onClick={() => openDay(date)}>还有 {segments.length - 3} 项</button>}
          </div>)}
        </div>
      </div>
    </div> : <div className={`application-calendar-time-scroll application-calendar-time-scroll--${mode}`} ref={scrollRef}>
      <div className="application-calendar-timetable" style={{ '--calendar-columns': days.length, '--calendar-hour-height': `${HOUR_HEIGHT}px` } as CSSProperties}>
        <div className="application-calendar-time-header">
          <span className="application-calendar-timezone">GMT+8</span>
          {days.map((date) => <button key={dateKey(date)} type="button" className={`application-calendar-time-day${dateKey(date) === today ? ' is-today' : ''}`} onClick={() => openDay(date)} aria-label={`查看 ${shortDate(date)}日程`}><span>{WEEKDAYS[(date.getUTCDay() + 6) % 7]}</span><strong>{date.getUTCDate()}</strong></button>)}
        </div>
        <div className="application-calendar-time-body">
          <div className="application-calendar-time-axis">{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>{String(hour).padStart(2, '0')}:00</span>)}</div>
          {daysWithEvents.map(({ date, segments }) => <div key={dateKey(date)} className={`application-calendar-time-column${dateKey(date) === today ? ' is-today' : ''}`} aria-label={`${shortDate(date)}，${segments.length} 项日程`}>
            {layoutCalendarSegments(segments).map((segment) => eventButton(segment, true, {
              top: segment.visualStart / 60 * HOUR_HEIGHT,
              height: (segment.visualEnd - segment.visualStart) / 60 * HOUR_HEIGHT - 2,
              left: `calc(${segment.lane * 100 / segment.lanes}% + 3px)`,
              width: `calc(${100 / segment.lanes}% - 6px)`,
            }))}
          </div>)}
        </div>
      </div>
    </div>}
  </section>;
}

export default ApplicationsCalendar;
