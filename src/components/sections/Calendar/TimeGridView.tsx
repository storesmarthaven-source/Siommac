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
const HOURS = 24;
// These heights are content budgets, not decoration. They fit a complete line
// box for every element each tier exposes so titles/descriptions are never
// sliced midway through a line at the default or enlarged timeline zoom.
const CARD_MIN_HEIGHT = { small: 96, medium: 144, large: 200 } as const;
const CARD_MAX_WIDTH = { small: 300, medium: 380, large: 460 } as const;
const DAY_CARD_MIN_HEIGHT = { small: 44, medium: 66, large: 80 } as const;
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

interface EventBlock { item: CalendarItemDTO; top: number; height: number; lane: number; lanes: number; size: CardSize; spansMultipleDays: boolean }
type HolidayTheme = 'national' | 'emancipation' | 'divali' | 'eid' | 'christmas' | 'arrival' | 'labour' | 'faith' | 'new-year' | 'civic';
type GridContext =
  | { kind: 'slot'; x: number; y: number; key: string; time: string }
  | { kind: 'item'; x: number; y: number; item: CalendarItemDTO };
interface TimelineLine { top: number; minutes: number; label: string }
interface DragSelection { key: string; pointerId: number; anchorMinutes: number; focusMinutes: number; startY: number; dragged: boolean }
interface CardMoveSelection { item: CalendarItemDTO; pointerId: number; targetKey: string; startMinutes: number; durationMinutes: number; grabOffsetMinutes: number; startX: number; startY: number; dragged: boolean }
interface CardResizeSelection { item: CalendarItemDTO; pointerId: number; startY: number; startDurationMinutes: number; durationMinutes: number; dragged: boolean }
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

function descriptionLimit(size: CardSize, title: string): number {
  if (size === 'small') return 0;
  // Longer titles reserve one content row so every fixed-size card remains
  // readable without introducing a second, decorative card system.
  return size === 'medium' ? (title.trim().length >= 28 ? 8 : 12) : 16;
}

