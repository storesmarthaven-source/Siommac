import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type CalendarColorKey, type CalendarHolidayMarkerDTO, type CalendarItemDTO, type CalendarTitleIconType } from '@api/calendar';
import { type WeatherDay } from '@api/weather';
import { AvatarGroup, Button, DropdownMenu, LucideIcon, OverflowTooltipText, type LucideName } from '@ui';
import { calendarItemIsPast, isToday, itemDateKey, localTimestamp, sameDay, timeLabel, toLocalDateKey, weekdayShort } from '@lib/calendar/date';
import { calendarCustomColorVariables } from './calendarColor';
import { CalendarTitleIcon } from './CalendarTitleIconPicker';
import { calendarItemKind, calendarItemTone } from './calendarViewModel';
import type { CalendarSnapMinutes } from '../../../../types/uiPreferences';

/**
 * Shared time-grid renderer for the Calendar Week and Day views. Renders an
 * hour-by-hour column per day with all-day items in a top band and timed items
 * positioned by their start time. Overlapping timed items use a greedy lane
 * assignment: Day uses equal side-by-side lanes while Week keeps compact
 * offset layers so narrow columns remain readable.
 * Read-only projection — clicking an item opens it.
 */

const WEEK_COLUMN_HOUR_H = 136; // compact Week grid with clear 34px quarter-hour increments
const DAY_HOUR_H = 132;         // 30-minute minimum renders as a readable 66px card
// A day is a stable layout unit. Narrowing the viewport scrolls the timeline
// horizontally instead of compressing rich cards below their content budget.
const DAY_W = 220;
const GRID_GUTTER_W = 78;
const TIMELINE_TOP_INSET_PX = 12;
const WEEK_DAY_RAIL_W = 136;
const WEEK_HOUR_W = 104;
const WEEK_TIMELINE_START_INSET_PX = 12;
const WEEK_TIMELINE_MAX_ZOOM = 1.6;
const WEEK_CARD_MIN_H = 58;
const WEEK_CARD_MAX_H = 72;
const WEEK_STACK_MIN_STEP = 24;
const WEEK_STACK_MAX_STEP = 28;
// A back card exposes one complete compact title row above the card in front.
// Keep the reveal tight so it does not consume the preceding time slot.
const SAME_START_STACK_STEP_PX = 22;
const HOURS = 24;
const DAY_END_MINUTES = HOURS * 60;
const EMPTY_TIMELINE_START_MINUTES = 6 * 60;
// These heights are content budgets for multi-day cards. Ordinary timed cards
// use their exact duration for geometry and progressively hide secondary
// details when the available height is compact.
const DAY_CARD_MIN_HEIGHT = { small: 44, medium: 66, large: 80 } as const;
const WEEK_COLUMN_CARD_MIN_HEIGHT = { small: 52, medium: 120, large: 152 } as const;
// Card borders are semantic timeline edges: a two-hour card must terminate on
// the two-hour grid line. Spacing belongs between lanes, not inside duration.
const EVENT_VERTICAL_GUTTER_PX = 0;
const EVENT_MIN_RENDER_HEIGHT_PX = 40;
// The configured snap controls interaction increments while a 30-minute
// minimum keeps the resize target usable. Card density, rather than a fake
// duration floor, protects content from clipping.
const MIN_RESIZE_DURATION_MINUTES = 30;

function setPointerCaptureIfSupported(element: Element, pointerId: number): void {
  const capture = Reflect.get(element, 'setPointerCapture');
  if (typeof capture === 'function') Reflect.apply(capture, element, [pointerId]);
}

function releasePointerCaptureIfSupported(element: Element, pointerId: number): void {
  const release = Reflect.get(element, 'releasePointerCapture');
  const hasCapture = Reflect.get(element, 'hasPointerCapture');
  if (typeof hasCapture === 'function' && !Reflect.apply(hasCapture, element, [pointerId])) return;
  if (typeof release === 'function') Reflect.apply(release, element, [pointerId]);
}

type CardSize = keyof typeof DAY_CARD_MIN_HEIGHT;

function renderedEventHeight(layoutHeight: number): number {
  return Math.max(EVENT_MIN_RENDER_HEIGHT_PX, layoutHeight - EVENT_VERTICAL_GUTTER_PX);
}

interface EventBlock { item: CalendarItemDTO; top: number; height: number; lane: number; lanes: number; stackGroup: number; size: CardSize; spansMultipleDays: boolean }
type HolidayTheme = 'national' | 'emancipation' | 'divali' | 'eid' | 'christmas' | 'arrival' | 'labour' | 'faith' | 'new-year' | 'civic';
type GridContext =
  | { kind: 'slot'; x: number; y: number; key: string; time: string }
  | { kind: 'item'; x: number; y: number; item: CalendarItemDTO };
interface TimelineLine { top: number; minutes: number; label: string }
interface DragSelection { key: string; pointerId: number; anchorMinutes: number; focusMinutes: number; startX: number; startY: number; dragged: boolean; captureElement: HTMLElement }
interface CardMoveSelection { item: CalendarItemDTO; pointerId: number; targetKey: string; startMinutes: number; durationMinutes: number; grabOffsetMinutes: number; startX: number; startY: number; dragged: boolean; captureElement: HTMLElement }
interface CardResizeSelection { item: CalendarItemDTO; pointerId: number; startX: number; startY: number; pixelsPerMinute: number; startDurationMinutes: number; durationMinutes: number; dragged: boolean; captureElement: HTMLElement }
interface WeekPanSelection { pointerId: number; startX: number; scrollLeft: number; captureElement: HTMLElement }
export interface CalendarDraftSelection {
  key: string;
  endKey?: string;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  kind?: 'event' | 'meeting' | 'task' | 'reminder';
  title?: string;
  titleIconType?: CalendarTitleIconType | null;
  titleIconValue?: string | null;
  colorKey?: CalendarColorKey | null;
  customColor?: string | null;
  locationLabel?: string | null;
  peopleCount?: number;
}

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

/** Choose a useful initial position without changing either layout's scale. */
export function initialTimelineFocusMinutes(days: readonly Date[], items: readonly CalendarItemDTO[], moment = new Date()): number {
  if (days.some(day => sameDay(day, moment))) return moment.getHours() * 60 + moment.getMinutes();
  const visibleKeys = new Set(days.map(toLocalDateKey));
  const earliest = items.reduce<number | null>((candidate, item) => {
    if (item.allDay || !item.startsAt || !visibleKeys.has(itemDateKey(item) ?? '')) return candidate;
    const itemMinutes = minutesInto(item.startsAt);
    return candidate === null ? itemMinutes : Math.min(candidate, itemMinutes);
  }, null);
  return earliest === null ? 8 * 60 : Math.max(0, earliest - 60);
}

/** Remove leading empty hours without imposing a fixed workday. The hour that
 * contains the first visible event is retained, including overnight events. */
export function visibleTimelineStartMinutes(days: readonly Date[], items: readonly CalendarItemDTO[]): number {
  const visibleKeys = new Set(days.map(toLocalDateKey));
  const earliest = items.reduce<number | null>((candidate, item) => {
    if (item.allDay || !item.startsAt || !visibleKeys.has(itemDateKey(item) ?? '')) return candidate;
    const itemMinutes = minutesInto(item.startsAt);
    return candidate === null ? itemMinutes : Math.min(candidate, itemMinutes);
  }, null);
  return earliest === null ? EMPTY_TIMELINE_START_MINUTES : Math.floor(earliest / 60) * 60;
}

function shortDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Density follows duration only where duration controls rendered geometry. */
function itemCardSize(durationMinutes: number, fitToDuration: boolean): CardSize {
  if (!fitToDuration) return 'medium';
  if (durationMinutes < 60) return 'small';
  if (durationMinutes < 120) return 'medium';
  return 'large';
}

