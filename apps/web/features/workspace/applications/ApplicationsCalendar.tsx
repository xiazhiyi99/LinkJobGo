'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { type CalendarItem, type CalendarMode, type CalendarRange, type CalendarSegment, STATUS_LABELS, dateKey, todayKey, civilDate, validDateKey, addDays, itemKey, shortDate, visibleDays, getCalendarRange, parseItems, segmentsForDay, layoutCalendarSegments, eventTone } from './calendar-model';
import { localTimeZone } from './date-time';
export { type CalendarItem, type CalendarRange, getCalendarRange, layoutCalendarSegments } from './calendar-model';
const HOUR_HEIGHT = 64;
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const MODES: Array<{ value: CalendarMode; label: string }> = [
  { value: 'day', label: '日' }, { value: 'week', label: '周' }, { value: 'month', label: '月' },
];

export type ApplicationsCalendarProps = {
  items: CalendarItem[];
  onSelect?: (item: CalendarItem) => void;
  onRangeChange?: (range: CalendarRange) => void;
  loading?: boolean;
  initialMode?: CalendarMode;
  initialDate?: string;
};

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
    <div className="application-calendar-summary" aria-live="polite"><span>{loading ? '正在加载日程…' : visibleCount ? `${visibleCount} 项日程` : '这段时间暂无日程'}</span><span>本地时间 · {localTimeZone()}</span></div>

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
          <span className="application-calendar-timezone">本地时间</span>
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
