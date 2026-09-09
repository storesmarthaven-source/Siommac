import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type CalendarHolidayMarkerDTO, type CalendarItemDTO } from '@api/calendar';
import { type WeatherDay } from '@api/weather';
import { AvatarGroup, Button, DropdownMenu, LucideIcon, type LucideName } from '@ui';
import { isToday, itemDateKey, localTimestamp, sameDay, timeLabel, toLocalDateKey, weekdayShort } from '@lib/calendar/date';
import { calendarCustomColorVariables } from './calendarColor';
import { CalendarTitleIcon } from './CalendarTitleIconPicker';
import { calendarItemKind } from './calendarViewModel';

/**
 * Shared time-grid renderer for the Calendar Week and Day views. Renders an
 * hour-by-hour column per day with all-day items in a top band and timed items
 * positioned by their start time. Overlapping timed items use a greedy lane
 * assignment: Day uses equal side-by-side lanes while Week keeps compact
 * offset layers so narrow columns remain readable.
 * Read-only projection — clicking an item opens it.
 */

const HOUR_H = 196;           // spacious timeline; wheel zoom preserves the cursor's time anchor
const DAY_HOUR_H = 88;        // compact Day view while preserving precise minute placement
// A day is a stable layout unit. Narrowing the viewport scrolls the timeline
// horizontally instead of compressing rich cards below their content budget.
const DAY_W = 220;
const GRID_GUTTER_W = 78;
const WEEK_DAY_RAIL_W = 150;
const WEEK_HOUR_W = 104;
const WEEK_CARD_H = 58;
const WEEK_STACK_STEP = 24;
const HOURS = 24;
// These heights are content budgets, not decoration. They fit a complete line
// box for every element each tier exposes so titles and metadata are never
// sliced midway through a line at the default or enlarged timeline zoom.
const CARD_MIN_HEIGHT = { small: 96, medium: 144, large: 200 } as const;
const CARD_MAX_WIDTH = { small: 300, medium: 380, large: 460 } as const;
const DAY_CARD_MIN_HEIGHT = { small: 44, medium: 66, large: 80 } as const;
// Preserve the time-grid coordinates while leaving a deliberate visual break
// between sequential cards. Compact cards retain their readable 40px floor.
const EVENT_VERTICAL_GUTTER_PX = 8;
const EVENT_MIN_RENDER_HEIGHT_PX = 40;
// Keep resized Day-view cards large enough for the compact card's title and
// time rows. Three 15-minute grid increments map to that readable footprint.
const MIN_RESIZE_DURATION_MINUTES = 45;

function setPointerCaptureIfSupported(element: Element, pointerId: number): void {
  const capture = Reflect.get(element, 'setPointerCapture');
  if (typeof capture === 'function') Reflect.apply(capture, element, [pointerId]);
}

function releasePointerCaptureIfSupported(element: Element, pointerId: number): void {
  const release = Reflect.get(element, 'releasePointerCapture');
  if (typeof release === 'function') Reflect.apply(release, element, [pointerId]);
}

type CardSize = keyof typeof CARD_MIN_HEIGHT;

function renderedEventHeight(layoutHeight: number): number {
  return Math.max(EVENT_MIN_RENDER_HEIGHT_PX, layoutHeight - EVENT_VERTICAL_GUTTER_PX);
}

interface EventBlock { item: CalendarItemDTO; top: number; height: number; lane: number; lanes: number; stackGroup: number; size: CardSize; spansMultipleDays: boolean }
type HolidayTheme = 'national' | 'emancipation' | 'divali' | 'eid' | 'christmas' | 'arrival' | 'labour' | 'faith' | 'new-year' | 'civic';
type GridContext =
  | { kind: 'slot'; x: number; y: number; key: string; time: string }
  | { kind: 'item'; x: number; y: number; item: CalendarItemDTO };
interface TimelineLine { top: number; minutes: number; label: string }
interface DragSelection { key: string; pointerId: number; anchorMinutes: number; focusMinutes: number; startX: number; startY: number; dragged: boolean }
interface CardMoveSelection { item: CalendarItemDTO; pointerId: number; targetKey: string; startMinutes: number; durationMinutes: number; grabOffsetMinutes: number; startX: number; startY: number; dragged: boolean }
interface CardResizeSelection { item: CalendarItemDTO; pointerId: number; startX: number; startY: number; pixelsPerMinute: number; startDurationMinutes: number; durationMinutes: number; dragged: boolean }
interface WeekPanSelection { pointerId: number; startX: number; scrollLeft: number }
export interface CalendarDraftSelection { key: string; startTime: string; endTime: string }

const HOLIDAY_THEME_ICONS = {
  national: 'Flag',
  emancipation: 'Sunrise',
  divali: 'Flame',
  eid: 'MoonStar',
  christmas: 'Sparkles',
  arrival: 'Sailboat',
  labour: 'Hammer',
  faith: 'Church',
  'new-year': 'PartyPopper',
  civic: 'Landmark',
} as const satisfies Record<HolidayTheme, LucideName>;

function holidayTheme(name: string): HolidayTheme {
  const value = name.trim().toLocaleLowerCase();
  if (value.includes('independence') || value.includes('republic')) return 'national';
  if (value.includes('emancipation')) return 'emancipation';
  if (value.includes('divali') || value.includes('diwali')) return 'divali';
  if (value.includes('eid')) return 'eid';
  if (value.includes('christmas') || value.includes('boxing')) return 'christmas';
  if (value.includes('indian arrival')) return 'arrival';
  if (value.includes('labour')) return 'labour';
  if (value.includes('baptist') || value.includes('good friday') || value.includes('easter') || value.includes('corpus christi')) return 'faith';
  if (value.includes('new year')) return 'new-year';
  return 'civic';
}

function HolidayHeaderArtwork({ theme }: { theme: HolidayTheme }): VNode {
  if (theme === 'national') return <span class="cal-tg-holiday-art is-national" aria-hidden="true">
    <span class="cal-holiday-flag-brush" />
    <span class="cal-holiday-skyline"><i /><i /><i /><i /><i /><i /></span>
  </span>;
  if (theme === 'emancipation') return <span class="cal-tg-holiday-art is-emancipation" aria-hidden="true">
    <span class="cal-holiday-sun" />
    <span class="cal-holiday-textile" />
    <LucideIcon name="Sunrise" size={15} />
  </span>;
  if (theme === 'divali') return <span class="cal-tg-holiday-art is-divali" aria-hidden="true">
    <span class="cal-holiday-ornament" />
    <span class="cal-holiday-deya is-back"><i /></span>
    <span class="cal-holiday-deya is-middle"><i /></span>
    <span class="cal-holiday-deya is-front"><i /></span>
  </span>;
  if (theme === 'eid') return <span class="cal-tg-holiday-art is-eid" aria-hidden="true">
    <span class="cal-holiday-stars"><i /><i /><i /></span>
    <span class="cal-holiday-crescent" />
    <span class="cal-holiday-mosque"><i /><i /><i /><i /><i /></span>
  </span>;
  return <span class={`cal-tg-holiday-art is-${theme}`} aria-hidden="true">
    <span class="cal-holiday-generic-halo" />
    <LucideIcon name={HOLIDAY_THEME_ICONS[theme]} size={16} />
  </span>;
}

function WeatherConditionIcon({ code }: { code: number }): VNode {
  const isClear = code === 0 || code === 1;
  const isPartlyCloudy = code === 2;
  const hasRain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  const hasLightning = code >= 95;

  return <svg class={`cal-weather-glyph${isClear ? ' is-clear' : ''}${hasRain ? ' has-rain' : ''}`} data-weather-code={code} viewBox="0 0 36 32" aria-hidden="true">
    {isClear || isPartlyCloudy ? <g class="cal-weather-glyph-sun">
      <circle cx={isClear ? 18 : 24} cy={isClear ? 16 : 10} r="5" />
      <path d={isClear ? 'M18 3v4M18 25v4M5 16h4M27 16h4M8.8 6.8l2.8 2.8M24.4 22.4l2.8 2.8M27.2 6.8l-2.8 2.8M11.6 22.4l-2.8 2.8' : 'M24 2v3M24 15v3M16 10h3M29 10h3M18.4 4.4l2.1 2.1M27.5 13.5l2.1 2.1M29.6 4.4l-2.1 2.1'} />
    </g> : null}
    {!isClear ? <path class="cal-weather-glyph-cloud" d="M9.4 23.5h16.1a6 6 0 0 0 .5-12 8.2 8.2 0 0 0-15.4 2.1A5 5 0 0 0 9.4 23.5Z" /> : null}
    {hasRain ? <g class="cal-weather-glyph-rain"><path d="m12 26-1.5 3M19 26l-1.5 3M26 26l-1.5 3" /></g> : null}
    {hasLightning ? <path class="cal-weather-glyph-lightning" d="m20 22-3 5h3l-1 4 5-6h-3l2-3Z" /> : null}
  </svg>;
}

