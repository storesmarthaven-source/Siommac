import { type VNode } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { type CalendarItemDTO } from '@api/calendar';
import { durationMinutes, isToday, itemDateKey, sameDay, timeLabel, toLocalDateKey, weekdayShort } from '@lib/calendar/date';

/**
 * Shared time-grid renderer for the Calendar Week and Day views. Renders an
 * hour-by-hour column per day with all-day items in a top band and timed items
 * positioned by their start time. Overlapping timed items share the column width
 * via a greedy lane assignment. Read-only projection — clicking an item opens it.
 */

const HOUR_H = 44;            // px per hour row
const HOURS = 24;
const GRID_H = HOURS * HOUR_H;
const SCROLL_TO = 7 * HOUR_H; // open scrolled to ~07:00

interface EventBlock { item: CalendarItemDTO; top: number; height: number; lane: number; lanes: number }

function minutesInto(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Position timed items on one day and assign overlap lanes cluster-by-cluster. */
function layoutDay(items: CalendarItemDTO[]): EventBlock[] {
  const timed = items
    .filter(item => !item.allDay && !!item.startsAt)
    .map(item => {
      const startMin = minutesInto(item.startsAt!);
      const dur = durationMinutes(item.startsAt, item.endsAt) ?? 60;
      const endMin = startMin + Math.max(30, dur);
      return { item, startMin, endMin, top: (startMin / 60) * HOUR_H, height: Math.max(22, (dur / 60) * HOUR_H) };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: EventBlock[] = [];
  let cluster: (typeof timed) = [];
  let clusterEnd = -1;
  const flush = (): void => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const laneOf = new Map<typeof cluster[number], number>();
    for (const b of cluster) {
      let lane = laneEnds.findIndex(end => end <= b.startMin);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(b.endMin); } else { laneEnds[lane] = b.endMin; }
      laneOf.set(b, lane);
    }
    const lanes = laneEnds.length;
    for (const b of cluster) out.push({ item: b.item, top: b.top, height: b.height, lane: laneOf.get(b) ?? 0, lanes });
    cluster = [];
  };
  for (const b of timed) {
    if (cluster.length && b.startMin >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = cluster.length === 1 ? b.endMin : Math.max(clusterEnd, b.endMin);
  }
  flush();
  return out;
}

function itemTone(item: CalendarItemDTO): string {
  if (item.type === 'deadline') return 'amber';
  if (item.type === 'task') return item.priority === 'high' ? 'rose' : 'indigo';
  return 'blue';
}

export function TimeGridView({ days, items, loading = false, onOpenItem, onCreateForDay }: {
  days: Date[];
  items: CalendarItemDTO[];
  loading?: boolean;
  onOpenItem: (item: CalendarItemDTO) => void;
  onCreateForDay?: (key: string) => void;
}): VNode {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO; }, []);

  const byDay = useMemo(() => days.map(day => {
    const key = toLocalDateKey(day);
    const dayItems = items.filter(item => itemDateKey(item) === key);
    return {
      day, key,
      allDay: dayItems.filter(item => item.allDay),
      blocks: layoutDay(dayItems),
    };
  }), [days, items]);

  const cols = days.length;
  const hours = Array.from({ length: HOURS }, (_, h) => h);

  return (
    <div class={`cal-tg cal-tg--${cols === 1 ? 'day' : 'week'}${loading ? ' is-loading' : ''}`} style={`--cal-tg-cols:${cols};--cal-tg-hour:${HOUR_H}px;--cal-tg-h:${GRID_H}px`} data-widget-content-root>
      <div class="cal-tg-head">
        <div class="cal-tg-gutter-cell" aria-hidden="true" />
        {byDay.map(({ day, key }) => (
          <div class={`cal-tg-dayhead${isToday(day) ? ' is-today' : ''}`} key={key}>
            <span>{weekdayShort(day)}</span>
            <strong>{day.getDate()}</strong>
          </div>
        ))}
      </div>

      <div class="cal-tg-allday">
        <div class="cal-tg-gutter-cell cal-tg-allday-label">All-day</div>
        {byDay.map(({ key, allDay, day }) => (
          <div class={`cal-tg-allday-col${isToday(day) ? ' is-today' : ''}`} key={key}>
            {allDay.map(item => (
              <button type="button" class={`cal-tg-allday-chip tone-${itemTone(item)}`} key={item.id} onClick={() => onOpenItem(item)} title={item.title}>{item.title}</button>
            ))}
          </div>
        ))}
      </div>

      <div class="cal-tg-scroll" ref={scrollRef}>
        <div class="cal-tg-grid">
          <div class="cal-tg-gutter">
            {hours.map(h => <div class="cal-tg-hour" key={h}><span>{`${h}`.padStart(2, '0')}:00</span></div>)}
          </div>
          {byDay.map(({ day, key, blocks }) => (
            <div class={`cal-tg-col${isToday(day) ? ' is-today' : ''}`} key={key} onDblClick={() => onCreateForDay?.(key)}>
              {isToday(day) ? <div class="cal-tg-now" style={`top:${(new Date().getHours() * 60 + new Date().getMinutes()) / 60 * HOUR_H}px`} aria-hidden="true" /> : null}
              {blocks.map(({ item, top, height, lane, lanes }) => {
                const width = 100 / lanes;
                return (
                  <button type="button" class={`cal-tg-event tone-${itemTone(item)}`} key={item.id}
                    style={`top:${top}px;height:${height}px;left:calc(${lane * width}% + 2px);width:calc(${width}% - 4px)`}
                    onClick={() => onOpenItem(item)} title={item.title}>
                    <span class="cal-tg-event-time">{item.startsAt ? timeLabel(item.startsAt) : ''}</span>
                    <span class="cal-tg-event-title">{item.title}</span>
                  </button>
                );
              })}
              {!loading && !blocks.length && !byDay.find(d => d.key === key)?.allDay.length && sameDay(day, days[0] ?? day) && cols === 1
                ? <div class="cal-tg-day-empty">No timed items — double-click a slot to add one.</div> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
