import type {
  CalendarEntryKind,
  CalendarItemDTO,
  CalendarTaskPriority,
  CalendarTaskStatus,
  CalendarVisibility,
} from '@api/calendar';
import { isOverdue, itemDateKey, parseLocalDate } from '@lib/calendar/date';

export type CalendarViewMode = 'month' | 'week' | 'day' | 'agenda' | 'tasks';
export type CalendarScope = 'all' | 'mine' | 'shared' | 'public' | 'archived';
export type CalendarQuickType = 'all' | CalendarEntryKind;
export type CalendarCategory = string;

export interface CalendarFilters {
  type: CalendarQuickType;
  source: string;
  status: 'all' | CalendarTaskStatus;
  priority: 'all' | CalendarTaskPriority;
  assignment: 'all' | 'me' | 'owned';
  visibility: 'all' | CalendarVisibility;
}

export const EMPTY_FILTERS: CalendarFilters = {
  type: 'all',
  source: 'all',
  status: 'all',
  priority: 'all',
  assignment: 'all',
  visibility: 'all',
};

export function calendarSource(item: CalendarItemDTO): string {
  if (item.origin === 'calendar') return item.sourceModule ?? 'calendar';
  return item.sourceModule ?? 'module';
}

export function calendarCategory(item: CalendarItemDTO): CalendarCategory {
  return item.categoryKey || 'general';
}

/** Normalize legacy/projected records at the presentation boundary. Native
 * Calendar rows always provide `kind`; projected module deadlines still use
 * the historical `type: deadline` contract and take precedence over a stale
 * fallback kind supplied by an older adapter. */
export function calendarItemKind(item: CalendarItemDTO): CalendarEntryKind {
  if (item.type === 'deadline') return 'deadline';
  if (item.kind) return item.kind;
  if (item.sourceModule === 'meetings') return 'meeting';
  return item.type === 'task' ? 'task' : 'event';
}

/** Canonical card palette used by every calendar projection. Meetings are the
 * one fixed semantic colour; an explicit user selection wins for all others. */
export function calendarItemTone(item: CalendarItemDTO): string {
  if (calendarItemKind(item) === 'meeting') return 'blue';
  if (item.colorKey) return item.colorKey;
  if (item.sourceLabel?.toLocaleLowerCase().includes('talk')) return 'navy';
  if (item.type === 'deadline') return 'amber';
  if (item.type === 'task') return item.priority === 'high' ? 'coral' : 'purple';
  const tones = ['mint', 'blue', 'coral', 'amber', 'purple'] as const;
  const hash = Array.from(`${item.sourceModule ?? ''}:${item.title}`).reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0);
  return tones[hash % tones.length]!;
}

export function sourceLabel(item: CalendarItemDTO): string {
  if (item.origin === 'calendar') {
    const kind = calendarItemKind(item);
    return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
  }
  if (item.sourceLabel) return item.sourceLabel;
  const source = calendarSource(item);
  return source.split(/[-_]/g).map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

export function sourceTone(item: CalendarItemDTO): string {
  if (isOverdue(item)) return 'overdue';
  const source = calendarSource(item).toLowerCase();
  if (source.includes('payroll')) return 'payroll';
  if (source.includes('finance') || source.includes('statutory')) return 'statutory';
  if (source.includes('work-calendar') || source.includes('holiday') || source.includes('closure')) return 'closure';
  if (source.includes('hr')) return 'hr';
  if (source.includes('hse')) return 'hse';
  if (source.includes('operation')) return 'ops';
  return item.type;
}

export function itemSortValue(item: CalendarItemDTO): string {
  return `${itemDateKey(item) ?? '9999-12-31'}|${item.allDay ? '0' : '1'}|${item.startsAt ?? ''}|${item.title}`;
}

export function filterCalendarItems(
  items: CalendarItemDTO[],
  options: {
    scope: CalendarScope;
    search: string;
    filters: CalendarFilters;
    userId: string | null;
  },
): CalendarItemDTO[] {
  const needle = options.search.trim().toLocaleLowerCase();
  return items.filter(item => {
    const archived = item.status === 'done' || item.status === 'cancelled';
    if (options.scope === 'all' && archived) return false;
    if (options.scope === 'mine' && item.ownerUserId !== options.userId && item.assigneeUserId !== options.userId) return false;
    if (options.scope === 'archived' && !archived) return false;
    if (options.scope === 'shared' && item.origin === 'calendar' && item.visibility !== 'team' && item.visibility !== 'org') return false;
    if (options.scope === 'public' && item.origin === 'calendar' && item.visibility !== 'org') return false;

    if (needle) {
      const haystack = [item.title, item.notes, item.sourceLabel, item.sourceModule, item.ownerName, item.assigneeName]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    const f = options.filters;
    if (f.type === 'deadline') {
      if (calendarItemKind(item) !== 'deadline' && !item.deadlineAt) return false;
    } else if (f.type !== 'all' && calendarItemKind(item) !== f.type) return false;
    if (f.source !== 'all' && calendarSource(item) !== f.source) return false;
    if (f.status !== 'all' && item.status !== f.status) return false;
    if (f.priority !== 'all' && item.priority !== f.priority) return false;
    if (f.visibility !== 'all' && item.visibility !== f.visibility) return false;
    if (f.assignment === 'me' && item.assigneeUserId !== options.userId) return false;
    if (f.assignment === 'owned' && item.ownerUserId !== options.userId) return false;
    return true;
  }).sort((a, b) => itemSortValue(a).localeCompare(itemSortValue(b)));
}

export function groupItemsByDate(items: CalendarItemDTO[]): { key: string; date: Date; items: CalendarItemDTO[] }[] {
  const groups = new Map<string, CalendarItemDTO[]>();
  for (const item of items) {
    const key = itemDateKey(item);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, grouped]) => ({ key, date: parseLocalDate(key), items: grouped.sort((a, b) => itemSortValue(a).localeCompare(itemSortValue(b))) }));
}

export function upcomingActionItems(items: CalendarItemDTO[], todayKey: string, limit = 4): CalendarItemDTO[] {
  return items
    .filter(item => {
      const key = itemDateKey(item);
      return !!key
        && key >= todayKey
        && (item.type === 'deadline' || item.type === 'task')
        && item.status !== 'done'
        && item.status !== 'cancelled';
    })
    .sort((a, b) => itemSortValue(a).localeCompare(itemSortValue(b)))
    .slice(0, limit);
}

/** Items surfaced in the compact action preview. Ordinary calendar events are
 * deliberately excluded: they remain selectable on the grid, but do not take
 * over the user's attention rail unless they require a response or link to an
 * operational action. */
export function calendarItemHasAction(item: CalendarItemDTO, userId: string | null): boolean {
  if (item.status === 'done' || item.status === 'cancelled') return false;
  if (item.completable || item.assignable) return true;
  if (item.drillThrough && Boolean(item.sourceRoute)) return true;
  if (item.type === 'task') return !item.assigneeUserId || item.assigneeUserId === userId;
  return item.type === 'activity'
    && item.attendeeCount > 0
    && item.ownerUserId !== userId;
}

export function activeFilterCount(filters: CalendarFilters): number {
  return Object.values(filters).filter(value => value !== 'all').length;
}
