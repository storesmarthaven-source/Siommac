import type { CalendarAttendeeResponse, CalendarItemDTO } from '@api/calendar';
import { addDays, itemDateKey, itemOccursOnDate, parseLocalDate, toLocalDateKey } from '@lib/calendar/date';
import { calendarStagingItems, type CalendarStagedAttendee } from './calendarStaging';

export const CALENDAR_STAGING_WORKSPACE_KEY = 'siomac.calendar.staging-workspace.v3';
export const CALENDAR_STAGING_DEFAULTS_KEY = 'siomac.calendar.staging-defaults.v1';

export type CalendarStagingTemplateScope = 'day' | 'week';

export interface CalendarStagingWorkspace {
  version: 1;
  /** Sunday that calendar-demo-* positions are relative to. Optional only for
   * workspaces saved before Week staging covered the complete visible week. */
  anchorDate?: string;
  items: CalendarItemDTO[];
  peopleByItem: Record<string, CalendarStagedAttendee[]>;
  reminderOffsetsByItem: Record<string, number[]>;
  responses: Record<string, Exclude<CalendarAttendeeResponse, 'invited'>>;
}

export interface CalendarStagingTemplate {
  version: 1;
  scope: CalendarStagingTemplateScope;
  anchorDate: string;
  savedAt: string;
  items: CalendarItemDTO[];
  peopleByItem: Record<string, CalendarStagedAttendee[]>;
  reminderOffsetsByItem: Record<string, number[]>;
  responses: Record<string, Exclude<CalendarAttendeeResponse, 'invited'>>;
}

export interface CalendarStagingDefaults {
  version: 1;
  day?: CalendarStagingTemplate;
  week?: CalendarStagingTemplate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCalendarItem(value: unknown): value is CalendarItemDTO {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && (value.type === 'activity' || value.type === 'task' || value.type === 'deadline');
}

function isAttendee(value: unknown): value is CalendarStagedAttendee {
  if (!isRecord(value)) return false;
  return typeof value.userId === 'string'
    && typeof value.name === 'string'
    && typeof value.role === 'string'
    && (value.profileImage === null || typeof value.profileImage === 'string')
    && (value.responseStatus === 'invited' || value.responseStatus === 'accepted' || value.responseStatus === 'declined' || value.responseStatus === 'tentative');
}

function isPeopleMap(value: unknown): value is Record<string, CalendarStagedAttendee[]> {
  return isRecord(value) && Object.values(value).every(people => Array.isArray(people) && people.every(isAttendee));
}

function isReminderMap(value: unknown): value is Record<string, number[]> {
  return isRecord(value) && Object.values(value).every(offsets => Array.isArray(offsets)
    && offsets.every(offset => typeof offset === 'number' && Number.isInteger(offset) && offset >= 0));
}

function isResponseMap(value: unknown): value is CalendarStagingWorkspace['responses'] {
  return isRecord(value) && Object.values(value).every(response => response === 'accepted' || response === 'declined' || response === 'tentative');
}

function isCalendarStagingWorkspace(value: unknown): value is CalendarStagingWorkspace {
  if (!isRecord(value) || value.version !== 1) return false;
  return (value.anchorDate === undefined || (typeof value.anchorDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.anchorDate)))
    && Array.isArray(value.items)
    && value.items.every(isCalendarItem)
    && isPeopleMap(value.peopleByItem)
    && isReminderMap(value.reminderOffsetsByItem)
    && isResponseMap(value.responses);
}

function isCalendarStagingTemplate(value: unknown, scope: CalendarStagingTemplateScope): value is CalendarStagingTemplate {
  if (!isRecord(value) || value.version !== 1 || value.scope !== scope) return false;
  return typeof value.anchorDate === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value.anchorDate)
    && typeof value.savedAt === 'string'
    && Array.isArray(value.items)
    && value.items.every(isCalendarItem)
    && isPeopleMap(value.peopleByItem)
    && isReminderMap(value.reminderOffsetsByItem)
    && isResponseMap(value.responses);
}