function minutesInto(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function shortDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** All expanded cards share one visual tier; only explicit minimising is smaller. */
function itemCardSize(_item: CalendarItemDTO): CardSize {
  return 'medium';
}

/** Position timed items on one day and assign overlap lanes cluster-by-cluster. */
function layoutDay(
  items: CalendarItemDTO[],
  day: Date,
  hourHeight: number,
  minimizedItemIds: ReadonlySet<string>,
  cardMinHeight: Readonly<Record<CardSize, number>> = CARD_MIN_HEIGHT,
  scaleBase = HOUR_H,
  fitToDuration = false,
  collisionByDuration = false,
): EventBlock[] {
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const timed = items
    .filter(item => !item.allDay && !!item.startsAt)
    .map(item => {
      const itemStart = new Date(item.startsAt!).getTime();
      const itemEnd = item.endsAt ? new Date(item.endsAt).getTime() : itemStart + 60 * 60_000;
      const spansMultipleDays = itemEnd > dayEnd;
      const startMin = minutesInto(item.startsAt!);
      const isMinimized = minimizedItemIds.has(item.id);
      const size = isMinimized ? 'small' : itemCardSize(item);
      const cardScale = Math.max(1, hourHeight / scaleBase);
      const contentHeight = Math.round(cardMinHeight[size] * cardScale);
      const durationHeight = Math.max(1, ((itemEnd - itemStart) / 60_000 / 60) * hourHeight);
      // Day view is a direct time map: a normal event begins and ends on its
      // corresponding grid lines. Multi-day records remain one compact visual
      // card rather than stretching through the remainder of this day.
      const height = fitToDuration && !spansMultipleDays && !isMinimized ? durationHeight : contentHeight;
      // Collision detection follows the rendered card, not only its semantic
      // duration. This keeps minimum-height cards from visually overlapping.
      // Collision detection uses the same rendered height as the card. Using
      // the raw layout height here would falsely split sequential cards into
      // narrow overlap lanes even though the visual gutter keeps them apart.
      const visualDuration = (renderedEventHeight(height) / hourHeight) * 60;
      // A multi-day card's collision footprint follows its compact visual card,
      // not all remaining hours in the first day.
      const semanticDuration = Math.max(15, Math.min((24 * 60) - startMin, (itemEnd - itemStart) / 60_000));
      const collisionDuration = collisionByDuration ? semanticDuration : Math.max(30, visualDuration);
      const visualEndMin = startMin + collisionDuration;
      return { item, startMin, endMin: visualEndMin, top: (startMin / 60) * hourHeight, height, size, spansMultipleDays };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: EventBlock[] = [];
  let cluster: (typeof timed) = [];
  let clusterEnd = -1;
  let nextStackGroup = 0;
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
    const stackGroup = nextStackGroup++;
    for (const b of cluster) out.push({ item: b.item, top: b.top, height: b.height, lane: laneOf.get(b) ?? 0, lanes, stackGroup, size: b.size, spansMultipleDays: b.spansMultipleDays });
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
  // A source's semantic treatment is part of the Calendar information
  // architecture. It must win over an optional user colour, otherwise staged
  // and persisted Toolbox Talks can silently fall back to the amber event
  // palette instead of their standard navy card.
  if (item.sourceLabel?.toLocaleLowerCase().includes('talk')) return 'navy';
  if (calendarItemKind(item) === 'meeting') return 'blue';
  if (item.colorKey) return item.colorKey;
  if (item.type === 'deadline') return 'amber';
  if (item.type === 'task') return item.priority === 'high' ? 'coral' : 'purple';
  const tones = ['mint', 'blue', 'coral', 'amber', 'purple'] as const;
  const hash = Array.from(`${item.sourceModule ?? ''}:${item.title}`).reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0);
  return tones[hash % tones.length]!;
}

function sourceMeta(item: CalendarItemDTO): { label: string; icon: LucideName } {
  const source = item.sourceModule?.toLocaleLowerCase();
  const sourceLabel = item.sourceLabel?.toLocaleLowerCase() ?? '';
  if (calendarItemKind(item) === 'meeting') return { label: 'Meeting', icon: 'Video' };
  if (sourceLabel === 'field operation') return { label: 'Field operation', icon: 'MapPin' };
  if (item.locationLabel) return { label: 'Location', icon: 'MapPin' };
  if (sourceLabel.includes('talk')) return { label: item.sourceLabel ?? 'Talk', icon: 'Presentation' };
  if (sourceLabel.includes('reminder')) return { label: item.sourceLabel ?? 'Reminder', icon: 'Bell' };
  if (sourceLabel.includes('milestone')) return { label: item.sourceLabel ?? 'Milestone', icon: 'Flag' };
  if (item.type === 'task') return { label: 'Task', icon: 'ListChecks' };
  if (item.type === 'deadline') return { label: item.sourceLabel ?? 'Deadline', icon: 'CalendarClock' };
  if (source === 'hse') return { label: 'HSE', icon: 'ShieldCheck' };
  if (source === 'payroll') return { label: 'Payroll', icon: 'WalletCards' };
  if (source === 'workflow') return { label: 'Workflow', icon: 'GitBranch' };
  return { label: 'Calendar', icon: 'CalendarDays' };
}

function deadlineMeta(item: CalendarItemDTO): { label: string; state: 'scheduled' | 'soon' | 'overdue' } | null {
  if (!item.deadlineAt) return null;
  const deadline = new Date(item.deadlineAt);
  if (Number.isNaN(deadline.getTime())) return null;
  const now = Date.now();
  const isClosedTask = item.type === 'task' && (item.status === 'done' || item.status === 'cancelled');
  const state = !isClosedTask && deadline.getTime() < now
    ? 'overdue'
    : deadline.getTime() - now <= 48 * 60 * 60_000
      ? 'soon'
      : 'scheduled';
  const sameDate = deadline.toDateString() === new Date().toDateString();
  const date = sameDate ? '' : `${deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · `;
  return { label: `Due ${date}${timeLabel(item.deadlineAt)}`, state };
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const value = hour % 12 || 12;
  return `${value}:00 ${suffix}`;
}

function timelineLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 || 12}:${`${minute}`.padStart(2, '0')} ${suffix}`;
}

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, character => character.toLocaleUpperCase());
}

function inputTime(minutes: number): string {
  const safeMinutes = Math.max(0, Math.min((24 * 60) - 1, minutes));
  return `${`${Math.floor(safeMinutes / 60)}`.padStart(2, '0')}:${`${safeMinutes % 60}`.padStart(2, '0')}`;
}

function inputMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Math.max(0, Math.min((24 * 60) - 1, (Number(hours) * 60) + Number(minutes)));
}

export function TimeGridView({ mode, days, items, holidays = [], weatherDays = [], weatherLocationLabel, loading = false, zoom = 1, showAllDay = true, enteringItemId = null, draftSelection = null, onZoomChange, onOpenItem, onEditItem, onOpenSource, onSetReminder, onDeleteItem, onMoveItem, onCreateForDay, onCreateMeeting, onPrevious, onNext, onEntryAnimationEnd, attendeePeople }: {
  mode?: 'day' | 'week';
  days: Date[];
  items: CalendarItemDTO[];
  holidays?: CalendarHolidayMarkerDTO[];
  weatherDays?: WeatherDay[];
  weatherLocationLabel?: string;
  loading?: boolean;
  zoom?: number;
  showAllDay?: boolean;
  enteringItemId?: string | null;
  draftSelection?: CalendarDraftSelection | null;
  onZoomChange?: (zoom: number) => void;
  onOpenItem: (item: CalendarItemDTO, point?: { x: number; y: number }) => void;
  onEditItem?: (item: CalendarItemDTO, point: { x: number; y: number }) => void;
  onOpenSource?: (item: CalendarItemDTO) => void;
  onSetReminder?: (item: CalendarItemDTO) => void;
  onDeleteItem?: (item: CalendarItemDTO) => void;
  onMoveItem?: (item: CalendarItemDTO, key: string, startTime: string, durationMinutes: number) => void | Promise<void>;
  onCreateForDay?: (key: string, startTime?: string, type?: 'event' | 'task' | 'reminder', point?: { x: number; y: number }, endTime?: string) => void;
  onCreateMeeting?: (key: string, startTime: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onEntryAnimationEnd?: (id: string) => void;
  attendeePeople?: Record<string, { id: string; name: string; src?: string | null }[]>;
}): VNode {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [contextAnchor, setContextAnchor] = useState<HTMLSpanElement | null>(null);
  const [context, setContext] = useState<GridContext | null>(null);
  const [minimizedItemIds, setMinimizedItemIds] = useState<Set<string>>(() => new Set());
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  const dragSelectionRef = useRef<DragSelection | null>(null);
  const [cardMove, setCardMove] = useState<CardMoveSelection | null>(null);
  const cardMoveRef = useRef<CardMoveSelection | null>(null);
  const [cardResize, setCardResize] = useState<CardResizeSelection | null>(null);
  const cardResizeRef = useRef<CardResizeSelection | null>(null);
  const [weekPanning, setWeekPanning] = useState(false);
  const weekPanRef = useRef<WeekPanSelection | null>(null);
  const suppressItemClickRef = useRef<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const effectiveMode = mode ?? (days.length === 1 ? 'day' : 'week');
  const isDayMode = effectiveMode === 'day';
  const hourHeightBase = isDayMode ? DAY_HOUR_H : HOUR_H;
  const hourHeight = Math.round(hourHeightBase * zoom);
  const weekHourWidth = Math.round(WEEK_HOUR_W * zoom);
  const previousHourHeightRef = useRef(hourHeight);
  const previousWeekHourWidthRef = useRef(weekHourWidth);
  const zoomAnchorRef = useRef<{ offsetY: number; logicalY: number } | null>(null);
  const weekZoomAnchorRef = useRef<{ offsetX: number; logicalX: number } | null>(null);
  const daySignature = days.map(toLocalDateKey).join('|');
  useEffect(() => {
    if (!days.some(isToday)) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [daySignature]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let aligned = false;
    const alignWorkingDay = (): void => {
      if (aligned) return;
      const currentMoment = new Date();
      if (!isDayMode) {
        if (scroll.scrollWidth <= scroll.clientWidth) return;
        const currentDay = days.findIndex(isToday);
        const focusMinutes = currentDay >= 0 ? currentMoment.getHours() * 60 + currentMoment.getMinutes() : 9 * 60;
        const focusX = WEEK_DAY_RAIL_W + (focusMinutes / 60) * Math.round(WEEK_HOUR_W * zoom);
        scroll.scrollLeft = Math.max(0, Math.min(focusX - scroll.clientWidth * .48, scroll.scrollWidth - scroll.clientWidth));
        aligned = true;
        return;
      }
      if (scroll.scrollHeight <= scroll.clientHeight) return;
      const currentTimeTop = ((currentMoment.getHours() * 60 + currentMoment.getMinutes()) / 60) * hourHeight;
      const pinnedHeaderHeight = Array.from(scroll.querySelectorAll<HTMLElement>('.cal-tg-head, .cal-tg-allday'))
        .reduce((total, element) => total + element.getBoundingClientRect().height, 0);
      const visibleTimelineHeight = Math.max(hourHeightBase, scroll.clientHeight - pinnedHeaderHeight);
      const currentWindowStart = Math.round((currentTimeTop - (visibleTimelineHeight * 0.65)) / hourHeight) * hourHeight;
      const desiredTop = days.some(isToday)
        ? currentWindowStart
        : 9 * hourHeight;
      scroll.scrollTop = Math.max(0, Math.min(desiredTop, scroll.scrollHeight - scroll.clientHeight));
      const todayIndex = days.findIndex(isToday);
      if (todayIndex >= 0 && scroll.scrollWidth > scroll.clientWidth) {
        const gutterWidth = scroll.querySelector<HTMLElement>('.cal-tg-gutter-cell')?.getBoundingClientRect().width ?? 78;
        const dayWidth = scroll.querySelector<HTMLElement>('.cal-tg-dayhead')?.getBoundingClientRect().width
          ?? (scroll.scrollWidth - gutterWidth) / days.length;
        const visibleDays = Math.max(1, Math.floor((scroll.clientWidth - gutterWidth) / dayWidth));
        const firstVisibleDay = Math.max(0, Math.min(todayIndex - visibleDays + 1, days.length - visibleDays));
        scroll.scrollLeft = Math.max(0, Math.min(firstVisibleDay * dayWidth, scroll.scrollWidth - scroll.clientWidth));
      }
      aligned = true;
    };
    alignWorkingDay();
    const frame = window.requestAnimationFrame(alignWorkingDay);
    const timer = window.setTimeout(alignWorkingDay, 120);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(alignWorkingDay);
    observer?.observe(scroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [daySignature, isDayMode]);

  useEffect(() => {
    const previous = previousHourHeightRef.current;
    const scroll = scrollRef.current;
    if (scroll && previous !== hourHeight) {
      const anchor = zoomAnchorRef.current;
      scroll.scrollTop = anchor
        ? (anchor.logicalY * (hourHeight / previous)) - anchor.offsetY
        : (scroll.scrollTop / previous) * hourHeight;
    }
    zoomAnchorRef.current = null;
    previousHourHeightRef.current = hourHeight;
  }, [hourHeight]);
  useEffect(() => {
    const previous = previousWeekHourWidthRef.current;
    const scroll = scrollRef.current;
    if (!isDayMode && scroll && previous !== weekHourWidth) {
      const anchor = weekZoomAnchorRef.current;
      scroll.scrollLeft = anchor
        ? (anchor.logicalX * (weekHourWidth / previous)) - anchor.offsetX
        : (scroll.scrollLeft / previous) * weekHourWidth;
    }
    weekZoomAnchorRef.current = null;
    previousWeekHourWidthRef.current = weekHourWidth;
  }, [isDayMode, weekHourWidth]);

  const layoutItems = useMemo(() => {
    if (cardMove?.dragged) {
      const startsAt = localTimestamp(cardMove.targetKey, inputTime(cardMove.startMinutes));
      const endsAt = new Date(new Date(startsAt).getTime() + cardMove.durationMinutes * 60_000).toISOString();
      return items.map(item => item.id === cardMove.item.id
        ? { ...item, allDay: false, startsOn: null, endsOn: null, startsAt, endsAt }
        : item);
    }
    if (cardResize?.dragged && cardResize.item.startsAt) {
      const endsAt = new Date(new Date(cardResize.item.startsAt).getTime() + cardResize.durationMinutes * 60_000).toISOString();
      return items.map(item => item.id === cardResize.item.id ? { ...item, endsAt } : item);
    }
    return items;
  }, [cardMove, cardResize, items]);

  const byDay = useMemo(() => days.map(day => {
    const key = toLocalDateKey(day);
    // Every item has one visual home. Multi-day dates remain part of the item's
    // metadata, but the board never clones or stretches the card across days.
    const dayItems = layoutItems.filter(item => itemDateKey(item) === key);
    return {
      day, key,
      allDay: dayItems.filter(item => item.allDay),
      blocks: layoutDay(dayItems, day, hourHeight, minimizedItemIds, isDayMode ? DAY_CARD_MIN_HEIGHT : CARD_MIN_HEIGHT, hourHeightBase, isDayMode, !isDayMode),
    };
  }), [days, hourHeight, hourHeightBase, isDayMode, layoutItems, minimizedItemIds]);
  const holidaysByDate = useMemo(() => {
    const grouped = new Map<string, CalendarHolidayMarkerDTO[]>();
    for (const holiday of holidays) grouped.set(holiday.date, [...(grouped.get(holiday.date) ?? []), holiday]);
    return grouped;
  }, [holidays]);
  const weatherByDate = useMemo(() => new Map(weatherDays.map(day => [day.date, day])), [weatherDays]);

  const cols = days.length;
  const dayMinWidth = isDayMode ? DAY_W : 0;
  const gridMinWidth = isDayMode ? GRID_GUTTER_W + (cols * DAY_W) : 0;
  const hasAllDay = showAllDay;
  const hours = Array.from({ length: HOURS }, (_, h) => h);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nearestHour = Math.round(nowMinutes / 60);
  const currentTimeObscuresHour = days.some(isToday)
    && nearestHour >= 0
    && nearestHour < HOURS
    && Math.abs(nowMinutes - nearestHour * 60) <= 18;
  const hasItemActions = (item: CalendarItemDTO): boolean => (
    (!item.allDay && (itemCardSize(item) !== 'small' || minimizedItemIds.has(item.id)))
    || Boolean(item.editable && onEditItem)
    || Boolean(item.sourceRoute && onOpenSource)
    || Boolean(item.origin === 'calendar' && item.status !== 'done' && item.status !== 'cancelled' && onSetReminder)
    || Boolean(item.cancelable && onDeleteItem)
  );

  const slotTime = (clientX: number, clientY: number, column: HTMLElement): string => {
    const bounds = column.getBoundingClientRect();
    const rawMinutes = isDayMode
      ? ((clientY - bounds.top) / hourHeight) * 60
      : ((clientX - bounds.left) / Math.max(1, bounds.width)) * HOURS * 60;
    const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round(rawMinutes / 15) * 15));
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`;
  };

  const lineFromClientY = (clientY: number): TimelineLine | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const bounds = grid.getBoundingClientRect();
    const renderedHeight = bounds.height || grid.clientHeight || HOURS * hourHeight;
    const rawMinutes = ((clientY - bounds.top) / renderedHeight) * HOURS * 60;
    const minutes = Math.max(0, Math.min((HOURS * 60) - 1, Math.round(rawMinutes)));
    const top = (minutes / (HOURS * 60)) * renderedHeight;
    return { top, minutes, label: timelineLabel(minutes) };
  };

  const timelineSlotTime = (minutes: number): string => {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`;
  };

  const pointerMinutes = (clientX: number, clientY: number, column: HTMLElement): number => {
    const bounds = column.getBoundingClientRect();
    const rawMinutes = isDayMode
      ? ((clientY - bounds.top) / hourHeight) * 60
      : ((clientX - bounds.left) / Math.max(1, bounds.width)) * HOURS * 60;
    return Math.max(0, Math.min((24 * 60) - 15, Math.floor(rawMinutes / 15) * 15));
  };

  const beginDragSelection = (event: PointerEvent, key: string, column: HTMLElement): void => {
    if (!onCreateForDay || event.button !== 0 || event.shiftKey || (event.target as HTMLElement).closest('.cal-tg-event')) return;
    const minutes = pointerMinutes(event.clientX, event.clientY, column);
    const next = { key, pointerId: event.pointerId, anchorMinutes: minutes, focusMinutes: minutes, startX: event.clientX, startY: event.clientY, dragged: false };
    dragSelectionRef.current = next;
    setDragSelection(next);
    setPointerCaptureIfSupported(column, event.pointerId);
  };

  const moveDragSelection = (event: PointerEvent, key: string, column: HTMLElement): void => {
    const current = dragSelectionRef.current;
    if (current === null) return;
    if (current.key !== key || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const next = {
      ...current,
      focusMinutes: pointerMinutes(event.clientX, event.clientY, column),
      dragged: current.dragged || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 4,
    };
    dragSelectionRef.current = next;
    setDragSelection(next);
  };

  const finishDragSelection = (event: PointerEvent, key: string, column: HTMLElement): void => {
    const current = dragSelectionRef.current;
    if (current === null) return;
    if (current.key !== key || current.pointerId !== event.pointerId) return;
    releasePointerCaptureIfSupported(column, event.pointerId);
    dragSelectionRef.current = null;
    setDragSelection(null);
    if (!current.dragged) return;
    const startMinutes = Math.min(current.anchorMinutes, current.focusMinutes);
    const endMinutes = Math.min((24 * 60) - 1, Math.max(current.anchorMinutes, current.focusMinutes) + 15);
    onCreateForDay?.(key, inputTime(startMinutes), 'event', { x: event.clientX, y: event.clientY }, inputTime(endMinutes));
  };

  const cancelDragSelection = (event: PointerEvent, key: string, column: HTMLElement): void => {
    const current = dragSelectionRef.current;
    if (current === null) return;
    if (current.key !== key || current.pointerId !== event.pointerId) return;
    releasePointerCaptureIfSupported(column, event.pointerId);
    dragSelectionRef.current = null;
    setDragSelection(null);
  };

  const cardMoveTarget = (clientX: number, clientY: number, grabOffsetMinutes: number, eventTarget?: EventTarget | null, explicitTarget?: HTMLElement | null): { key: string; startMinutes: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const columns = Array.from(grid.querySelectorAll<HTMLElement>(isDayMode ? '.cal-tg-col' : '.cal-tg-week-row-track'));
    if (!columns.length) return null;
    const directTarget = !isDayMode
      ? explicitTarget ?? (eventTarget instanceof Element ? eventTarget.closest<HTMLElement>('.cal-tg-week-row-track') : null)
      : null;
    const targetColumn = directTarget ?? columns.find(column => {
      const bounds = column.getBoundingClientRect();
      return isDayMode
        ? clientX >= bounds.left && clientX <= bounds.right
        : clientY >= bounds.top && clientY <= bounds.bottom;
    }) ?? columns.reduce((nearest, column) => {
      const nearestBounds = nearest.getBoundingClientRect();
      const columnBounds = column.getBoundingClientRect();
      const pointer = isDayMode ? clientX : clientY;
      const nearestCentre = isDayMode ? (nearestBounds.left + nearestBounds.right) / 2 : (nearestBounds.top + nearestBounds.bottom) / 2;
      const columnCentre = isDayMode ? (columnBounds.left + columnBounds.right) / 2 : (columnBounds.top + columnBounds.bottom) / 2;
      return Math.abs(pointer - columnCentre) < Math.abs(pointer - nearestCentre) ? column : nearest;
    });
    const bounds = targetColumn.getBoundingClientRect();
    const rawMinutes = isDayMode
      ? ((clientY - bounds.top) / hourHeight) * 60 - grabOffsetMinutes
      : ((clientX - bounds.left) / Math.max(1, bounds.width)) * HOURS * 60 - grabOffsetMinutes;
    const startMinutes = Math.max(0, Math.min((24 * 60) - 15, Math.round(rawMinutes / 15) * 15));
    const key = targetColumn.dataset.dateKey;
    return key ? { key, startMinutes } : null;
  };

  const beginCardMove = (event: PointerEvent, item: CalendarItemDTO, card: HTMLElement): void => {
    if (!onMoveItem || event.button !== 0 || item.allDay || !item.startsAt || !item.editable || (event.target as HTMLElement).closest('.cal-tg-event-resize')) return;
    event.stopPropagation();
    const bounds = card.getBoundingClientRect();
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = item.endsAt ? new Date(item.endsAt).getTime() : startsAt + 60 * 60_000;
    const durationMinutes = Math.max(15, Math.round((endsAt - startsAt) / 60_000));
    const grabOffsetMinutes = Math.max(0, Math.min(durationMinutes - 15, isDayMode
      ? ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * Math.min(durationMinutes, 120)
      : ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * durationMinutes));
    const current = {
      item,
      pointerId: event.pointerId,
      targetKey: itemDateKey(item) ?? toLocalDateKey(days[0] ?? new Date()),
      startMinutes: minutesInto(item.startsAt),
      durationMinutes,
      grabOffsetMinutes,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    };
    cardMoveRef.current = current;
    setCardMove(current);
  };

  const moveCard = (event: PointerEvent, card: HTMLElement, explicitTarget?: HTMLElement | null): void => {
    const current = cardMoveRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dragged = current.dragged || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 5;
    if (!dragged) return;
    event.preventDefault();
    if (!current.dragged) setPointerCaptureIfSupported(isDayMode ? card : scrollRef.current ?? card, event.pointerId);
    const target = cardMoveTarget(event.clientX, event.clientY, current.grabOffsetMinutes, event.target, explicitTarget);
    if (!target) return;
    const next = { ...current, targetKey: target.key, startMinutes: target.startMinutes, dragged: true };
    cardMoveRef.current = next;
    setCardMove(next);
  };

  const finishCardMove = (event: PointerEvent, card: HTMLElement): void => {
    const current = cardMoveRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    releasePointerCaptureIfSupported(isDayMode ? card : scrollRef.current ?? card, event.pointerId);
    cardMoveRef.current = null;
    setCardMove(null);
    if (!current.dragged) return;
    suppressItemClickRef.current = current.item.id;
    void onMoveItem?.(current.item, current.targetKey, inputTime(current.startMinutes), current.durationMinutes);
  };

  const cancelCardMove = (event: PointerEvent, card: HTMLElement): void => {
    const current = cardMoveRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    releasePointerCaptureIfSupported(isDayMode ? card : scrollRef.current ?? card, event.pointerId);
    cardMoveRef.current = null;
    setCardMove(null);
  };

  const beginCardResize = (event: PointerEvent, item: CalendarItemDTO, handle: HTMLElement): void => {
    if (!onMoveItem || event.button !== 0 || item.allDay || !item.startsAt || !item.editable) return;
    event.preventDefault();
    event.stopPropagation();
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = item.endsAt ? new Date(item.endsAt).getTime() : startsAt + 60 * 60_000;
    const durationMinutes = Math.max(MIN_RESIZE_DURATION_MINUTES, Math.round((endsAt - startsAt) / 60_000 / 15) * 15);
    const pixelsPerMinute = (isDayMode ? hourHeight : weekHourWidth) / 60;
    const next: CardResizeSelection = { item, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, pixelsPerMinute, startDurationMinutes: durationMinutes, durationMinutes, dragged: false };
    cardResizeRef.current = next;
    setCardResize(next);
    setPointerCaptureIfSupported(handle, event.pointerId);
  };

  const moveCardResize = (event: PointerEvent): void => {
    const current = cardResizeRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId || !current.item.startsAt) return;
    event.preventDefault();
    event.stopPropagation();
    const startMinutes = minutesInto(current.item.startsAt);
    const deltaPixels = isDayMode ? event.clientY - current.startY : event.clientX - current.startX;
    const deltaMinutes = Math.round((deltaPixels / Math.max(.01, current.pixelsPerMinute)) / 15) * 15;
    const durationMinutes = Math.max(MIN_RESIZE_DURATION_MINUTES, Math.min((24 * 60) - startMinutes, current.startDurationMinutes + deltaMinutes));
    const next = { ...current, durationMinutes, dragged: current.dragged || durationMinutes !== current.startDurationMinutes };
    cardResizeRef.current = next;
    setCardResize(next);
  };

  const finishCardResize = (event: PointerEvent, handle: HTMLElement): void => {
    const current = cardResizeRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId || !current.item.startsAt) return;
    event.preventDefault();
    event.stopPropagation();
    releasePointerCaptureIfSupported(handle, event.pointerId);
    cardResizeRef.current = null;
    setCardResize(null);
    if (!current.dragged) return;
    suppressItemClickRef.current = current.item.id;
    void onMoveItem?.(current.item, itemDateKey(current.item) ?? toLocalDateKey(days[0] ?? new Date()), inputTime(minutesInto(current.item.startsAt)), current.durationMinutes);
  };

  const cancelCardResize = (event: PointerEvent, handle: HTMLElement): void => {
    const current = cardResizeRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    releasePointerCaptureIfSupported(handle, event.pointerId);
    cardResizeRef.current = null;
    setCardResize(null);
  };

  const resizeCardByKeyboard = (event: KeyboardEvent, item: CalendarItemDTO): void => {
    const decreaseKey = isDayMode ? 'ArrowUp' : 'ArrowLeft';
    const increaseKey = isDayMode ? 'ArrowDown' : 'ArrowRight';
    if (!onMoveItem || !item.startsAt || !item.editable || (event.key !== decreaseKey && event.key !== increaseKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = item.endsAt ? new Date(item.endsAt).getTime() : startsAt + 60 * 60_000;
    const currentDuration = Math.max(MIN_RESIZE_DURATION_MINUTES, Math.round((endsAt - startsAt) / 60_000 / 15) * 15);
    const startMinutes = minutesInto(item.startsAt);
    const nextDuration = Math.max(MIN_RESIZE_DURATION_MINUTES, Math.min((24 * 60) - startMinutes, currentDuration + (event.key === increaseKey ? 15 : -15)));
    if (nextDuration === currentDuration) return;
    void onMoveItem(item, itemDateKey(item) ?? toLocalDateKey(days[0] ?? new Date()), inputTime(startMinutes), nextDuration);
  };

  const deleteCardByKeyboard = (event: KeyboardEvent, item: CalendarItemDTO): void => {
    if (event.key !== 'Delete' || !item.cancelable || !onDeleteItem) return;
    event.preventDefault();
    event.stopPropagation();
    setContext(null);
    onDeleteItem(item);
  };

  const beginWeekPan = (event: PointerEvent, scroller: HTMLElement): void => {
    const target = event.target instanceof Element ? event.target : null;
    const isPanSurface = Boolean(target?.closest('.cal-week-hours, .cal-week-all-day-track') && !target?.closest('button'));
    const wantsPan = event.button === 1 || (event.button === 0 && (event.shiftKey || isPanSurface));
    if (!wantsPan || cardMoveRef.current || cardResizeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    weekPanRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: scroller.scrollLeft };
    setWeekPanning(true);
    setPointerCaptureIfSupported(scroller, event.pointerId);
  };

  const moveWeekPan = (event: PointerEvent, scroller: HTMLElement): void => {
    const current = weekPanRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    scroller.scrollLeft = current.scrollLeft - (event.clientX - current.startX);
  };

  const finishWeekPan = (event: PointerEvent, scroller: HTMLElement): void => {
    const current = weekPanRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    releasePointerCaptureIfSupported(scroller, event.pointerId);
    weekPanRef.current = null;
    setWeekPanning(false);
  };

  if (!isDayMode) {
    const firstDay = days[0] ?? new Date();
    const lastDay = days[days.length - 1] ?? firstDay;
    const sameMonth = firstDay.getMonth() === lastDay.getMonth() && firstDay.getFullYear() === lastDay.getFullYear();
    const monthLabel = sameMonth
      ? firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : `${firstDay.toLocaleDateString('en-US', { month: 'short' })} – ${lastDay.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
    const rangeLabel = `${firstDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${lastDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const weekTimelineWidth = HOURS * weekHourWidth;
    const overviewMode = zoom < .55;
    const weekCardHeight = overviewMode ? 44 : WEEK_CARD_H;
    const weekStackStep = overviewMode ? 18 : WEEK_STACK_STEP;
    const allDayItems = byDay.flatMap(({ day, allDay }) => allDay.map(item => ({ day, item })));

    return (
      <div class={`cal-tg cal-tg--week cal-week-timeline${overviewMode ? ' is-week-overview' : ''}${loading ? ' is-loading' : ''}`} style={`--cal-week-hour:${weekHourWidth}px;--cal-week-width:${weekTimelineWidth}px;--cal-week-day-rail:${WEEK_DAY_RAIL_W}px;--cal-tg-zoom:${zoom}`} onWheel={event => {
        const scroll = scrollRef.current;
        if ((event.ctrlKey || event.metaKey) && onZoomChange) {
          event.preventDefault();
          if (scroll) {
            const bounds = scroll.getBoundingClientRect();
            const offsetX = event.clientX - bounds.left;
            weekZoomAnchorRef.current = { offsetX, logicalX: scroll.scrollLeft + offsetX };
          }
          onZoomChange(Math.max(.35, Math.min(1.6, Number((zoom + (event.deltaY < 0 ? .1 : -.1)).toFixed(2)))));
          return;
        }
        if (event.shiftKey && scroll && event.deltaY !== 0) {
          event.preventDefault();
          scroll.scrollLeft += event.deltaY;
        }
      }} data-widget-content-root>
        <div class={`cal-tg-scroll cal-week-scroll${weekPanning ? ' is-panning' : ''}`} ref={scrollRef} aria-label="Week timeline. Drag the time ruler, hold Shift and drag empty space, or use the middle mouse button to pan horizontally."
          onPointerDown={event => beginWeekPan(event, event.currentTarget)}
          onPointerMove={event => {
            if (weekPanRef.current) { moveWeekPan(event, event.currentTarget); return; }
            if (!cardMoveRef.current) return;
            // A row handles the first move so it can preserve the destination day.
            // After pointer capture, subsequent events target the scroller directly.
            if (event.target !== event.currentTarget) return;
            moveCard(event, event.currentTarget);
          }}
          onPointerUp={event => {
            if (weekPanRef.current) { finishWeekPan(event, event.currentTarget); return; }
            if (cardMoveRef.current) finishCardMove(event, event.currentTarget);
          }}
          onPointerCancel={event => {
            if (weekPanRef.current) { finishWeekPan(event, event.currentTarget); return; }
            if (cardMoveRef.current) cancelCardMove(event, event.currentTarget);
          }}>
          <header class="cal-week-time-head">
            <div class="cal-week-period">
              <div class="cal-week-period-copy"><strong>{monthLabel}</strong><span>{rangeLabel}</span></div>
              <div class="cal-week-period-nav" role="group" aria-label="Week navigation">
                <Button variant="ghost" size="sm" iconOnly onClick={onPrevious} disabled={!onPrevious} aria-label="Previous week" iconLeft={<LucideIcon name="ChevronLeft" size={15} />} />
                <Button variant="ghost" size="sm" iconOnly onClick={onNext} disabled={!onNext} aria-label="Next week" iconLeft={<LucideIcon name="ChevronRight" size={15} />} />
              </div>
            </div>
            <div class="cal-week-hours" aria-label="Time of day" title="Drag to scroll the schedule horizontally">
              {hours.map(hour => <span key={hour}>{hourLabel(hour)}</span>)}
              {days.some(isToday) ? <div class="cal-week-now-head" style={`left:${nowMinutes / (HOURS * 60) * 100}%`}><span>{timeLabel(now.toISOString())}</span></div> : null}
            </div>
          </header>

          {hasAllDay ? <section class="cal-week-all-day" aria-label="All-day events">
            <div class="cal-week-all-day-label"><LucideIcon name="CalendarClock" size={15} strokeWidth={1.45} /><span>All Day</span></div>
            <div class="cal-week-all-day-track">
              {allDayItems.length ? allDayItems.map(({ day, item }) => {
                const meta = sourceMeta(item);
                const hasTitleIcon = Boolean(item.titleIconType && item.titleIconValue);
                return <button type="button" key={item.id} class={`cal-tg-allday-chip cal-week-all-day-chip tone-${itemTone(item)}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}`} style={calendarCustomColorVariables(item.customColor) || undefined} onKeyDown={event => deleteCardByKeyboard(event, item)} onClick={event => onOpenItem(item, { x: event.clientX, y: event.clientY })} onContextMenu={event => {
                  if (!hasItemActions(item)) return;
                  event.preventDefault();
                  setContext({ kind: 'item', x: event.clientX, y: event.clientY, item });
                }}>
                  <span class="cal-week-all-day-day">{weekdayShort(day)} {day.getDate()}</span>
                  <span class="cal-week-all-day-icon" aria-hidden="true">{hasTitleIcon ? <CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={13} /> : <LucideIcon name={meta.icon} size={13} />}</span>
                  <strong>{item.title}</strong>
                </button>;
              }) : <div class="cal-week-all-day-empty" role="status"><span>No All-Day Events Scheduled</span></div>}
            </div>
          </section> : null}

          <div class="cal-week-rows" ref={gridRef}>
            {days.some(isToday) ? <div class="cal-week-now-column" style={`left:calc(var(--cal-week-day-rail) + ${(nowMinutes / 60) * weekHourWidth}px)`} aria-hidden="true" /> : null}
            {byDay.map(({ day, key, blocks }) => {
              const activeSelection = dragSelection?.dragged && dragSelection.key === key ? dragSelection : null;
              const pendingSelection = !activeSelection && draftSelection?.key === key
                ? { anchorMinutes: inputMinutes(draftSelection.startTime), focusMinutes: Math.max(inputMinutes(draftSelection.startTime), inputMinutes(draftSelection.endTime) - 15) }
                : null;
              const visibleSelection = activeSelection ?? pendingSelection;
              const dayWeather = weatherByDate.get(key);
              const dayWeatherLabel = dayWeather ? titleCase(dayWeather.label) : '';
              const dayHolidays = holidaysByDate.get(key) ?? [];
              const primaryHoliday = dayHolidays[0];
              const maxLanes = Math.max(1, ...blocks.map(block => block.lanes));
              const rowHeight = weekCardHeight + 20 + (maxLanes - 1) * weekStackStep;
              return <section class={`cal-tg-week-row${isToday(day) ? ' is-today' : ''}${day.getDay() === 0 || day.getDay() === 6 ? ' is-weekend' : ''}`} key={key} style={`--cal-week-row-height:${rowHeight}px`}>
                <header class="cal-tg-week-day">
                  <span class="cal-tg-week-weekday">{weekdayShort(day)}</span>
                  <strong>{day.getDate()}</strong>
                  <span class="cal-tg-week-day-meta">
                    {dayWeather ? <span class="cal-tg-week-weather" title={`${weatherLocationLabel ?? 'Trinidad & Tobago'} · ${dayWeatherLabel}`}><WeatherConditionIcon code={dayWeather.code} /><span><b>{Math.round(dayWeather.maxC)}°</b><small>{dayWeatherLabel}</small></span></span> : null}
                    {primaryHoliday ? <small class="cal-tg-week-holiday">{primaryHoliday.name}</small> : null}
                  </span>
                </header>
                <div class={`cal-tg-week-row-track${activeSelection ? ' is-drag-selecting' : ''}`} data-date-key={key}
                  onPointerDown={event => beginDragSelection(event, key, event.currentTarget)}
                  onPointerMove={event => {
                    if (cardMoveRef.current) { moveCard(event, scrollRef.current ?? event.currentTarget, event.currentTarget); return; }
                    moveDragSelection(event, key, event.currentTarget);
                  }}
                  onPointerUp={event => finishDragSelection(event, key, event.currentTarget)}
                  onPointerCancel={event => cancelDragSelection(event, key, event.currentTarget)}
                  onContextMenu={event => {
                    if ((event.target as HTMLElement).closest('.cal-tg-event')) return;
                    event.preventDefault();
                    setContext({ kind: 'slot', x: event.clientX, y: event.clientY, key, time: slotTime(event.clientX, event.clientY, event.currentTarget) });
                  }}
                  onDblClick={event => {
                    if (!onCreateForDay) return;
                    onCreateForDay(key, slotTime(event.clientX, event.clientY, event.currentTarget), 'event', { x: event.clientX, y: event.clientY });
                  }}>
                  {visibleSelection ? <div class={`cal-tg-create-ghost cal-week-create-ghost${pendingSelection ? ' is-pending-create' : ''}`} style={`left:${Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) / (HOURS * 60) * 100}%;width:${Math.max(15, Math.abs(visibleSelection.focusMinutes - visibleSelection.anchorMinutes) + 15) / (HOURS * 60) * 100}%`} aria-hidden="true">
                    <span>{timelineLabel(Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes))} – {timelineLabel(Math.min((24 * 60) - 1, Math.max(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) + 15))}</span><strong>New calendar item</strong>
                  </div> : null}
                  {blocks.map(({ item, lane, lanes, stackGroup, size, spansMultipleDays }) => {
                    if (!item.startsAt) return null;
                    const startMinutes = minutesInto(item.startsAt);
                    const itemStart = new Date(item.startsAt).getTime();
                    const itemEnd = item.endsAt ? new Date(item.endsAt).getTime() : itemStart + 60 * 60_000;
                    const durationMinutes = Math.max(15, Math.min((HOURS * 60) - startMinutes, Math.round((itemEnd - itemStart) / 60_000)));
                    const meta = sourceMeta(item);
                    const people = calendarItemKind(item) === 'meeting'
                      ? attendeePeople?.[item.id] ?? [...new Set([item.ownerName].filter((name): name is string => Boolean(name)))].map(name => ({ id: `${item.id}-${name}`, name }))
                      : [];
                    const hasTitleIcon = Boolean(item.titleIconType && item.titleIconValue);
                    const entering = item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`);
                    const cardStartX = (startMinutes / 60) * weekHourWidth;
                    const cardDurationWidth = (durationMinutes / 60) * weekHourWidth;
                    return <article key={item.id} class={`cal-tg-event cal-week-event tone-${itemTone(item)} size-${size}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}${hasTitleIcon ? ' has-title-icon' : ''}${people.length ? ' has-participants' : ''}${spansMultipleDays ? ' is-multi-day' : ''}${lanes > 1 ? ' is-overlapping' : ''}${onMoveItem && item.editable ? ' is-movable' : ''}${cardMove?.item.id === item.id && !cardMove.dragged ? ' is-pressed' : ''}${cardMove?.dragged && cardMove.item.id === item.id ? ' is-being-moved' : ''}${cardResize?.item.id === item.id ? ' is-being-resized' : ''}${entering ? ' cal-entry-is-entering' : ''}`}
                      data-card-size={size} data-calendar-lanes={lanes} data-calendar-stack-group={stackGroup} data-calendar-item-id={item.id}
                      style={`left:${cardStartX}px;top:${10 + lane * weekStackStep}px;width:calc(${cardDurationWidth}px - ${overviewMode ? 3 : 8}px);min-width:${overviewMode ? 30 : 76}px;height:${weekCardHeight}px;z-index:${lane + 2};${calendarCustomColorVariables(item.customColor)}`}
                      onAnimationEnd={entering ? () => onEntryAnimationEnd?.(item.id) : undefined}
                      onPointerDown={event => beginCardMove(event, item, event.currentTarget)}
                      onContextMenu={event => {
                        if (!hasItemActions(item)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setContext({ kind: 'item', x: event.clientX, y: event.clientY, item });
                      }} onDblClick={event => event.stopPropagation()}>
                      <button type="button" class={`cal-tg-event-main cal-week-event-main tone-${itemTone(item)}`} aria-label={`${meta.label}: ${item.title}`} onKeyDown={event => deleteCardByKeyboard(event, item)} onClick={event => {
                        if (suppressItemClickRef.current === item.id) { suppressItemClickRef.current = null; return; }
                        setContext(null);
                        onOpenItem(item, { x: event.clientX, y: event.clientY });
                      }}>
                        <span class="cal-tg-week-card-icon" aria-hidden="true">{hasTitleIcon ? <CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={14} /> : <LucideIcon name={meta.icon} size={14} />}</span>
                        <span class="cal-tg-week-card-copy"><span class="cal-tg-event-title"><span>{item.title}</span></span><span class="cal-tg-event-time">{spansMultipleDays && item.endsAt
                          ? <><span>{shortDateLabel(item.startsAt)} {timeLabel(item.startsAt)}</span><span>– {shortDateLabel(item.endsAt)} {timeLabel(item.endsAt)}</span></>
                          : <><span>{timeLabel(item.startsAt)}</span>{item.endsAt ? <span>– {timeLabel(item.endsAt)}</span> : null}</>}</span>{item.locationLabel ? <span class="cal-tg-event-location">{item.locationLabel}</span> : null}</span>
                        {people.length ? <span class="cal-tg-event-people-slot"><AvatarGroup people={people} max={3} size={20} totalCount={Math.max(item.attendeeCount, people.length)} label={`${item.title} people`} /></span> : null}
                      </button>
                      {onMoveItem && item.editable ? <button type="button" class="cal-tg-event-resize cal-week-event-resize" aria-label={`Resize ${item.title} in 15-minute increments`} onPointerDown={event => beginCardResize(event, item, event.currentTarget)} onPointerMove={moveCardResize} onPointerUp={event => finishCardResize(event, event.currentTarget)} onPointerCancel={event => cancelCardResize(event, event.currentTarget)} onClick={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => resizeCardByKeyboard(event, item)}><span /></button> : null}
                    </article>;
                  })}
                </div>
              </section>;
            })}
          </div>
        </div>
        <span ref={setContextAnchor} class="cal-context-anchor" style={context ? `left:${context.x}px;top:${context.y}px` : undefined} aria-hidden="true" />
        <DropdownMenu id="cal-tg-context-menu" open={Boolean(context)} anchor={contextAnchor} onClose={() => setContext(null)} align="start" placement={context?.kind === 'slot' ? 'right' : 'auto'} label={context?.kind === 'item' ? 'Calendar item actions' : 'Calendar slot actions'} items={context?.kind === 'item' ? [
          ...(context.item.origin === 'calendar' && context.item.status !== 'done' && context.item.status !== 'cancelled' && onSetReminder ? [{ id: 'reminder', label: 'Set reminder', icon: <LucideIcon name="BellRing" size={17} />, onSelect: () => onSetReminder(context.item) }] : []),
          { id: 'edit', label: 'Edit event', icon: <LucideIcon name="PanelsTopLeft" size={17} />, disabled: !context.item.editable || !onEditItem, onSelect: () => onEditItem?.(context.item, { x: context.x, y: context.y }) },
          ...(context.item.sourceRoute && onOpenSource ? [{ id: 'source', label: 'Open source', icon: <LucideIcon name="ExternalLink" size={17} />, onSelect: () => onOpenSource(context.item) }] : []),
          ...(context.item.cancelable && onDeleteItem ? [{ id: 'delete', label: 'Delete', icon: <LucideIcon name="Trash2" size={17} />, danger: true, onSelect: () => onDeleteItem(context.item) }] : []),
        ] : context?.kind === 'slot' ? [
          { id: 'event', label: 'Create event', description: `${context.key} at ${context.time}`, icon: <LucideIcon name="CalendarPlus" size={15} />, disabled: !onCreateForDay, onSelect: () => onCreateForDay?.(context.key, context.time, 'event', { x: context.x, y: context.y }) },
          { id: 'task', label: 'Create task', icon: <LucideIcon name="ListPlus" size={15} />, disabled: !onCreateForDay, onSelect: () => onCreateForDay?.(context.key, context.time, 'task', { x: context.x, y: context.y }) },
          { id: 'meeting', label: 'Schedule meeting', icon: <LucideIcon name="Video" size={15} />, disabled: !onCreateMeeting, onSelect: () => onCreateMeeting?.(context.key, context.time) },
          { id: 'reminder', label: 'Add standalone reminder', icon: <LucideIcon name="BellPlus" size={15} />, disabled: !onCreateForDay, onSelect: () => onCreateForDay?.(context.key, context.time, 'reminder', { x: context.x, y: context.y }) },
        ] : []} />
      </div>
    );
  }

  return (
    <div class={`cal-tg cal-tg--${effectiveMode}${loading ? ' is-loading' : ''}`} style={`--cal-tg-cols:${cols};--cal-tg-hour:${hourHeight}px;--cal-tg-half-hour:${hourHeight / 2}px;--cal-tg-h:${HOURS * hourHeight}px;--cal-tg-day-w:${dayMinWidth}px;--cal-tg-min-width:${gridMinWidth}px;--cal-tg-zoom:${zoom}`} onWheel={event => {
      if ((!event.ctrlKey && !event.metaKey) || !onZoomChange) return;
      event.preventDefault();
      const scroll = scrollRef.current;
      if (scroll) {
        const bounds = scroll.getBoundingClientRect();
        const offsetY = event.clientY - bounds.top;
        zoomAnchorRef.current = { offsetY, logicalY: scroll.scrollTop + offsetY };
      }
      const next = Math.max(.75, Math.min(1.4, Number((zoom + (event.deltaY < 0 ? .1 : -.1)).toFixed(2))));
      onZoomChange(next);
    }} data-widget-content-root>
      <div class="cal-tg-scroll" ref={scrollRef}>
      <div class="cal-tg-head">
        {!isDayMode ? <div class="cal-tg-week-nav" role="group" aria-label="Week navigation">
          <Button variant="ghost" size="sm" iconOnly onClick={onPrevious} disabled={!onPrevious} aria-label="Previous week" iconLeft={<LucideIcon name="ChevronLeft" size={15} />} />
          <Button variant="ghost" size="sm" iconOnly onClick={onNext} disabled={!onNext} aria-label="Next week" iconLeft={<LucideIcon name="ChevronRight" size={15} />} />
        </div> : null}
        {byDay.map(({ day, key }) => {
          const dayWeather = weatherByDate.get(key);
          const dayWeatherLabel = dayWeather ? titleCase(dayWeather.label) : '';
          const dayHolidays = holidaysByDate.get(key) ?? [];
          const primaryHoliday = dayHolidays[0];
          const primaryHolidayTheme = primaryHoliday ? holidayTheme(primaryHoliday.name) : null;
          const primaryHolidayClass = primaryHolidayTheme ? ` is-holiday holiday-${primaryHolidayTheme}` : '';
          const holidayNames = dayHolidays.map(holiday => holiday.name).join(', ');
          return <div class={`cal-tg-dayhead${isToday(day) ? ' is-today' : ''}${day.getDay() === 0 || day.getDay() === 6 ? ' is-weekend' : ''}${primaryHolidayClass}`} key={key}>
            {isDayMode ? <>
              <Button class="cal-tg-day-period-nav is-previous" variant="ghost" size="sm" iconOnly onClick={onPrevious} disabled={!onPrevious} aria-label="Previous calendar period" iconLeft={<LucideIcon name="ChevronLeft" size={16} />} />
              <h2 class="cal-tg-day-date"><span class="is-weekday">{day.toLocaleDateString('en-US', { weekday: 'long' })}</span>{' '}<span class="is-month">{day.toLocaleDateString('en-US', { month: 'long' })}</span>{' '}<span class="is-day">{day.getDate()},</span>{' '}<strong class="is-year">{day.getFullYear()}</strong></h2>
              <Button class="cal-tg-day-period-nav is-next" variant="ghost" size="sm" iconOnly onClick={onNext} disabled={!onNext} aria-label="Next calendar period" iconLeft={<LucideIcon name="ChevronRight" size={16} />} />
            </> : <>
              <span>{weekdayShort(day)}</span>
              <strong>{day.getDate()}</strong>
            </>}
            <span class="cal-tg-day-context">
              {dayWeather ? <span class="cal-tg-day-weather" title={`${weatherLocationLabel ?? 'Trinidad & Tobago'} · ${dayWeatherLabel} · ${Math.round(dayWeather.minC)}° to ${Math.round(dayWeather.maxC)}°C`} aria-label={`${dayWeatherLabel}, high ${Math.round(dayWeather.maxC)} degrees Celsius`}>
                <WeatherConditionIcon code={dayWeather.code} />
                <span class="cal-tg-day-weather-copy"><b>{Math.round(dayWeather.maxC)}°</b><small>{dayWeatherLabel}</small></span>
              </span> : null}
              {primaryHoliday && primaryHolidayTheme ? <span class={`cal-tg-holiday-card holiday-${primaryHolidayTheme}`} data-holiday-theme={primaryHolidayTheme} title={`${holidayNames} · ${primaryHoliday.calendarName}`} aria-label={`${holidayNames}, ${primaryHoliday.calendarName}`}>
                <HolidayHeaderArtwork theme={primaryHolidayTheme} />
                <b>{primaryHoliday.name}</b>
                {dayHolidays.length > 1 ? <i>+{dayHolidays.length - 1}</i> : null}
              </span> : null}
            </span>
          </div>;
        })}
      </div>

      {hasAllDay ? <div class="cal-tg-allday">
        <div class="cal-tg-gutter-cell cal-tg-allday-label">All Day</div>
        {byDay.every(({ allDay }) => allDay.length === 0) ? <div class="cal-tg-allday-empty" role="status">
          <LucideIcon name="CalendarClock" size={15} strokeWidth={1.45} />
          <span>No All-Day Events Scheduled</span>
        </div> : byDay.map(({ key, allDay, day }) => {
          return <div class={`cal-tg-allday-col${isToday(day) ? ' is-today' : ''}${day.getDay() === 0 || day.getDay() === 6 ? ' is-weekend' : ''}`} key={key}>
            {allDay.map(item => {
              const meta = sourceMeta(item);
              const people = calendarItemKind(item) === 'meeting'
                ? attendeePeople?.[item.id]
                  ?? [...new Set([item.ownerName].filter((name): name is string => Boolean(name)))].map(name => ({ id: `${item.id}-${name}`, name }))
                : [];
              const hasTitleIcon = Boolean(item.titleIconType && item.titleIconValue);
              const entering = item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`);
              return <article class={`cal-tg-allday-card tone-${itemTone(item)}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}${hasTitleIcon ? ' has-title-icon' : ''}${people.length ? ' has-participants' : ''}${entering ? ' cal-entry-is-entering' : ''}`} key={item.id}
                style={calendarCustomColorVariables(item.customColor) || undefined}
                onContextMenu={event => {
                  if (!hasItemActions(item)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setContext({ kind: 'item', x: event.clientX, y: event.clientY, item });
                }}
                onAnimationEnd={entering ? () => onEntryAnimationEnd?.(item.id) : undefined}>
                <button type="button" class="cal-tg-allday-main" aria-label={`${item.title}, All Day`} onKeyDown={event => deleteCardByKeyboard(event, item)} onClick={event => {
                  setContext(null);
                  onOpenItem(item, { x: event.clientX, y: event.clientY });
                }}>
                  {isDayMode ? <span class="cal-tg-allday-icon" aria-hidden="true"><LucideIcon name={meta.icon} size={13} /></span> : null}
                  <span class="cal-tg-allday-copy"><strong>{isDayMode ? <CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={13} /> : null}{item.title}</strong><span class="cal-tg-allday-time">All Day</span></span>
                  {!isDayMode ? <span class="cal-tg-week-card-icon" aria-hidden="true">{hasTitleIcon ? <CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={12} /> : <LucideIcon name={meta.icon} size={12} />}</span> : null}
                </button>
                {people.length ? <footer><AvatarGroup people={people} max={4} size={22} totalCount={Math.max(item.attendeeCount, people.length)} label={`${item.title} people`} /></footer> : null}
              </article>;
            })}
          </div>;
        })}
      </div> : null}

        <div class="cal-tg-grid" ref={gridRef}>
          {days.some(isToday) ? <div class="cal-tg-now-row" style={`top:${nowMinutes / 60 * hourHeight}px`} aria-label={`Current time ${timeLabel(now.toISOString())}`}><span>{timeLabel(now.toISOString())}</span><i aria-hidden="true" /></div> : null}
          <div class="cal-tg-gutter" onContextMenu={event => {
            event.preventDefault();
            const line = lineFromClientY(event.clientY);
            const primaryDay = byDay[0];
            setContext(line && primaryDay
              ? { kind: 'slot', x: event.clientX, y: event.clientY, key: primaryDay.key, time: timelineSlotTime(line.minutes) }
              : null);
          }}>
            {hours.map(h => <div class={`cal-tg-hour${currentTimeObscuresHour && h === nearestHour ? ' is-obscured-by-now' : ''}`} key={h}><span>{hourLabel(h)}</span></div>)}
          </div>
          {byDay.map(({ day, key, blocks }) => {
            const activeSelection = dragSelection?.dragged && dragSelection.key === key ? dragSelection : null;
            const pendingSelection = !activeSelection && draftSelection?.key === key
              ? { anchorMinutes: inputMinutes(draftSelection.startTime), focusMinutes: Math.max(inputMinutes(draftSelection.startTime), inputMinutes(draftSelection.endTime) - 15) }
              : null;
            const visibleSelection = activeSelection ?? pendingSelection;
            return <div class={`cal-tg-col${isToday(day) ? ' is-today' : ''}${day.getDay() === 0 || day.getDay() === 6 ? ' is-weekend' : ''}${activeSelection ? ' is-drag-selecting' : ''}`} data-date-key={key} key={key} onPointerDown={event => beginDragSelection(event, key, event.currentTarget)} onPointerMove={event => moveDragSelection(event, key, event.currentTarget)} onPointerUp={event => finishDragSelection(event, key, event.currentTarget)} onPointerCancel={event => cancelDragSelection(event, key, event.currentTarget)} onContextMenu={event => {
              if ((event.target as HTMLElement).closest('.cal-tg-event')) return;
              event.preventDefault();
              setContext({ kind: 'slot', x: event.clientX, y: event.clientY, key, time: slotTime(event.clientX, event.clientY, event.currentTarget) });
            }} onDblClick={event => {
              if (!onCreateForDay) return;
              onCreateForDay(key, slotTime(event.clientX, event.clientY, event.currentTarget), 'event', { x: event.clientX, y: event.clientY });
            }}>
              {visibleSelection ? <div class={`cal-tg-create-ghost${pendingSelection ? ' is-pending-create' : ''}`} style={`top:${Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) / 60 * hourHeight}px;height:${Math.max(15, Math.abs(visibleSelection.focusMinutes - visibleSelection.anchorMinutes) + 15) / 60 * hourHeight}px`} aria-hidden="true">
                <span>{timelineLabel(Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes))} – {timelineLabel(Math.min((24 * 60) - 1, Math.max(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) + 15))}</span>
                <strong>New calendar item</strong>
              </div> : null}
              {blocks.map(({ item, top, height, lane, lanes, stackGroup, size, spansMultipleDays }) => {
                const overlapStep = 18;
                const overlapSpread = (lanes - 1) * overlapStep;
                const displayLane = lane;
                const overlapOffset = displayLane * overlapStep;
                const dayLanePercent = 100 / lanes;
                const cardLeft = isDayMode && lanes > 1
                  ? `${(lane + .5) * dayLanePercent}%`
                  : lanes > 1 && overlapOffset > 0 ? `calc(50% + ${overlapOffset}px)` : '50%';
                const cardWidth = isDayMode && lanes > 1
                  ? `calc(${dayLanePercent}% - 8px)`
                  : lanes > 1 ? `calc(100% - ${12 + overlapSpread * 2}px)` : `calc(100% - ${isDayMode ? 8 : 12}px)`;
                const meta = sourceMeta(item);
                const startTimeLabel = item.startsAt ? timeLabel(item.startsAt) : '';
                const endTimeLabel = item.endsAt ? timeLabel(item.endsAt) : '';
                const people = calendarItemKind(item) === 'meeting'
                  ? attendeePeople?.[item.id]
                    ?? [...new Set([item.ownerName].filter((name): name is string => Boolean(name)))].map(name => ({ id: `${item.id}-${name}`, name }))
                  : [];
                const customColorVariables = calendarCustomColorVariables(item.customColor);
                const isMinimized = minimizedItemIds.has(item.id);
                const extraSmall = isDayMode && size !== 'small' && height <= Math.round(hourHeight * .55);
                const density = size === 'small'
                  ? 'is-micro size-small'
                  : extraSmall ? 'is-extra-small size-medium' : size === 'medium' ? 'is-compact size-medium' : 'is-roomy size-large';
                const showTime = Boolean(item.startsAt);
                const deadline = deadlineMeta(item);
                const hasTitleIcon = Boolean(item.titleIconType && item.titleIconValue);
                const showParticipants = people.length > 0;
                const avatarSize = size === 'small' ? 18 : size === 'large' ? 24 : 22;
                const avatarMax = size === 'small' ? 2 : size === 'large' ? 4 : 3;
                const maxCardWidth = isDayMode ? 'none' : `${CARD_MAX_WIDTH[size]}px`;
                const entering = item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`);
                return (
                    <article key={item.id} class={`cal-tg-event tone-${itemTone(item)} ${density}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}${hasTitleIcon ? ' has-title-icon' : ''}${showParticipants ? ' has-participants' : ''}${deadline ? ` has-deadline is-deadline-${deadline.state}` : ''}${spansMultipleDays ? ' is-multi-day' : ''}${lanes > 1 ? ' is-overlapping' : ''}${isMinimized ? ' is-minimized' : ''}${onMoveItem && item.editable ? ' is-movable' : ''}${cardMove?.item.id === item.id && !cardMove.dragged ? ' is-pressed' : ''}${cardMove?.dragged && cardMove.item.id === item.id ? ' is-being-moved' : ''}${cardResize?.item.id === item.id ? ' is-being-resized' : ''}${entering ? ' cal-entry-is-entering' : ''}`}
                      data-card-size={size} data-calendar-lanes={lanes} data-calendar-stack-group={stackGroup} data-calendar-item-id={item.id}
                      style={`top:${top}px;height:${renderedEventHeight(height)}px;left:${cardLeft};width:${cardWidth};max-width:${maxCardWidth};--cal-overlap-layer:${displayLane + 2};${customColorVariables}`}
                      onAnimationEnd={entering ? () => onEntryAnimationEnd?.(item.id) : undefined}
                      onPointerDown={event => beginCardMove(event, item, event.currentTarget)}
                      onPointerMove={event => moveCard(event, event.currentTarget)}
                      onPointerUp={event => finishCardMove(event, event.currentTarget)}
                      onPointerCancel={event => cancelCardMove(event, event.currentTarget)}
                      onContextMenu={event => {
                        if (!hasItemActions(item)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setContext({ kind: 'item', x: event.clientX, y: event.clientY, item });
                      }}
                      onDblClick={event => event.stopPropagation()}>
                      <button type="button" class={`cal-tg-event-main tone-${itemTone(item)}`} data-card-size={size} aria-label={`${meta.label}: ${item.title}`} onKeyDown={event => deleteCardByKeyboard(event, item)} onClick={event => {
                        if (suppressItemClickRef.current === item.id) {
                          suppressItemClickRef.current = null;
                          return;
                        }
                        setContext(null);
                        onOpenItem(item, { x: event.clientX, y: event.clientY });
                      }}>
                        {isDayMode ? <span class="cal-tg-event-head"><span class="cal-tg-event-source"><LucideIcon name={meta.icon} size={11} /><span class="cal-tg-event-source-label">{meta.label}</span></span></span> : null}
                        <span class="cal-tg-event-title">{isDayMode && hasTitleIcon ? <span class="cal-tg-title-glyph"><CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={12} /></span> : null}<span>{item.title}</span></span>
                        {showTime ? <span class="cal-tg-event-time">
                          {spansMultipleDays && item.startsAt && item.endsAt
                            ? <><span class="cal-tg-time-token">{shortDateLabel(item.startsAt)} {startTimeLabel}</span><span class="cal-tg-time-token">– {shortDateLabel(item.endsAt)} {endTimeLabel}</span></>
                            : <><span class="cal-tg-time-token">{startTimeLabel}</span>{endTimeLabel ? <span class="cal-tg-time-token">– {endTimeLabel}</span> : null}</>}
                        </span> : null}
                        {deadline ? <span class="cal-tg-event-deadline"><LucideIcon name="Flag" size={9} />{deadline.label}</span> : null}
                        {item.locationLabel ? <span class="cal-tg-event-location">{item.locationLabel}</span> : null}
                        {showParticipants ? <span class="cal-tg-event-people-slot"><AvatarGroup people={people} max={avatarMax} size={avatarSize} totalCount={Math.max(item.attendeeCount, people.length)} label={`${item.title} people`} class="cal-tg-event-people" /></span> : null}
                        {!isDayMode ? <span class="cal-tg-week-card-icon" aria-hidden="true">{hasTitleIcon ? <CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={12} /> : <LucideIcon name={meta.icon} size={12} />}</span> : null}
                      </button>
                      {onMoveItem && item.editable ? <button type="button" class="cal-tg-event-resize" aria-label={`Resize ${item.title} in 15-minute increments`} onPointerDown={event => beginCardResize(event, item, event.currentTarget)} onPointerMove={moveCardResize} onPointerUp={event => finishCardResize(event, event.currentTarget)} onPointerCancel={event => cancelCardResize(event, event.currentTarget)} onClick={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => resizeCardByKeyboard(event, item)}><span /></button> : null}
                    </article>
                );
              })}
              {!loading && !blocks.length && !byDay.find(d => d.key === key)?.allDay.length && sameDay(day, days[0] ?? day) && cols === 1
                ? <div class="cal-tg-day-empty">No timed items — double-click a slot to add one.</div> : null}
            </div>;
          })}
        </div>
      </div>
      <span ref={setContextAnchor} class="cal-context-anchor" style={context ? `left:${context.x}px;top:${context.y}px` : undefined} aria-hidden="true" />
      <DropdownMenu id="cal-tg-context-menu" open={Boolean(context)} anchor={contextAnchor} onClose={() => setContext(null)} align="start" placement={context?.kind === 'slot' ? 'right' : 'auto'} label={context?.kind === 'item' ? 'Calendar item actions' : 'Calendar slot actions'} items={context?.kind === 'item' ? [
        ...(context.item.origin === 'calendar' && context.item.status !== 'done' && context.item.status !== 'cancelled' && onSetReminder
          ? [{ id: 'reminder', label: 'Set reminder', icon: <LucideIcon name="BellRing" size={17} />, onSelect: () => onSetReminder(context.item) }]
          : []),
        ...(!context.item.allDay && (itemCardSize(context.item) !== 'small' || minimizedItemIds.has(context.item.id)) ? [{
          id: 'minimize',
          label: minimizedItemIds.has(context.item.id) ? 'Expand' : 'Minimize',
          icon: <LucideIcon name={minimizedItemIds.has(context.item.id) ? 'Maximize2' : 'Minimize2'} size={17} />,
          onSelect: () => setMinimizedItemIds(current => {
            const next = new Set(current);
            if (next.has(context.item.id)) next.delete(context.item.id);
            else next.add(context.item.id);
            return next;
          }),
        }] : []),
        { id: 'edit', label: 'Edit event', icon: <LucideIcon name="PanelsTopLeft" size={17} />, disabled: !context.item.editable || !onEditItem, onSelect: () => onEditItem?.(context.item, { x: context.x, y: context.y }) },
        ...(context.item.sourceRoute && onOpenSource
          ? [{ id: 'source', label: 'Open source', icon: <LucideIcon name="ExternalLink" size={17} />, onSelect: () => onOpenSource(context.item) }]
          : []),
        ...(context.item.cancelable && onDeleteItem
          ? [{ id: 'delete', label: 'Delete', icon: <LucideIcon name="Trash2" size={17} />, danger: true, onSelect: () => onDeleteItem(context.item) }]
          : []),
      ] : context?.kind === 'slot' ? [
        { id: 'event', label: 'Create event', description: `${context.key} at ${context.time}`, icon: <LucideIcon name="CalendarPlus" size={15} />, disabled: !onCreateForDay, onSelect: () => onCreateForDay?.(context.key, context.time, 'event', { x: context.x, y: context.y }) },
        { id: 'task', label: 'Create task', icon: <LucideIcon name="ListPlus" size={15} />, disabled: !onCreateForDay, onSelect: () => onCreateForDay?.(context.key, context.time, 'task', { x: context.x, y: context.y }) },
        { id: 'meeting', label: 'Schedule meeting', icon: <LucideIcon name="Video" size={15} />, disabled: !onCreateMeeting, onSelect: () => onCreateMeeting?.(context.key, context.time) },
        { id: 'reminder', label: 'Add standalone reminder', icon: <LucideIcon name="BellPlus" size={15} />, disabled: !onCreateForDay, onSelect: () => onCreateForDay?.(context.key, context.time, 'reminder', { x: context.x, y: context.y }) },
      ] : []} />
    </div>
  );
}