function limitWords(value: string | null | undefined, limit: number): { text: string; truncated: boolean } {
  const words = value?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!words.length) return { text: '', truncated: false };
  if (limit <= 0) return { text: '', truncated: true };
  if (words.length <= limit) return { text: words.join(' '), truncated: false };
  return { text: `${words.slice(0, limit).join(' ')}…`, truncated: true };
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
      // The rendered block is inset 4px and shortened by 8px, so its real
      // visual footprint ends at height - 4px. Using the raw minimum height
      // here falsely split sequential cards into narrow overlap lanes.
      const visualDuration = ((height - 4) / hourHeight) * 60;
      // A multi-day card's collision footprint follows its compact visual card,
      // not all remaining hours in the first day.
      const collisionDuration = Math.max(30, visualDuration);
      const visualEndMin = startMin + collisionDuration;
      return { item, startMin, endMin: visualEndMin, top: (startMin / 60) * hourHeight, height, size, spansMultipleDays };
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
    for (const b of cluster) out.push({ item: b.item, top: b.top, height: b.height, lane: laneOf.get(b) ?? 0, lanes, size: b.size, spansMultipleDays: b.spansMultipleDays });
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
  const suppressItemClickRef = useRef<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const effectiveMode = mode ?? (days.length === 1 ? 'day' : 'week');
  const isDayMode = mode === 'day';
  const hourHeightBase = isDayMode ? DAY_HOUR_H : HOUR_H;
  const hourHeight = Math.round(hourHeightBase * zoom);
  const previousHourHeightRef = useRef(hourHeight);
  const zoomAnchorRef = useRef<{ offsetY: number; logicalY: number } | null>(null);
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
      if (aligned || scroll.scrollHeight <= scroll.clientHeight) return;
      const now = new Date();
      const currentTimeTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * hourHeight;
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
  }, [daySignature]);

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
      blocks: layoutDay(dayItems, day, hourHeight, minimizedItemIds, isDayMode ? DAY_CARD_MIN_HEIGHT : CARD_MIN_HEIGHT, hourHeightBase, isDayMode),
    };
  }), [days, hourHeight, hourHeightBase, isDayMode, layoutItems, minimizedItemIds]);
  const holidaysByDate = useMemo(() => {
    const grouped = new Map<string, CalendarHolidayMarkerDTO[]>();
    for (const holiday of holidays) grouped.set(holiday.date, [...(grouped.get(holiday.date) ?? []), holiday]);
    return grouped;
  }, [holidays]);
  const weatherByDate = useMemo(() => new Map(weatherDays.map(day => [day.date, day])), [weatherDays]);

  const cols = days.length;
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

  const slotTime = (clientY: number, column: HTMLElement): string => {
    const bounds = column.getBoundingClientRect();
    const rawMinutes = ((clientY - bounds.top) / hourHeight) * 60;
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

  const pointerMinutes = (clientY: number, column: HTMLElement): number => {
    const bounds = column.getBoundingClientRect();
    const rawMinutes = ((clientY - bounds.top) / hourHeight) * 60;
    return Math.max(0, Math.min((24 * 60) - 15, Math.floor(rawMinutes / 15) * 15));
  };

  const beginDragSelection = (event: PointerEvent, key: string, column: HTMLElement): void => {
    if (!onCreateForDay || event.button !== 0 || (event.target as HTMLElement).closest('.cal-tg-event')) return;
    const minutes = pointerMinutes(event.clientY, column);
    const next = { key, pointerId: event.pointerId, anchorMinutes: minutes, focusMinutes: minutes, startY: event.clientY, dragged: false };
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
      focusMinutes: pointerMinutes(event.clientY, column),
      dragged: current.dragged || Math.abs(event.clientY - current.startY) >= 4,
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

  const cardMoveTarget = (clientX: number, clientY: number, grabOffsetMinutes: number): { key: string; startMinutes: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const columns = Array.from(grid.querySelectorAll<HTMLElement>('.cal-tg-col'));
    if (!columns.length) return null;
    const targetColumn = columns.find(column => {
      const bounds = column.getBoundingClientRect();
      return clientX >= bounds.left && clientX <= bounds.right;
    }) ?? columns.reduce((nearest, column) => {
      const nearestBounds = nearest.getBoundingClientRect();
      const columnBounds = column.getBoundingClientRect();
      return Math.abs(clientX - (columnBounds.left + columnBounds.right) / 2) < Math.abs(clientX - (nearestBounds.left + nearestBounds.right) / 2) ? column : nearest;
    });
    const bounds = targetColumn.getBoundingClientRect();
    const rawMinutes = ((clientY - bounds.top) / hourHeight) * 60 - grabOffsetMinutes;
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
    const grabOffsetMinutes = Math.max(0, Math.min(durationMinutes - 15, ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * Math.min(durationMinutes, 120)));
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

  const moveCard = (event: PointerEvent, card: HTMLElement): void => {
    const current = cardMoveRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dragged = current.dragged || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 5;
    if (!dragged) return;
    event.preventDefault();
    if (!current.dragged) setPointerCaptureIfSupported(card, event.pointerId);
    const target = cardMoveTarget(event.clientX, event.clientY, current.grabOffsetMinutes);
    if (!target) return;
    const next = { ...current, ...target, dragged: true };
    cardMoveRef.current = next;
    setCardMove(next);
  };

  const finishCardMove = (event: PointerEvent, card: HTMLElement): void => {
    const current = cardMoveRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    releasePointerCaptureIfSupported(card, event.pointerId);
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
    releasePointerCaptureIfSupported(card, event.pointerId);
    cardMoveRef.current = null;
    setCardMove(null);
  };

  const beginCardResize = (event: PointerEvent, item: CalendarItemDTO, handle: HTMLElement): void => {
    if (!isDayMode || !onMoveItem || event.button !== 0 || item.allDay || !item.startsAt || !item.editable) return;
    event.preventDefault();
    event.stopPropagation();
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = item.endsAt ? new Date(item.endsAt).getTime() : startsAt + 60 * 60_000;
    const durationMinutes = Math.max(MIN_RESIZE_DURATION_MINUTES, Math.round((endsAt - startsAt) / 60_000 / 15) * 15);
    const next: CardResizeSelection = { item, pointerId: event.pointerId, startY: event.clientY, startDurationMinutes: durationMinutes, durationMinutes, dragged: false };
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
    const deltaMinutes = Math.round(((event.clientY - current.startY) / hourHeight) * 60 / 15) * 15;
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
    if (!isDayMode || !onMoveItem || !item.startsAt || !item.editable || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    event.stopPropagation();
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = item.endsAt ? new Date(item.endsAt).getTime() : startsAt + 60 * 60_000;
    const currentDuration = Math.max(MIN_RESIZE_DURATION_MINUTES, Math.round((endsAt - startsAt) / 60_000 / 15) * 15);
    const startMinutes = minutesInto(item.startsAt);
    const nextDuration = Math.max(MIN_RESIZE_DURATION_MINUTES, Math.min((24 * 60) - startMinutes, currentDuration + (event.key === 'ArrowDown' ? 15 : -15)));
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

  return (
    <div class={`cal-tg cal-tg--${effectiveMode}${loading ? ' is-loading' : ''}`} style={`--cal-tg-cols:${cols};--cal-tg-hour:${hourHeight}px;--cal-tg-half-hour:${hourHeight / 2}px;--cal-tg-h:${HOURS * hourHeight}px;--cal-tg-day-w:${DAY_W}px;--cal-tg-min-width:${78 + (cols * DAY_W)}px;--cal-tg-zoom:${zoom}`} onWheel={event => {
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
        {!isDayMode ? <Button class="cal-tg-previous-period" variant="ghost" size="sm" iconOnly onClick={onPrevious} disabled={!onPrevious} aria-label="Previous calendar period" iconLeft={<LucideIcon name="ChevronLeft" size={15} />} /> : null}
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
        {!isDayMode ? <Button class="cal-tg-next-period" variant="ghost" size="sm" iconOnly onClick={onNext} disabled={!onNext} aria-label="Next calendar period" iconLeft={<LucideIcon name="ChevronRight" size={15} />} /> : null}
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
              const entering = item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`);
              return <article class={`cal-tg-allday-card tone-${itemTone(item)}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}${people.length ? ' has-participants' : ''}${entering ? ' cal-entry-is-entering' : ''}`} key={item.id}
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
                  <span class="cal-tg-allday-icon" aria-hidden="true"><LucideIcon name={meta.icon} size={13} /></span>
                  <span class="cal-tg-allday-copy"><strong><CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={13} />{item.title}</strong><span class="cal-tg-allday-time">All Day</span></span>
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
              setContext({ kind: 'slot', x: event.clientX, y: event.clientY, key, time: slotTime(event.clientY, event.currentTarget) });
            }} onDblClick={event => {
              if (!onCreateForDay) return;
              onCreateForDay(key, slotTime(event.clientY, event.currentTarget), 'event', { x: event.clientX, y: event.clientY });
            }}>
              {visibleSelection ? <div class={`cal-tg-create-ghost${pendingSelection ? ' is-pending-create' : ''}`} style={`top:${Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) / 60 * hourHeight}px;height:${Math.max(15, Math.abs(visibleSelection.focusMinutes - visibleSelection.anchorMinutes) + 15) / 60 * hourHeight}px`} aria-hidden="true">
                <span>{timelineLabel(Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes))} – {timelineLabel(Math.min((24 * 60) - 1, Math.max(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) + 15))}</span>
                <strong>New calendar item</strong>
              </div> : null}
              {blocks.map(({ item, top, height, lane, lanes, size, spansMultipleDays }) => {
                const overlapStep = 12;
                const overlapSpread = (lanes - 1) * overlapStep;
                const overlapOffset = lane * overlapStep;
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
                const hasLongTitle = size === 'medium' && item.title.trim().length >= 28;
                const description = limitWords(item.notes, isDayMode ? 0 : descriptionLimit(size, item.title));
                const deadline = deadlineMeta(item);
                const showDescription = Boolean(description.text);
                const showParticipants = people.length > 0;
                const avatarSize = size === 'small' ? 18 : size === 'large' ? 24 : 22;
                const avatarMax = size === 'small' ? 2 : size === 'large' ? 4 : 3;
                const maxCardWidth = isDayMode ? 'none' : `${CARD_MAX_WIDTH[size]}px`;
                const entering = item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`);
                return (
                    <article key={item.id} class={`cal-tg-event tone-${itemTone(item)} ${density}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}${hasLongTitle ? ' has-long-title' : ''}${showParticipants ? ' has-participants' : ''}${deadline ? ` has-deadline is-deadline-${deadline.state}` : ''}${spansMultipleDays ? ' is-multi-day' : ''}${lanes > 1 ? ' is-overlapping' : ''}${isMinimized ? ' is-minimized' : ''}${onMoveItem && item.editable ? ' is-movable' : ''}${cardMove?.item.id === item.id && !cardMove.dragged ? ' is-pressed' : ''}${cardMove?.dragged && cardMove.item.id === item.id ? ' is-being-moved' : ''}${cardResize?.item.id === item.id ? ' is-being-resized' : ''}${entering ? ' cal-entry-is-entering' : ''}`}
                      data-card-size={size} data-calendar-lanes={lanes} data-calendar-item-id={item.id}
                      style={`top:${top}px;height:${height - 4}px;left:${cardLeft};width:${cardWidth};max-width:${maxCardWidth};--cal-overlap-layer:${lane + 2};${customColorVariables}`}
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
                        <span class="cal-tg-event-head"><span class="cal-tg-event-source"><LucideIcon name={meta.icon} size={11} /><span class="cal-tg-event-source-label">{meta.label}</span></span></span>
                        <span class="cal-tg-event-title"><CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={12} /><span>{item.title}</span></span>
                        {showTime ? <span class="cal-tg-event-time">
                          <span class="cal-tg-time-icon" aria-hidden="true"><LucideIcon name="Clock3" size={9} /></span>
                          {spansMultipleDays && item.startsAt && item.endsAt
                            ? <><span class="cal-tg-time-token">{shortDateLabel(item.startsAt)} {startTimeLabel}</span><span class="cal-tg-time-token">– {shortDateLabel(item.endsAt)} {endTimeLabel}</span></>
                            : <><span class="cal-tg-time-token">{startTimeLabel}</span>{endTimeLabel ? <span class="cal-tg-time-token">– {endTimeLabel}</span> : null}</>}
                        </span> : null}
                        {deadline ? <span class="cal-tg-event-deadline"><LucideIcon name="Flag" size={9} />{deadline.label}</span> : null}
                        {item.locationLabel ? <span class="cal-tg-event-location"><LucideIcon name="MapPin" size={11} />{item.locationLabel}</span> : null}
                        {showDescription ? <span class="cal-tg-event-notes">{description.text}</span> : null}
                        {showParticipants ? <span class="cal-tg-event-people-slot"><AvatarGroup people={people} max={avatarMax} size={avatarSize} totalCount={Math.max(item.attendeeCount, people.length)} label={`${item.title} people`} class="cal-tg-event-people" /></span> : null}
                      </button>
                      {isDayMode && onMoveItem && item.editable ? <button type="button" class="cal-tg-event-resize" aria-label={`Resize ${item.title} in 15-minute increments`} onPointerDown={event => beginCardResize(event, item, event.currentTarget)} onPointerMove={moveCardResize} onPointerUp={event => finishCardResize(event, event.currentTarget)} onPointerCancel={event => cancelCardResize(event, event.currentTarget)} onClick={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => resizeCardByKeyboard(event, item)}><span /></button> : null}
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