/** Position timed items on one day and assign overlap lanes cluster-by-cluster. */
function layoutDay(
  items: CalendarItemDTO[],
  day: Date,
  hourHeight: number,
  cardMinHeight: Readonly<Record<CardSize, number>> = WEEK_COLUMN_CARD_MIN_HEIGHT,
  scaleBase = WEEK_COLUMN_HOUR_H,
  fitToDuration = false,
  collisionByDuration = false,
  timelineStartMinutes = 0,
): EventBlock[] {
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const timed = items
    .filter(item => !item.allDay && !!item.startsAt)
    .map(item => {
      const itemStart = new Date(item.startsAt!).getTime();
      const itemEnd = item.endsAt ? new Date(item.endsAt).getTime() : itemStart + 60 * 60_000;
      const spansMultipleDays = itemEnd > dayEnd;
      const startMin = minutesInto(item.startsAt!);
      const semanticDuration = Math.max(15, Math.min((24 * 60) - startMin, (itemEnd - itemStart) / 60_000));
      const size = itemCardSize(semanticDuration, fitToDuration && !spansMultipleDays);
      const cardScale = Math.max(1, hourHeight / scaleBase);
      const contentHeight = Math.round(cardMinHeight[size] * cardScale);
      const durationHeight = Math.max(1, ((itemEnd - itemStart) / 60_000 / 60) * hourHeight);
      // A timed card's top and bottom are semantic timeline edges. Secondary
      // content adapts to the available height; it must never make the visual
      // duration disagree with the schedule. Multi-day records remain compact.
      const height = fitToDuration && !spansMultipleDays
        ? durationHeight
        : contentHeight;
      // Collision detection follows the rendered card, not only its semantic
      // duration. This keeps minimum-height cards from visually overlapping.
      // Collision detection uses the same rendered height as the card. Using
      // the raw layout height here would falsely split sequential cards into
      // narrow overlap lanes even though the visual gutter keeps them apart.
      const visualDuration = (renderedEventHeight(height) / hourHeight) * 60;
      // A multi-day card's collision footprint follows its compact visual card,
      // not all remaining hours in the first day.
      const collisionDuration = collisionByDuration ? semanticDuration : Math.max(30, visualDuration);
      const visualEndMin = startMin + collisionDuration;
      return { item, startMin, endMin: visualEndMin, top: ((startMin - timelineStartMinutes) / 60) * hourHeight, height, size, spansMultipleDays };
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

function draftTitle(draft: CalendarDraftSelection | null): string {
  const title = draft?.title?.trim();
  if (title) return title;
  if (draft?.kind === 'meeting') return 'New meeting';
  if (draft?.kind === 'task') return 'New task';
  if (draft?.kind === 'reminder') return 'New reminder';
  return 'New event';
}

function DraftGhostContent({ draft, showIcon = true }: { draft: CalendarDraftSelection | null; showIcon?: boolean }): VNode {
  return <>
    <strong>
      {showIcon && draft?.titleIconType && draft.titleIconValue ? <span class="cal-tg-create-ghost-icon"><CalendarTitleIcon type={draft.titleIconType} value={draft.titleIconValue} size={13} /></span> : null}
      <span>{draftTitle(draft)}</span>
    </strong>
    {draft?.locationLabel?.trim() ? <small>{draft.locationLabel.trim()}</small> : null}
    {draft?.peopleCount ? <small>{draft.peopleCount} {draft.kind === 'task' ? 'assignee' : draft.peopleCount === 1 ? 'person' : 'people'}</small> : null}
  </>;
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

function snapTimelineMinutes(value: number, snapMinutes: CalendarSnapMinutes, maximum = (HOURS * 60) - snapMinutes): number {
  return Math.max(0, Math.min(maximum, Math.round(value / snapMinutes) * snapMinutes));
}

export type CalendarWeekLayout = 'columns' | 'timeline';

export function TimeGridView({ mode, weekLayout = 'columns', days, items, holidays = [], weatherDays = [], weatherLocationLabel, loading = false, zoom = 1, showAllDay = true, showCurrentTime = true, autoFocusTimeline = true, snapMinutes = 15, dimPastEvents = false, showCardLocations = true, showCardAttendees = true, showCardIcons = true, enteringItemId = null, draftSelection = null, onZoomChange, onOpenItem, onEditItem, onOpenSource, onSetReminder, onDeleteItem, onMoveItem, onCreateForDay, onCreateMeeting, onPrevious, onNext, onEntryAnimationEnd, attendeePeople }: {
  mode?: 'day' | 'week';
  weekLayout?: CalendarWeekLayout;
  days: Date[];
  items: CalendarItemDTO[];
  holidays?: CalendarHolidayMarkerDTO[];
  weatherDays?: WeatherDay[];
  weatherLocationLabel?: string;
  loading?: boolean;
  zoom?: number;
  showAllDay?: boolean;
  showCurrentTime?: boolean;
  autoFocusTimeline?: boolean;
  snapMinutes?: CalendarSnapMinutes;
  dimPastEvents?: boolean;
  showCardLocations?: boolean;
  showCardAttendees?: boolean;
  showCardIcons?: boolean;
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
  const [context, setContext] = useState<GridContext | null>(null);
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  const dragSelectionRef = useRef<DragSelection | null>(null);
  const [cardMove, setCardMove] = useState<CardMoveSelection | null>(null);
  const cardMoveRef = useRef<CardMoveSelection | null>(null);
  const [cardResize, setCardResize] = useState<CardResizeSelection | null>(null);
  const cardResizeRef = useRef<CardResizeSelection | null>(null);
  const [shiftPanReady, setShiftPanReady] = useState(false);
  const [shiftPanPointer, setShiftPanPointer] = useState<{ x: number; y: number } | null>(null);
  const [weekPanning, setWeekPanning] = useState(false);
  const [zoomHudVisible, setZoomHudVisible] = useState(false);
  const weekPanRef = useRef<WeekPanSelection | null>(null);
  const weekPointerRef = useRef({ x: 0, y: 0, inside: false });
  const zoomHudTimerRef = useRef<number | null>(null);
  const suppressItemClickRef = useRef<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const effectiveMode = mode ?? (days.length === 1 ? 'day' : 'week');
  const isDayMode = effectiveMode === 'day';
  const isWeekTimeline = effectiveMode === 'week' && weekLayout === 'timeline';
  const minimumResizeDuration = MIN_RESIZE_DURATION_MINUTES;
  const hourHeightBase = isDayMode ? DAY_HOUR_H : WEEK_COLUMN_HOUR_H;
  const hourHeight = Math.round(hourHeightBase * zoom);
  const weekHourWidth = Math.round(WEEK_HOUR_W * zoom);
  const timelineStartMinutes = useMemo(() => {
    const itemStart = visibleTimelineStartMinutes(days, items);
    if (!draftSelection || draftSelection.allDay || !days.some(day => toLocalDateKey(day) === draftSelection.key)) return itemStart;
    return Math.min(itemStart, Math.floor(inputMinutes(draftSelection.startTime) / 60) * 60);
  }, [days, draftSelection, items]);
  const visibleMinuteSpan = DAY_END_MINUTES - timelineStartMinutes;
  const visibleHourCount = visibleMinuteSpan / 60;
  const weekColumnStackDepth = useMemo(() => {
    if (isDayMode || isWeekTimeline) return 1;
    const visibleKeys = new Set(days.map(toLocalDateKey));
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = itemDateKey(item);
      if (item.allDay || !item.startsAt || !key || !visibleKeys.has(key)) continue;
      const group = `${key}:${minutesInto(item.startsAt)}`;
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return Math.max(1, ...counts.values());
  }, [days, isDayMode, isWeekTimeline, items]);
  const timelineTopInsetPx = TIMELINE_TOP_INSET_PX + (weekColumnStackDepth - 1) * SAME_START_STACK_STEP_PX;
  const previousHourHeightRef = useRef(hourHeight);
  const previousWeekHourWidthRef = useRef(weekHourWidth);
  const zoomAnchorRef = useRef<{ offsetY: number; logicalY: number } | null>(null);
  const weekZoomAnchorRef = useRef<{ offsetX: number; logicalX: number } | null>(null);
  const alignedTimelineProfileRef = useRef<string | null>(null);
  const daySignature = days.map(toLocalDateKey).join('|');
  const visibleTimedState = useMemo(() => {
    const visibleKeys = new Set(days.map(toLocalDateKey));
    return items.some(item => !item.allDay && Boolean(item.startsAt) && visibleKeys.has(itemDateKey(item) ?? '')) ? 'populated' : 'empty';
  }, [days, items]);
  const timelineProfile = `${daySignature}|${effectiveMode}|${weekLayout}|${loading ? 'loading' : visibleTimedState}`;
  useEffect(() => {
    if (!days.some(isToday)) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [daySignature]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || loading) return;
    if (!autoFocusTimeline) {
      alignedTimelineProfileRef.current = null;
      return;
    }
    if (alignedTimelineProfileRef.current === timelineProfile) return;
    let aligned = false;
    const alignWorkingDay = (): void => {
      if (aligned) return;
      const currentMoment = new Date();
      if (isWeekTimeline) {
        if (scroll.scrollWidth <= scroll.clientWidth) return;
        const currentDay = days.findIndex(isToday);
        const focusMinutes = currentDay >= 0 ? currentMoment.getHours() * 60 + currentMoment.getMinutes() : 9 * 60;
        const focusX = WEEK_DAY_RAIL_W + ((Math.max(timelineStartMinutes, focusMinutes) - timelineStartMinutes) / 60) * Math.round(WEEK_HOUR_W * zoom);
        scroll.scrollLeft = Math.max(0, Math.min(focusX - scroll.clientWidth * .48, scroll.scrollWidth - scroll.clientWidth));
        alignedTimelineProfileRef.current = timelineProfile;
        aligned = true;
        return;
      }
      if (scroll.scrollHeight <= scroll.clientHeight) return;
      const focusMinutes = initialTimelineFocusMinutes(days, items, currentMoment);
      const isCurrentPeriod = days.some(day => sameDay(day, currentMoment));
      const focusTimeTop = timelineTopInsetPx + ((Math.max(timelineStartMinutes, focusMinutes) - timelineStartMinutes) / 60) * hourHeight;
      const pinnedHeaderHeight = Array.from(scroll.querySelectorAll<HTMLElement>('.cal-tg-head, .cal-tg-allday'))
        .reduce((total, element) => total + element.getBoundingClientRect().height, 0);
      const visibleTimelineHeight = Math.max(hourHeightBase, scroll.clientHeight - pinnedHeaderHeight);
      const focusOffset = isCurrentPeriod ? visibleTimelineHeight * .32 : 0;
      const desiredTop = Math.round((focusTimeTop - focusOffset) / (hourHeight / 4)) * (hourHeight / 4);
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
      alignedTimelineProfileRef.current = timelineProfile;
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
  }, [autoFocusTimeline, days, hourHeight, hourHeightBase, isWeekTimeline, items, loading, timelineProfile, timelineStartMinutes, timelineTopInsetPx, zoom]);

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
    if (isWeekTimeline && scroll && previous !== weekHourWidth) {
      const anchor = weekZoomAnchorRef.current;
      scroll.scrollLeft = anchor
        ? (anchor.logicalX * (weekHourWidth / previous)) - anchor.offsetX
        : (scroll.scrollLeft / previous) * weekHourWidth;
    }
    weekZoomAnchorRef.current = null;
    previousWeekHourWidthRef.current = weekHourWidth;
  }, [isWeekTimeline, weekHourWidth]);
  useEffect(() => {
    if (!isWeekTimeline) return;
    const updateShiftPan = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Shift') return;
      const ready = event.type === 'keydown';
      setShiftPanReady(ready);
      setShiftPanPointer(ready && weekPointerRef.current.inside
        ? { x: weekPointerRef.current.x, y: weekPointerRef.current.y }
        : null);
    };
    const clearShiftPan = (): void => {
      setShiftPanReady(false);
      setShiftPanPointer(null);
    };
    window.addEventListener('keydown', updateShiftPan);
    window.addEventListener('keyup', updateShiftPan);
    window.addEventListener('blur', clearShiftPan);
    return () => {
      window.removeEventListener('keydown', updateShiftPan);
      window.removeEventListener('keyup', updateShiftPan);
      window.removeEventListener('blur', clearShiftPan);
    };
  }, [isWeekTimeline]);
  useEffect(() => () => {
    if (zoomHudTimerRef.current !== null) window.clearTimeout(zoomHudTimerRef.current);
  }, []);

  const revealZoomHud = (): void => {
    setZoomHudVisible(true);
    if (zoomHudTimerRef.current !== null) window.clearTimeout(zoomHudTimerRef.current);
    zoomHudTimerRef.current = window.setTimeout(() => {
      setZoomHudVisible(false);
      zoomHudTimerRef.current = null;
    }, 900);
  };

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
      // Both Day and Week Columns are vertical time grids, so their card
      // geometry must follow duration. Week Timeline calculates horizontal
      // duration width in its dedicated renderer below.
      blocks: layoutDay(dayItems, day, hourHeight, isDayMode ? DAY_CARD_MIN_HEIGHT : WEEK_COLUMN_CARD_MIN_HEIGHT, hourHeightBase, !isWeekTimeline, isWeekTimeline, timelineStartMinutes),
    };
  }), [days, hourHeight, hourHeightBase, isDayMode, isWeekTimeline, layoutItems, timelineStartMinutes]);
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
  const hasVisibleAllDayDraft = Boolean(draftSelection?.allDay && byDay.some(({ key }) => key === draftSelection.key));
  const startHour = timelineStartMinutes / 60;
  const hours = Array.from({ length: visibleHourCount }, (_, index) => startHour + index);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const hasToday = days.some(isToday);
  const nearestHour = Math.round(nowMinutes / 60);
  const currentTimeObscuresHour = showCurrentTime
    && hasToday
    && nowMinutes >= timelineStartMinutes
    && nearestHour >= startHour
    && nearestHour < HOURS
    && Math.abs(nowMinutes - nearestHour * 60) <= 18;
  const hasItemActions = (item: CalendarItemDTO): boolean => (
    Boolean(item.editable && onEditItem)
    || Boolean(item.sourceRoute && onOpenSource)
    || Boolean(item.origin === 'calendar' && item.status !== 'done' && item.status !== 'cancelled' && onSetReminder)
    || Boolean(item.cancelable && onDeleteItem)
  );

  const slotTime = (clientX: number, clientY: number, column: HTMLElement): string => {
    const bounds = column.getBoundingClientRect();
    const rawMinutes = isWeekTimeline
      ? timelineStartMinutes + ((clientX - bounds.left - WEEK_TIMELINE_START_INSET_PX) / Math.max(1, bounds.width - WEEK_TIMELINE_START_INSET_PX)) * visibleMinuteSpan
      : timelineStartMinutes + ((clientY - bounds.top - timelineTopInsetPx) / hourHeight) * 60;
    const minutes = Math.max(timelineStartMinutes, snapTimelineMinutes(rawMinutes, snapMinutes));
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`;
  };

  const lineFromClientY = (clientY: number): TimelineLine | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const bounds = grid.getBoundingClientRect();
    const renderedHeight = Math.max(1, (bounds.height || grid.clientHeight || visibleHourCount * hourHeight + timelineTopInsetPx) - timelineTopInsetPx);
    const rawMinutes = timelineStartMinutes + ((clientY - bounds.top - timelineTopInsetPx) / renderedHeight) * visibleMinuteSpan;
    const minutes = Math.max(timelineStartMinutes, Math.min(DAY_END_MINUTES - 1, Math.round(rawMinutes)));
    const top = ((minutes - timelineStartMinutes) / visibleMinuteSpan) * renderedHeight;
    return { top, minutes, label: timelineLabel(minutes) };
  };

  const timelineSlotTime = (minutes: number): string => {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`;
  };

  const pointerMinutes = (clientX: number, clientY: number, column: HTMLElement): number => {
    const bounds = column.getBoundingClientRect();
    const rawMinutes = isWeekTimeline
      ? timelineStartMinutes + ((clientX - bounds.left - WEEK_TIMELINE_START_INSET_PX) / Math.max(1, bounds.width - WEEK_TIMELINE_START_INSET_PX)) * visibleMinuteSpan
      : timelineStartMinutes + ((clientY - bounds.top - timelineTopInsetPx) / hourHeight) * 60;
    return Math.max(timelineStartMinutes, snapTimelineMinutes(rawMinutes, snapMinutes));
  };

  const beginDragSelection = (event: PointerEvent, key: string, column: HTMLElement): void => {
    if (!onCreateForDay || event.button !== 0 || event.shiftKey || (event.target as HTMLElement).closest('.cal-tg-event')) return;
    const minutes = pointerMinutes(event.clientX, event.clientY, column);
    const next = { key, pointerId: event.pointerId, anchorMinutes: minutes, focusMinutes: minutes, startX: event.clientX, startY: event.clientY, dragged: false, captureElement: column };
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
    releasePointerCaptureIfSupported(current.captureElement, event.pointerId);
    dragSelectionRef.current = null;
    setDragSelection(null);
    if (!current.dragged) return;
    const startMinutes = Math.min(current.anchorMinutes, current.focusMinutes);
    const endMinutes = Math.min((24 * 60) - 1, Math.max(current.anchorMinutes, current.focusMinutes) + snapMinutes);
    onCreateForDay?.(key, inputTime(startMinutes), 'event', { x: event.clientX, y: event.clientY }, inputTime(endMinutes));
  };

  const cancelDragSelection = (event: PointerEvent, key: string, column: HTMLElement): void => {
    const current = dragSelectionRef.current;
    if (current === null) return;
    if (current.key !== key || current.pointerId !== event.pointerId) return;
    releasePointerCaptureIfSupported(current.captureElement, event.pointerId);
    dragSelectionRef.current = null;
    setDragSelection(null);
  };

  const cardMoveTarget = (clientX: number, clientY: number, grabOffsetMinutes: number, eventTarget?: EventTarget | null, explicitTarget?: HTMLElement | null): { key: string; startMinutes: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const columns = Array.from(grid.querySelectorAll<HTMLElement>(isWeekTimeline ? '.cal-tg-week-row-track' : '.cal-tg-col'));
    if (!columns.length) return null;
    const directTarget = isWeekTimeline
      ? explicitTarget ?? (eventTarget instanceof Element ? eventTarget.closest<HTMLElement>('.cal-tg-week-row-track') : null)
      : null;
    const targetColumn = directTarget ?? columns.find(column => {
      const bounds = column.getBoundingClientRect();
      return isWeekTimeline
        ? clientY >= bounds.top && clientY <= bounds.bottom
        : clientX >= bounds.left && clientX <= bounds.right;
    }) ?? columns.reduce((nearest, column) => {
      const nearestBounds = nearest.getBoundingClientRect();
      const columnBounds = column.getBoundingClientRect();
      const pointer = isWeekTimeline ? clientY : clientX;
      const nearestCentre = isWeekTimeline ? (nearestBounds.top + nearestBounds.bottom) / 2 : (nearestBounds.left + nearestBounds.right) / 2;
      const columnCentre = isWeekTimeline ? (columnBounds.top + columnBounds.bottom) / 2 : (columnBounds.left + columnBounds.right) / 2;
      return Math.abs(pointer - columnCentre) < Math.abs(pointer - nearestCentre) ? column : nearest;
    });
    const bounds = targetColumn.getBoundingClientRect();
    const rawMinutes = isWeekTimeline
      ? timelineStartMinutes + ((clientX - bounds.left - WEEK_TIMELINE_START_INSET_PX) / Math.max(1, bounds.width - WEEK_TIMELINE_START_INSET_PX)) * visibleMinuteSpan - grabOffsetMinutes
      : timelineStartMinutes + ((clientY - bounds.top - timelineTopInsetPx) / hourHeight) * 60 - grabOffsetMinutes;
    const startMinutes = Math.max(timelineStartMinutes, snapTimelineMinutes(rawMinutes, snapMinutes));
    const key = targetColumn.dataset.dateKey;
    return key ? { key, startMinutes } : null;
  };

  const beginCardMove = (event: PointerEvent, item: CalendarItemDTO, card: HTMLElement): void => {
    if (!onMoveItem || event.button !== 0 || event.shiftKey || item.allDay || !item.startsAt || !item.editable || (event.target as HTMLElement).closest('.cal-tg-event-resize')) return;
    event.stopPropagation();
    const bounds = card.getBoundingClientRect();
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = item.endsAt ? new Date(item.endsAt).getTime() : startsAt + 60 * 60_000;
    const durationMinutes = Math.max(15, Math.round((endsAt - startsAt) / 60_000));
    const grabOffsetMinutes = Math.max(0, Math.min(durationMinutes - snapMinutes, isWeekTimeline
      ? ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * durationMinutes
      : ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * durationMinutes));
    // Keep capture on the calendar viewport, not the card. A Week Columns move
    // re-parents the card as soon as it crosses into another date; capturing on
    // the card would therefore lose the pointer halfway through the gesture.
    const captureElement = scrollRef.current ?? card;
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
      captureElement,
    };
    cardMoveRef.current = current;
    setCardMove(current);
    setPointerCaptureIfSupported(captureElement, event.pointerId);
  };

  const moveCard = (event: PointerEvent, card: HTMLElement, explicitTarget?: HTMLElement | null): void => {
    const current = cardMoveRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dragged = current.dragged || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 5;
    if (!dragged) return;
    event.preventDefault();
    const target = cardMoveTarget(event.clientX, event.clientY, current.grabOffsetMinutes, event.target, explicitTarget);
    if (!target) return;
    const next = { ...current, targetKey: target.key, startMinutes: target.startMinutes, dragged: true };
    cardMoveRef.current = next;
    setCardMove(next);
  };

  const suppressSyntheticItemClick = (itemId: string): void => {
    suppressItemClickRef.current = itemId;
    window.setTimeout(() => {
      if (suppressItemClickRef.current === itemId) suppressItemClickRef.current = null;
    }, 0);
  };

  const settleCardMove = (pointerId: number, commit: boolean, point?: { x: number; y: number }): void => {
    const current = cardMoveRef.current;
    if (!current || current.pointerId !== pointerId) return;
    // Clear the interaction before releasing capture so the corresponding
    // lostpointercapture event cannot cancel an otherwise valid drop.
    cardMoveRef.current = null;
    setCardMove(null);
    releasePointerCaptureIfSupported(current.captureElement, pointerId);
    if (!commit) return;
    suppressSyntheticItemClick(current.item.id);
    if (!current.dragged) {
      onOpenItem(current.item, point);
      return;
    }
    void onMoveItem?.(current.item, current.targetKey, inputTime(current.startMinutes), current.durationMinutes);
  };

  const finishCardMove = (event: PointerEvent, card: HTMLElement): void => {
    if (cardMoveRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    settleCardMove(event.pointerId, true, { x: event.clientX, y: event.clientY });
  };

  const cancelCardMove = (event: PointerEvent, card: HTMLElement): void => {
    if (cardMoveRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    settleCardMove(event.pointerId, false);
  };

  const beginCardResize = (event: PointerEvent, item: CalendarItemDTO, handle: HTMLElement): void => {
    if (!onMoveItem || event.button !== 0 || item.allDay || !item.startsAt || !item.editable) return;
    event.preventDefault();
    event.stopPropagation();
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = item.endsAt ? new Date(item.endsAt).getTime() : startsAt + 60 * 60_000;
    const durationMinutes = Math.max(minimumResizeDuration, Math.round((endsAt - startsAt) / 60_000 / 15) * 15);
    const pixelsPerMinute = (isWeekTimeline ? weekHourWidth : hourHeight) / 60;
    const next: CardResizeSelection = { item, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, pixelsPerMinute, startDurationMinutes: durationMinutes, durationMinutes, dragged: false, captureElement: handle };
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
    const deltaPixels = isWeekTimeline ? event.clientX - current.startX : event.clientY - current.startY;
    const deltaMinutes = Math.round((deltaPixels / Math.max(.01, current.pixelsPerMinute)) / snapMinutes) * snapMinutes;
    const durationMinutes = Math.max(minimumResizeDuration, Math.min((24 * 60) - startMinutes, current.startDurationMinutes + deltaMinutes));
    const next = { ...current, durationMinutes, dragged: current.dragged || durationMinutes !== current.startDurationMinutes };
    cardResizeRef.current = next;
    setCardResize(next);
  };

  const settleCardResize = (pointerId: number, commit: boolean): void => {
    const current = cardResizeRef.current;
    if (!current || current.pointerId !== pointerId || !current.item.startsAt) return;
    cardResizeRef.current = null;
    setCardResize(null);
    releasePointerCaptureIfSupported(current.captureElement, pointerId);
    if (!commit || !current.dragged) return;
    suppressSyntheticItemClick(current.item.id);
    void onMoveItem?.(current.item, itemDateKey(current.item) ?? toLocalDateKey(days[0] ?? new Date()), inputTime(minutesInto(current.item.startsAt)), current.durationMinutes);
  };

  const finishCardResize = (event: PointerEvent, handle: HTMLElement): void => {
    const current = cardResizeRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId || !current.item.startsAt) return;
    event.preventDefault();
    event.stopPropagation();
    settleCardResize(event.pointerId, true);
  };

  const cancelCardResize = (event: PointerEvent, handle: HTMLElement): void => {
    const current = cardResizeRef.current;
    if (current === null) return;
    if (current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    settleCardResize(event.pointerId, false);
  };

  const resizeCardByKeyboard = (event: KeyboardEvent, item: CalendarItemDTO): void => {
    const decreaseKey = isWeekTimeline ? 'ArrowLeft' : 'ArrowUp';
    const increaseKey = isWeekTimeline ? 'ArrowRight' : 'ArrowDown';
    if (!onMoveItem || !item.startsAt || !item.editable || (event.key !== decreaseKey && event.key !== increaseKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = item.endsAt ? new Date(item.endsAt).getTime() : startsAt + 60 * 60_000;
    const currentDuration = Math.max(minimumResizeDuration, Math.round((endsAt - startsAt) / 60_000 / 15) * 15);
    const startMinutes = minutesInto(item.startsAt);
    const nextDuration = Math.max(minimumResizeDuration, Math.min((24 * 60) - startMinutes, currentDuration + (event.key === increaseKey ? snapMinutes : -snapMinutes)));
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
    weekPanRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: scroller.scrollLeft, captureElement: scroller };
    setWeekPanning(true);
    setPointerCaptureIfSupported(scroller, event.pointerId);
  };

  const trackWeekPointer = (event: PointerEvent): void => {
    weekPointerRef.current = { x: event.clientX, y: event.clientY, inside: true };
    if (shiftPanReady) setShiftPanPointer({ x: event.clientX, y: event.clientY });
  };

  const leaveWeekPointer = (): void => {
    weekPointerRef.current.inside = false;
    if (!weekPanning) setShiftPanPointer(null);
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

  useEffect(() => {
    const clearSelection = (pointerId?: number): void => {
      const selection = dragSelectionRef.current;
      if (!selection || (pointerId !== undefined && selection.pointerId !== pointerId)) return;
      releasePointerCaptureIfSupported(selection.captureElement, selection.pointerId);
      dragSelectionRef.current = null;
      setDragSelection(null);
    };
    const clearWeekPan = (pointerId?: number): void => {
      const pan = weekPanRef.current;
      if (!pan || (pointerId !== undefined && pan.pointerId !== pointerId)) return;
      releasePointerCaptureIfSupported(pan.captureElement, pan.pointerId);
      weekPanRef.current = null;
      setWeekPanning(false);
    };
    const finishGlobalPointer = (event: globalThis.PointerEvent): void => {
      if (dragSelectionRef.current?.pointerId === event.pointerId) {
        const selection = dragSelectionRef.current;
        finishDragSelection(event, selection.key, selection.captureElement);
      }
      settleCardMove(event.pointerId, true, { x: event.clientX, y: event.clientY });
      settleCardResize(event.pointerId, true);
      clearWeekPan(event.pointerId);
    };
    const cancelGlobalPointer = (event: globalThis.PointerEvent): void => {
      clearSelection(event.pointerId);
      settleCardMove(event.pointerId, false);
      settleCardResize(event.pointerId, false);
      clearWeekPan(event.pointerId);
    };
    const cancelAll = (): void => {
      clearSelection();
      const movingPointer = cardMoveRef.current?.pointerId;
      if (movingPointer !== undefined) settleCardMove(movingPointer, false);
      const resizingPointer = cardResizeRef.current?.pointerId;
      if (resizingPointer !== undefined) settleCardResize(resizingPointer, false);
      clearWeekPan();
    };
    const cancelWithEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') cancelAll();
    };
    window.addEventListener('pointerup', finishGlobalPointer);
    window.addEventListener('pointercancel', cancelGlobalPointer);
    window.addEventListener('lostpointercapture', cancelGlobalPointer, true);
    window.addEventListener('blur', cancelAll);
    window.addEventListener('keydown', cancelWithEscape);
    return () => {
      window.removeEventListener('pointerup', finishGlobalPointer);
      window.removeEventListener('pointercancel', cancelGlobalPointer);
      window.removeEventListener('lostpointercapture', cancelGlobalPointer, true);
      window.removeEventListener('blur', cancelAll);
      window.removeEventListener('keydown', cancelWithEscape);
      cancelAll();
    };
  // Interaction state lives in refs; dependencies only change the calendar
  // coordinate system or the mutation callback used when a gesture commits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daySignature, isWeekTimeline, onCreateForDay, onMoveItem, onOpenItem, timelineStartMinutes, timelineTopInsetPx, visibleMinuteSpan]);

  if (isWeekTimeline) {
    const firstDay = days[0] ?? new Date();
    const lastDay = days[days.length - 1] ?? firstDay;
    const sameMonth = firstDay.getMonth() === lastDay.getMonth() && firstDay.getFullYear() === lastDay.getFullYear();
    const sameYear = firstDay.getFullYear() === lastDay.getFullYear();
    const monthHeading = sameMonth
      ? firstDay.toLocaleDateString('en-US', { month: 'long' })
      : `${firstDay.toLocaleDateString('en-US', { month: 'short' })}${sameYear ? '' : ` ${firstDay.getFullYear()}`} – ${lastDay.toLocaleDateString('en-US', { month: 'short' })}`;
    const yearHeading = lastDay.getFullYear();
    const rangeLabel = `${firstDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${lastDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const weekTimelineWidth = WEEK_TIMELINE_START_INSET_PX + visibleHourCount * weekHourWidth;
    const overviewMode = zoom < .55;
    const weekPresentationProgress = Math.max(0, Math.min(1, (zoom - .55) / (WEEK_TIMELINE_MAX_ZOOM - .55)));
    const weekCardHeight = overviewMode ? 44 : Math.round(WEEK_CARD_MIN_H + (WEEK_CARD_MAX_H - WEEK_CARD_MIN_H) * weekPresentationProgress);
    const weekStackStep = overviewMode ? 18 : Math.round(WEEK_STACK_MIN_STEP + (WEEK_STACK_MAX_STEP - WEEK_STACK_MIN_STEP) * weekPresentationProgress);
    const weekTitleFontSize = 10.5 + 1.5 * weekPresentationProgress;
    const weekTimeFontSize = 8.5 + weekPresentationProgress;
    const weekLocationFontSize = 8 + weekPresentationProgress;
    const weekIconSize = 14 + 2 * weekPresentationProgress;
    const allDayItems = byDay.flatMap(({ day, allDay }) => allDay.map(item => ({ day, item })));
    const allDayDraftDay = draftSelection?.allDay ? days.find(day => toLocalDateKey(day) === draftSelection.key) ?? null : null;

    return (
      <div class={`cal-tg cal-tg--week cal-week-timeline${overviewMode ? ' is-week-overview' : ''}${loading ? ' is-loading' : ''}`} style={`--cal-week-hour:${weekHourWidth}px;--cal-week-hour-count:${visibleHourCount};--cal-week-width:${weekTimelineWidth}px;--cal-week-start-inset:${WEEK_TIMELINE_START_INSET_PX}px;--cal-week-day-rail:${WEEK_DAY_RAIL_W}px;--cal-week-title-size:${weekTitleFontSize.toFixed(2)}px;--cal-week-time-size:${weekTimeFontSize.toFixed(2)}px;--cal-week-location-size:${weekLocationFontSize.toFixed(2)}px;--cal-week-icon-size:${weekIconSize.toFixed(2)}px;--cal-tg-zoom:${zoom}`} onWheel={event => {
        const scroll = scrollRef.current;
        if ((event.ctrlKey || event.metaKey) && onZoomChange) {
          event.preventDefault();
          revealZoomHud();
          if (scroll) {
            const bounds = scroll.getBoundingClientRect();
            const offsetX = event.clientX - bounds.left;
            weekZoomAnchorRef.current = { offsetX, logicalX: scroll.scrollLeft + offsetX };
          }
          onZoomChange(Math.max(.35, Math.min(WEEK_TIMELINE_MAX_ZOOM, Number((zoom + (event.deltaY < 0 ? .1 : -.1)).toFixed(2)))));
          return;
        }
        if (event.shiftKey && scroll && event.deltaY !== 0) {
          event.preventDefault();
          scroll.scrollLeft += event.deltaY;
        }
      }} data-widget-content-root>
        <header class="cal-week-period-head">
          <Button class="cal-tg-day-period-nav is-previous" variant="ghost" size="sm" iconOnly onClick={onPrevious} disabled={!onPrevious} aria-label="Previous week" iconLeft={<LucideIcon name="ChevronLeft" size={16} />} />
          <h2 class="cal-tg-day-date cal-week-period-date">
            <span class="is-month">{monthHeading}</span>{' '}
            <strong class="is-year">{yearHeading}</strong>
            <span class="cal-week-period-range">{rangeLabel}</span>
          </h2>
          <Button class="cal-tg-day-period-nav is-next" variant="ghost" size="sm" iconOnly onClick={onNext} disabled={!onNext} aria-label="Next week" iconLeft={<LucideIcon name="ChevronRight" size={16} />} />
        </header>
        <div class={`cal-tg-scroll cal-week-scroll${shiftPanReady && shiftPanPointer ? ' is-shift-pan-ready' : ''}${weekPanning ? ' is-panning' : ''}`} ref={scrollRef} aria-label="Week timeline. Drag the time ruler, hold Shift and drag empty space, or use the middle mouse button to pan horizontally."
          onPointerEnter={trackWeekPointer}
          onPointerLeave={leaveWeekPointer}
          onPointerDown={event => beginWeekPan(event, event.currentTarget)}
          onPointerMove={event => {
            trackWeekPointer(event);
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
            <div class="cal-week-time-corner" aria-hidden="true" />
            <div class="cal-week-hours" aria-label="Time of day" title="Drag to scroll the schedule horizontally">
              {hours.map(hour => <span key={hour}>{hourLabel(hour)}</span>)}
              {showCurrentTime && hasToday && nowMinutes >= timelineStartMinutes ? <div class="cal-week-now-head" style={`left:${WEEK_TIMELINE_START_INSET_PX + ((nowMinutes - timelineStartMinutes) / 60) * weekHourWidth}px`}><span>{timeLabel(now.toISOString())}</span></div> : null}
            </div>
          </header>

          {hasAllDay ? <section class="cal-week-all-day" aria-label="All-day events">
            <div class="cal-week-all-day-label"><span>All Day</span></div>
            <div class="cal-week-all-day-track">
              {allDayItems.length || allDayDraftDay ? <>
                {allDayDraftDay && draftSelection ? <article class="cal-tg-allday-card cal-week-all-day-card cal-tg-create-allday-ghost tone-slate">
                  <span class="cal-tg-allday-main">
                    <span class="cal-tg-allday-copy"><strong>{draftTitle(draftSelection)}</strong><span class="cal-tg-allday-time">{weekdayShort(allDayDraftDay)} {allDayDraftDay.getDate()} · All Day</span></span>
                  </span>
                </article> : null}
                {allDayItems.map(({ day, item }) => {
                return <article key={item.id} class={`cal-tg-allday-card cal-week-all-day-card tone-${calendarItemTone(item)}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}${dimPastEvents && calendarItemIsPast(item, now) ? ' is-past' : ''}`} style={calendarCustomColorVariables(item.customColor) || undefined} onContextMenu={event => {
                  if (!hasItemActions(item)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setContext({ kind: 'item', x: event.clientX, y: event.clientY, item });
                  }}>
                  <button type="button" class="cal-tg-allday-main" aria-label={`${item.title}, ${weekdayShort(day)} ${day.getDate()}, All Day`} onKeyDown={event => deleteCardByKeyboard(event, item)} onClick={event => onOpenItem(item, { x: event.clientX, y: event.clientY })}>
                    <span class="cal-tg-allday-copy"><OverflowTooltipText as="strong" class="cal-week-overflow-title" text={item.title} /><span class="cal-tg-allday-time">{weekdayShort(day)} {day.getDate()} · All Day</span></span>
                  </button>
                </article>;
              })}</> : <div class="cal-week-all-day-empty" role="status">
                <LucideIcon name="CalendarClock" size={15} strokeWidth={1.45} />
                <span>No All-Day Events Scheduled</span>
              </div>}
            </div>
          </section> : null}

          <div class="cal-week-rows" ref={gridRef}>
            {showCurrentTime && hasToday && nowMinutes >= timelineStartMinutes ? <div class="cal-week-now-column" style={`left:calc(var(--cal-week-day-rail) + ${WEEK_TIMELINE_START_INSET_PX + ((nowMinutes - timelineStartMinutes) / 60) * weekHourWidth}px)`} aria-hidden="true" /> : null}
            {byDay.map(({ day, key, blocks }) => {
              const activeSelection = dragSelection?.dragged && dragSelection.key === key ? dragSelection : null;
              const pendingSelection = !activeSelection && !draftSelection?.allDay && draftSelection?.key === key
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
                  {visibleSelection ? <div class={`cal-tg-create-ghost cal-week-create-ghost tone-slate${pendingSelection ? ' is-pending-create' : ''}`} style={`left:${WEEK_TIMELINE_START_INSET_PX + ((Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) - timelineStartMinutes) / 60) * weekHourWidth}px;width:${(Math.max(snapMinutes, Math.abs(visibleSelection.focusMinutes - visibleSelection.anchorMinutes) + snapMinutes) / 60) * weekHourWidth}px`} aria-hidden="true">
                    <span>{timelineLabel(Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes))} – {timelineLabel(Math.min((24 * 60) - 1, Math.max(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) + snapMinutes))}</span><DraftGhostContent draft={pendingSelection ? draftSelection : null} showIcon={showCardIcons} />
                  </div> : null}
                  {blocks.map(({ item, lane, lanes, stackGroup, size, spansMultipleDays }) => {
                    if (!item.startsAt) return null;
                    const startMinutes = minutesInto(item.startsAt);
                    const itemStart = new Date(item.startsAt).getTime();
                    const itemEnd = item.endsAt ? new Date(item.endsAt).getTime() : itemStart + 60 * 60_000;
                    const durationMinutes = Math.max(15, Math.min((HOURS * 60) - startMinutes, Math.round((itemEnd - itemStart) / 60_000)));
                    const meta = sourceMeta(item);
                    const people = showCardAttendees && calendarItemKind(item) === 'meeting'
                      ? attendeePeople?.[item.id] ?? [...new Set([item.ownerName].filter((name): name is string => Boolean(name)))].map(name => ({ id: `${item.id}-${name}`, name }))
                      : [];
                    const hasTitleIcon = showCardIcons && Boolean(item.titleIconType && item.titleIconValue);
                    const entering = item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`);
                    const cardStartX = WEEK_TIMELINE_START_INSET_PX + ((startMinutes - timelineStartMinutes) / 60) * weekHourWidth;
                    const cardDurationWidth = (durationMinutes / 60) * weekHourWidth;
                    return <article key={item.id} class={`cal-tg-event cal-week-event tone-${calendarItemTone(item)} size-${size}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}${hasTitleIcon ? ' has-title-icon' : ''}${people.length ? ' has-participants' : ''}${dimPastEvents && calendarItemIsPast(item, now) ? ' is-past' : ''}${spansMultipleDays ? ' is-multi-day' : ''}${lanes > 1 ? ' is-overlapping' : ''}${onMoveItem && item.editable ? ' is-movable' : ''}${cardMove?.item.id === item.id && !cardMove.dragged ? ' is-pressed' : ''}${cardMove?.dragged && cardMove.item.id === item.id ? ' is-being-moved' : ''}${cardResize?.item.id === item.id ? ' is-being-resized' : ''}${entering ? ' cal-entry-is-entering' : ''}`}
                      data-card-size={size} data-calendar-lanes={lanes} data-calendar-stack-group={stackGroup} data-calendar-item-id={item.id}
                      style={`left:${cardStartX}px;top:${10 + lane * weekStackStep}px;width:${cardDurationWidth}px;min-width:0;height:${weekCardHeight}px;z-index:${lane + 2};${calendarCustomColorVariables(item.customColor)}`}
                      onAnimationEnd={entering ? () => onEntryAnimationEnd?.(item.id) : undefined}
                      onPointerDown={event => beginCardMove(event, item, event.currentTarget)}
                      onContextMenu={event => {
                        if (!hasItemActions(item)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setContext({ kind: 'item', x: event.clientX, y: event.clientY, item });
                      }} onDblClick={event => event.stopPropagation()}>
                      <button type="button" class={`cal-tg-event-main cal-week-event-main tone-${calendarItemTone(item)}`} aria-label={`${meta.label}: ${item.title}`} onKeyDown={event => deleteCardByKeyboard(event, item)} onClick={event => {
                        if (suppressItemClickRef.current === item.id) { suppressItemClickRef.current = null; return; }
                        setContext(null);
                        onOpenItem(item, { x: event.clientX, y: event.clientY });
                      }}>
                        {showCardIcons ? <span class="cal-tg-week-card-icon" aria-hidden="true">{hasTitleIcon ? <CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={14} /> : <LucideIcon name={meta.icon} size={14} />}</span> : null}
                        <span class="cal-tg-week-card-copy"><span class="cal-tg-event-title"><OverflowTooltipText class="cal-week-overflow-title" text={item.title} /></span><span class="cal-tg-event-time">{spansMultipleDays && item.endsAt
                          ? <><span>{shortDateLabel(item.startsAt)} {timeLabel(item.startsAt)}</span><span>– {shortDateLabel(item.endsAt)} {timeLabel(item.endsAt)}</span></>
                          : <><span>{timeLabel(item.startsAt)}</span>{item.endsAt ? <span>– {timeLabel(item.endsAt)}</span> : null}</>}</span>{showCardLocations && item.locationLabel ? <span class="cal-tg-event-location">{item.locationLabel}</span> : null}</span>
                        {people.length ? <span class="cal-tg-event-people-slot"><AvatarGroup people={people} max={3} size={20} totalCount={Math.max(item.attendeeCount, people.length)} label={`${item.title} people`} /></span> : null}
                      </button>
                      {onMoveItem && item.editable ? <button type="button" class="cal-tg-event-resize cal-week-event-resize" aria-label={`Resize ${item.title} in ${snapMinutes}-minute increments`} onPointerDown={event => beginCardResize(event, item, event.currentTarget)} onPointerMove={moveCardResize} onPointerUp={event => finishCardResize(event, event.currentTarget)} onPointerCancel={event => cancelCardResize(event, event.currentTarget)} onClick={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => resizeCardByKeyboard(event, item)}><span /></button> : null}
                    </article>;
                  })}
                </div>
              </section>;
            })}
          </div>
        </div>
        {shiftPanReady && shiftPanPointer && !weekPanning ? <span class="cal-week-shift-pan-cursor" style={{ left: shiftPanPointer.x, top: shiftPanPointer.y }} aria-hidden="true">
          <LucideIcon name="ArrowLeft" size={12} strokeWidth={2.4} />
          <LucideIcon name="Hand" size={15} strokeWidth={2.1} />
          <LucideIcon name="ArrowRight" size={12} strokeWidth={2.4} />
        </span> : null}
        <div class={`cal-tg-zoom-hud${zoomHudVisible ? ' is-visible' : ''}`} aria-hidden="true">{Math.round((zoom / WEEK_TIMELINE_MAX_ZOOM) * 100)}%</div>
        <DropdownMenu id="cal-tg-context-menu" open={Boolean(context)} anchor={null} anchorPoint={context ? { x: context.x, y: context.y } : null} boundary={scrollRef.current} onClose={() => setContext(null)} align="start" placement={context?.kind === 'slot' ? 'right' : 'auto'} label={context?.kind === 'item' ? 'Calendar item actions' : 'Calendar slot actions'} items={context?.kind === 'item' ? [
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
    <div class={`cal-tg cal-tg--${effectiveMode}${loading ? ' is-loading' : ''}`} style={`--cal-tg-cols:${cols};--cal-tg-hour:${hourHeight}px;--cal-tg-half-hour:${hourHeight / 2}px;--cal-tg-h:${visibleHourCount * hourHeight + timelineTopInsetPx}px;--cal-tg-top-inset:${timelineTopInsetPx}px;--cal-tg-day-w:${dayMinWidth}px;--cal-tg-min-width:${gridMinWidth}px;--cal-tg-zoom:${zoom}`} onWheel={event => {
      if ((!event.ctrlKey && !event.metaKey) || !onZoomChange) return;
      event.preventDefault();
      revealZoomHud();
      const scroll = scrollRef.current;
      if (scroll) {
        const bounds = scroll.getBoundingClientRect();
        const offsetY = event.clientY - bounds.top;
        zoomAnchorRef.current = { offsetY, logicalY: scroll.scrollTop + offsetY };
      }
      const next = Math.max(.75, Math.min(1.4, Number((zoom + (event.deltaY < 0 ? .1 : -.1)).toFixed(2))));
      onZoomChange(next);
    }} data-widget-content-root>
      <div class="cal-tg-scroll" ref={scrollRef} data-time-focus-minutes={initialTimelineFocusMinutes(days, items, now)}
        onPointerMove={event => {
          // Pointer capture targets this stable viewport after a card crosses
          // columns, so moves continue even though the rendered card changed
          // day and was mounted under a different parent.
          if (cardMoveRef.current && event.target === event.currentTarget) moveCard(event, event.currentTarget);
        }}
        onPointerUp={event => {
          if (cardMoveRef.current) finishCardMove(event, event.currentTarget);
        }}
        onPointerCancel={event => {
          if (cardMoveRef.current) cancelCardMove(event, event.currentTarget);
        }}>
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
        {byDay.every(({ allDay }) => allDay.length === 0) && !hasVisibleAllDayDraft ? <div class="cal-tg-allday-empty" role="status">
          <LucideIcon name="CalendarClock" size={15} strokeWidth={1.45} />
          <span>No All-Day Events Scheduled</span>
        </div> : byDay.map(({ key, allDay, day }) => {
          return <div class={`cal-tg-allday-col${isToday(day) ? ' is-today' : ''}${day.getDay() === 0 || day.getDay() === 6 ? ' is-weekend' : ''}`} key={key}>
            {draftSelection?.allDay && draftSelection.key === key ? <article class="cal-tg-allday-card cal-tg-create-allday-ghost tone-slate">
              <span class="cal-tg-allday-main">
                <span class="cal-tg-allday-copy"><strong>{draftTitle(draftSelection)}</strong><span class="cal-tg-allday-time">All Day</span></span>
              </span>
            </article> : null}
            {allDay.map(item => {
              const people = showCardAttendees && calendarItemKind(item) === 'meeting'
                ? attendeePeople?.[item.id]
                  ?? [...new Set([item.ownerName].filter((name): name is string => Boolean(name)))].map(name => ({ id: `${item.id}-${name}`, name }))
                : [];
              const entering = item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`);
              return <article class={`cal-tg-allday-card tone-${calendarItemTone(item)}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}${people.length ? ' has-participants' : ''}${dimPastEvents && calendarItemIsPast(item, now) ? ' is-past' : ''}${entering ? ' cal-entry-is-entering' : ''}`} key={item.id}
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
                  <span class="cal-tg-allday-copy">{isDayMode
                    ? <OverflowTooltipText as="strong" class="cal-day-overflow-title" text={item.title} />
                    : <strong>{item.title}</strong>}<span class="cal-tg-allday-time">All Day</span></span>
                </button>
                {people.length ? <footer><AvatarGroup people={people} max={4} size={22} totalCount={Math.max(item.attendeeCount, people.length)} label={`${item.title} people`} /></footer> : null}
              </article>;
            })}
          </div>;
        })}
      </div> : null}

        <div class="cal-tg-grid" ref={gridRef}>
          {showCurrentTime && hasToday && nowMinutes >= timelineStartMinutes ? <div class="cal-tg-now-row" style={`top:${timelineTopInsetPx + (nowMinutes - timelineStartMinutes) / 60 * hourHeight}px`} aria-label={`Current time ${timeLabel(now.toISOString())}`}><span>{timeLabel(now.toISOString())}</span><i aria-hidden="true" /></div> : null}
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
            const pendingSelection = !activeSelection && !draftSelection?.allDay && draftSelection?.key === key
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
              {visibleSelection ? <div class={`cal-tg-create-ghost tone-slate${pendingSelection ? ' is-pending-create' : ''}`} style={`top:${timelineTopInsetPx + (Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) - timelineStartMinutes) / 60 * hourHeight}px;height:${Math.max(snapMinutes, Math.abs(visibleSelection.focusMinutes - visibleSelection.anchorMinutes) + snapMinutes) / 60 * hourHeight}px`} aria-hidden="true">
                <span>{timelineLabel(Math.min(visibleSelection.anchorMinutes, visibleSelection.focusMinutes))} – {timelineLabel(Math.min((24 * 60) - 1, Math.max(visibleSelection.anchorMinutes, visibleSelection.focusMinutes) + snapMinutes))}</span>
                <DraftGhostContent draft={pendingSelection ? draftSelection : null} showIcon={!isDayMode && showCardIcons} />
              </div> : null}
              {blocks.map(({ item, top, height, lane, lanes, stackGroup, size, spansMultipleDays }) => {
                // Week Columns reserves the compact blank-card stack treatment
                // for records that share the same start time. Partial overlaps
                // retain their normal content and positioning.
                const sameStartBlocks = isDayMode ? [] : blocks.filter(candidate => Math.abs(candidate.top - top) < .01);
                const startStackIndex = sameStartBlocks.findIndex(candidate => candidate.item.id === item.id);
                const startStackSize = sameStartBlocks.length;
                const isStartStack = startStackSize > 1 && startStackIndex >= 0;
                const isStartStackFront = isStartStack && startStackIndex === 0;
                const displayLane = isStartStack ? 0 : lane;
                const displayLanes = isStartStack ? 1 : lanes;
                const stackOffset = (displayLane - ((displayLanes - 1) / 2)) * 6;
                // Same-start cards share one exact grid coordinate. Back cards
                // peek above the front card, while the front card remains
                // anchored to the semantic start time.
                const stackTop = isStartStack
                  ? top - (startStackIndex * SAME_START_STACK_STEP_PX)
                  : top;
                const stackWidthInset = isStartStack ? startStackIndex * 8 : 0;
                // Back headers sit beneath unrelated neighbouring cards. This
                // prevents their reveal from painting through a card in the
                // preceding time slot, while the complete front card remains
                // the highest member of its own stack.
                const stackLayer = isStartStack
                  ? isStartStackFront
                    ? startStackSize + 2
                    : Math.max(0, startStackSize - startStackIndex - 1)
                  : displayLane + 2;
                const dayLanePercent = 100 / lanes;
                const cardLeft = isDayMode && lanes > 1
                  ? `${(lane + .5) * dayLanePercent}%`
                  : lanes > 1 && stackOffset !== 0
                    ? `calc(50% ${stackOffset > 0 ? '+' : '-'} ${Math.abs(stackOffset)}px)`
                    : '50%';
                const cardWidth = isDayMode && lanes > 1
                  ? `calc(${dayLanePercent}% - 8px)`
                  : `calc(100% - ${isDayMode ? 8 : 12 + stackWidthInset}px)`;
                const meta = sourceMeta(item);
                const startTimeLabel = item.startsAt ? timeLabel(item.startsAt) : '';
                const endTimeLabel = item.endsAt ? timeLabel(item.endsAt) : '';
                const people = showCardAttendees && calendarItemKind(item) === 'meeting'
                  ? attendeePeople?.[item.id]
                    ?? [...new Set([item.ownerName].filter((name): name is string => Boolean(name)))].map(name => ({ id: `${item.id}-${name}`, name }))
                  : [];
                const customColorVariables = calendarCustomColorVariables(item.customColor);
                const renderedHeight = renderedEventHeight(height);
                const extraSmall = renderedHeight <= (isDayMode ? 48 : 72);
                const density = extraSmall
                  ? `is-extra-small is-micro size-${size}`
                  : size === 'small' ? 'is-micro size-small' : size === 'medium' ? 'is-compact size-medium' : 'is-roomy size-large';
                const showTime = Boolean(item.startsAt);
                const deadline = deadlineMeta(item);
                const hasTitleIcon = showCardIcons && Boolean(item.titleIconType && item.titleIconValue);
                const hasVisibleTitleIcon = !isDayMode && hasTitleIcon;
                const showParticipants = people.length > 0;
                const avatarSize = size === 'small' ? 18 : size === 'large' ? 24 : 22;
                const avatarMax = size === 'small' ? 2 : size === 'large' ? 4 : 3;
                const entering = item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`);
                return (
                    <article key={item.id} class={`cal-tg-event${!isDayMode ? ' cal-week-column-event' : ''} tone-${calendarItemTone(item)} ${density}${item.colorKey ? ' has-custom-tone' : ''}${item.customColor ? ' has-custom-color' : ''}${hasVisibleTitleIcon ? ' has-title-icon' : ''}${showParticipants ? ' has-participants' : ''}${dimPastEvents && calendarItemIsPast(item, now) ? ' is-past' : ''}${deadline ? ` has-deadline is-deadline-${deadline.state}` : ''}${spansMultipleDays ? ' is-multi-day' : ''}${lanes > 1 ? ' is-overlapping' : ''}${isStartStack ? ` is-start-stack ${isStartStackFront ? 'is-start-stack-front' : 'is-start-stack-back'}` : ''}${onMoveItem && item.editable ? ' is-movable' : ''}${cardMove?.item.id === item.id && !cardMove.dragged ? ' is-pressed' : ''}${cardMove?.dragged && cardMove.item.id === item.id ? ' is-being-moved' : ''}${cardResize?.item.id === item.id ? ' is-being-resized' : ''}${entering ? ' cal-entry-is-entering' : ''}`}
                      data-card-size={size} data-calendar-lanes={lanes} data-calendar-stack-group={stackGroup} data-calendar-start-stack-size={isStartStack ? startStackSize : undefined} data-calendar-start-stack-index={isStartStack ? startStackIndex : undefined} data-calendar-item-id={item.id}
                      style={`top:${timelineTopInsetPx + stackTop}px;height:${renderedHeight}px;left:${cardLeft};width:${cardWidth};max-width:none;--cal-overlap-layer:${stackLayer};${customColorVariables}`}
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
                      <button type="button" class={`cal-tg-event-main tone-${calendarItemTone(item)}`} data-card-size={size} aria-label={`${meta.label}: ${item.title}`} onKeyDown={event => deleteCardByKeyboard(event, item)} onClick={event => {
                        if (suppressItemClickRef.current === item.id) {
                          suppressItemClickRef.current = null;
                          return;
                        }
                        setContext(null);
                        onOpenItem(item, { x: event.clientX, y: event.clientY });
                      }}>
                        <span class="cal-tg-event-title">{isDayMode
                          ? <OverflowTooltipText class="cal-day-overflow-title" text={item.title} />
                          : <OverflowTooltipText class="cal-week-overflow-title" text={item.title} />}</span>
                        {showTime ? <span class="cal-tg-event-time">
                          {spansMultipleDays && item.startsAt && item.endsAt
                            ? <><span class="cal-tg-time-token">{shortDateLabel(item.startsAt)} {startTimeLabel}</span><span class="cal-tg-time-token">– {shortDateLabel(item.endsAt)} {endTimeLabel}</span></>
                            : <><span class="cal-tg-time-token">{startTimeLabel}</span>{endTimeLabel ? <span class="cal-tg-time-token">– {endTimeLabel}</span> : null}</>}
                        </span> : null}
                        {deadline ? <span class="cal-tg-event-deadline"><LucideIcon name="Flag" size={9} />{deadline.label}</span> : null}
                        {showCardLocations && item.locationLabel ? <span class="cal-tg-event-location">{item.locationLabel}</span> : null}
                        {showParticipants ? <span class="cal-tg-event-people-slot"><AvatarGroup people={people} max={avatarMax} size={avatarSize} totalCount={Math.max(item.attendeeCount, people.length)} label={`${item.title} people`} class="cal-tg-event-people" /></span> : null}
                        {!isDayMode && showCardIcons ? <span class="cal-tg-week-card-icon" aria-hidden="true">{hasTitleIcon ? <CalendarTitleIcon type={item.titleIconType} value={item.titleIconValue} size={12} /> : <LucideIcon name={meta.icon} size={12} />}</span> : null}
                      </button>
                      {onMoveItem && item.editable ? <button type="button" class="cal-tg-event-resize" aria-label={`Resize ${item.title} in ${snapMinutes}-minute increments`} onPointerDown={event => beginCardResize(event, item, event.currentTarget)} onPointerMove={moveCardResize} onPointerUp={event => finishCardResize(event, event.currentTarget)} onPointerCancel={event => cancelCardResize(event, event.currentTarget)} onClick={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => resizeCardByKeyboard(event, item)}><span /></button> : null}
                    </article>
                );
              })}
              {!loading && !blocks.length && !byDay.find(d => d.key === key)?.allDay.length && sameDay(day, days[0] ?? day) && cols === 1
                ? <div class="cal-tg-day-empty">No timed items — double-click a slot to add one.</div> : null}
            </div>;
          })}
        </div>
      </div>
      <div class={`cal-tg-zoom-hud${zoomHudVisible ? ' is-visible' : ''}`} aria-hidden="true">{Math.round(zoom * 100)}%</div>
      <DropdownMenu id="cal-tg-context-menu" open={Boolean(context)} anchor={null} anchorPoint={context ? { x: context.x, y: context.y } : null} boundary={scrollRef.current} onClose={() => setContext(null)} align="start" placement={context?.kind === 'slot' ? 'right' : 'auto'} label={context?.kind === 'item' ? 'Calendar item actions' : 'Calendar slot actions'} items={context?.kind === 'item' ? [
        ...(context.item.origin === 'calendar' && context.item.status !== 'done' && context.item.status !== 'cancelled' && onSetReminder
          ? [{ id: 'reminder', label: 'Set reminder', icon: <LucideIcon name="BellRing" size={17} />, onSelect: () => onSetReminder(context.item) }]
          : []),
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
