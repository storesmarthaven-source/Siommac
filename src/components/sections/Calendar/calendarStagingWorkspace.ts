import type { CalendarAttendeeResponse, CalendarItemDTO } from '@api/calendar';
import { calendarStagingItems, type CalendarStagedAttendee } from './calendarStaging';

export const CALENDAR_STAGING_WORKSPACE_KEY = 'siomac.calendar.staging-workspace.v1';

export interface CalendarStagingWorkspace {
  version: 1;
  items: CalendarItemDTO[];
  peopleByItem: Record<string, CalendarStagedAttendee[]>;
  reminderOffsetsByItem: Record<string, number[]>;
  responses: Record<string, Exclude<CalendarAttendeeResponse, 'invited'>>;
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
  return Array.isArray(value.items)
    && value.items.every(isCalendarItem)
    && isPeopleMap(value.peopleByItem)
    && isReminderMap(value.reminderOffsetsByItem)
    && isResponseMap(value.responses);
}

export function defaultCalendarStagingWorkspace(today = new Date()): CalendarStagingWorkspace {
  return {
    version: 1,
    items: calendarStagingItems(today),
    peopleByItem: {},
    reminderOffsetsByItem: {},
    responses: {},
  };
}

export function loadCalendarStagingWorkspace(storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage): CalendarStagingWorkspace {
  if (!storage) return defaultCalendarStagingWorkspace();
  try {
    const serialized = storage.getItem(CALENDAR_STAGING_WORKSPACE_KEY);
    if (!serialized) return defaultCalendarStagingWorkspace();
    const parsed: unknown = JSON.parse(serialized);
    return isCalendarStagingWorkspace(parsed) ? parsed : defaultCalendarStagingWorkspace();
  } catch {
    return defaultCalendarStagingWorkspace();
  }
}

export function saveCalendarStagingWorkspace(workspace: CalendarStagingWorkspace, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  storage.setItem(CALENDAR_STAGING_WORKSPACE_KEY, JSON.stringify(workspace));
}