function isCalendarStagingDefaults(value: unknown): value is CalendarStagingDefaults {
  if (!isRecord(value) || value.version !== 1) return false;
  return (value.day === undefined || isCalendarStagingTemplate(value.day, 'day'))
    && (value.week === undefined || isCalendarStagingTemplate(value.week, 'week'));
}

function stagingWeekStart(day: Date): Date {
  return addDays(day, -day.getDay());
}

function shiftDateKey(key: string | null, dayDelta: number): string | null {
  return key ? toLocalDateKey(addDays(parseLocalDate(key), dayDelta)) : null;
}

function shiftTimestamp(value: string | null, dayDelta: number): string | null {
  if (!value) return null;
  const shifted = new Date(value);
  shifted.setDate(shifted.getDate() + dayDelta);
  return shifted.toISOString();
}

function shiftCalendarItem(item: CalendarItemDTO, dayDelta: number): CalendarItemDTO {
  return {
    ...item,
    startsOn: shiftDateKey(item.startsOn, dayDelta),
    endsOn: shiftDateKey(item.endsOn, dayDelta),
    occurrenceDate: shiftDateKey(item.occurrenceDate ?? null, dayDelta),
    startsAt: shiftTimestamp(item.startsAt, dayDelta),
    endsAt: shiftTimestamp(item.endsAt, dayDelta),
    deadlineAt: shiftTimestamp(item.deadlineAt ?? null, dayDelta),
  };
}

function scopedDates(scope: CalendarStagingTemplateScope, anchor: Date): Date[] {
  const first = scope === 'week' ? stagingWeekStart(anchor) : anchor;
  return Array.from({ length: scope === 'week' ? 7 : 1 }, (_, index) => addDays(first, index));
}

function touchesDates(item: CalendarItemDTO, dates: readonly Date[]): boolean {
  return dates.some(date => itemOccursOnDate(item, toLocalDateKey(date)));
}

function keepMetadataForItems<T>(map: Record<string, T>, items: readonly CalendarItemDTO[]): Record<string, T> {
  const retainedIds = new Set(items.map(item => item.id));
  return Object.fromEntries(Object.entries(map).filter(([id]) => retainedIds.has(id)));
}

function rebaseStagingWorkspace(workspace: CalendarStagingWorkspace, today: Date): CalendarStagingWorkspace {
  const targetAnchor = toLocalDateKey(stagingWeekStart(today));
  const legacyAnchorItem = workspace.items.find(item => {
    const match = /^calendar-demo-(\d+)$/.exec(item.id);
    return match && Number(match[1]) <= 10 && itemDateKey(item);
  });
  const sourceAnchor = workspace.anchorDate ?? (legacyAnchorItem ? itemDateKey(legacyAnchorItem) : null);
  if (!sourceAnchor || sourceAnchor === targetAnchor) return { ...workspace, anchorDate: targetAnchor };
  const sourceDate = parseLocalDate(sourceAnchor);
  const targetDate = parseLocalDate(targetAnchor);
  const dayDelta = Math.round((targetDate.getTime() - sourceDate.getTime()) / 86_400_000);
  return {
    ...workspace,
    anchorDate: targetAnchor,
    items: workspace.items.map(item => shiftCalendarItem(item, dayDelta)),
  };
}

export function defaultCalendarStagingWorkspace(today = new Date()): CalendarStagingWorkspace {
  const sunday = stagingWeekStart(today);
  return {
    version: 1,
    anchorDate: toLocalDateKey(sunday),
    items: calendarStagingItems(sunday),
    peopleByItem: {},
    reminderOffsetsByItem: {},
    responses: {},
  };
}

export function loadCalendarStagingWorkspace(storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage, today = new Date()): CalendarStagingWorkspace {
  if (!storage) return defaultCalendarStagingWorkspace(today);
  try {
    const serialized = storage.getItem(CALENDAR_STAGING_WORKSPACE_KEY);
    if (!serialized) return defaultCalendarStagingWorkspace(today);
    const parsed: unknown = JSON.parse(serialized);
    return isCalendarStagingWorkspace(parsed) ? rebaseStagingWorkspace(parsed, today) : defaultCalendarStagingWorkspace(today);
  } catch {
    return defaultCalendarStagingWorkspace(today);
  }
}

export function saveCalendarStagingWorkspace(workspace: CalendarStagingWorkspace, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  storage.setItem(CALENDAR_STAGING_WORKSPACE_KEY, JSON.stringify(workspace));
}

export function loadCalendarStagingDefaults(storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage): CalendarStagingDefaults {
  if (!storage) return { version: 1 };
  try {
    const serialized = storage.getItem(CALENDAR_STAGING_DEFAULTS_KEY);
    if (!serialized) return { version: 1 };
    const parsed: unknown = JSON.parse(serialized);
    return isCalendarStagingDefaults(parsed) ? parsed : { version: 1 };
  } catch {
    return { version: 1 };
  }
}

export function saveCalendarStagingDefaults(defaults: CalendarStagingDefaults, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  storage.setItem(CALENDAR_STAGING_DEFAULTS_KEY, JSON.stringify(defaults));
}

export function createCalendarStagingTemplate(
  workspace: CalendarStagingWorkspace,
  scope: CalendarStagingTemplateScope,
  selectedDate: Date,
  savedAt = new Date(),
): CalendarStagingTemplate {
  const dates = scopedDates(scope, selectedDate);
  const items = workspace.items.filter(item => touchesDates(item, dates));
  const anchorDate = toLocalDateKey(dates[0]!);
  return {
    version: 1,
    scope,
    anchorDate,
    savedAt: savedAt.toISOString(),
    items,
    peopleByItem: keepMetadataForItems(workspace.peopleByItem, items),
    reminderOffsetsByItem: keepMetadataForItems(workspace.reminderOffsetsByItem, items),
    responses: keepMetadataForItems(workspace.responses, items),
  };
}

export function applyCalendarStagingTemplate(
  workspace: CalendarStagingWorkspace,
  template: CalendarStagingTemplate,
  selectedDate: Date,
): CalendarStagingWorkspace {
  const alignedWorkspace = template.scope === 'day' ? rebaseStagingWorkspace(workspace, selectedDate) : workspace;
  const targetDates = scopedDates(template.scope, selectedDate);
  const targetAnchor = toLocalDateKey(targetDates[0]!);
  const sourceAnchor = parseLocalDate(template.anchorDate);
  const targetAnchorDate = parseLocalDate(targetAnchor);
  const dayDelta = Math.round((targetAnchorDate.getTime() - sourceAnchor.getTime()) / 86_400_000);
  const retainedItems = template.scope === 'week'
    ? []
    : alignedWorkspace.items.filter(item => !touchesDates(item, targetDates));
  const usedIds = new Set(retainedItems.map(item => item.id));
  const copiedPeople: Record<string, CalendarStagedAttendee[]> = {};
  const copiedReminders: Record<string, number[]> = {};
  const copiedResponses: CalendarStagingWorkspace['responses'] = {};
  const copiedItems = template.items.map((item, index) => {
    const baseId = `calendar-staging-${template.scope}-${targetAnchor}-${index + 1}`;
    let id = baseId;
    let duplicate = 2;
    while (usedIds.has(id)) { id = `${baseId}-${duplicate}`; duplicate += 1; }
    usedIds.add(id);
    if (template.peopleByItem[item.id]) copiedPeople[id] = template.peopleByItem[item.id]!.map(person => ({ ...person }));
    if (template.reminderOffsetsByItem[item.id]) copiedReminders[id] = [...template.reminderOffsetsByItem[item.id]!];
    if (template.responses[item.id]) copiedResponses[id] = template.responses[item.id]!;
    return { ...shiftCalendarItem(item, dayDelta), id };
  });

  return {
    version: 1,
    anchorDate: toLocalDateKey(stagingWeekStart(selectedDate)),
    items: [...retainedItems, ...copiedItems],
    peopleByItem: { ...keepMetadataForItems(alignedWorkspace.peopleByItem, retainedItems), ...copiedPeople },
    reminderOffsetsByItem: { ...keepMetadataForItems(alignedWorkspace.reminderOffsetsByItem, retainedItems), ...copiedReminders },
    responses: { ...keepMetadataForItems(alignedWorkspace.responses, retainedItems), ...copiedResponses },
  };
}
