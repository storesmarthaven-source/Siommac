// Shared Work Calendar (F-CAL) API hooks. All commands are authenticated POST endpoints that carry
// a caller-owned `requestKey` (idempotency) + `reason`; the backend injects the audit actor. Reads
// are bounded + cursor-paginated. Contract: docs/module-contracts/shared-work-calendar-delivery-contract.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  AssignmentCommandResult, AssignmentRow, AssignmentScope, HolidayCalendarDetail, HolidayCalendarSummary,
  HolidayDateDto, HolidayInput, HolidaySetCommandResult, HolidayVersionDto, Page, ResolvePreview,
  WorkCalendarCommandResult, WorkCalendarDetail, WorkCalendarSummary,
} from '../../../types/workCalendars';

export type * from '../../../types/workCalendars';

const HOLIDAY_SET = 'hr/work-calendars/holiday-set/command';
const VERSION = 'hr/work-calendars/version/command';
const ASSIGNMENT = 'hr/work-calendars/assignment/command';
const READ = 'hr/work-calendars/read';

async function post<T>(path: string, args: object): Promise<T> {
  const r = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!r.success) throw new Error(r.message ?? 'Work-calendar request failed.');
  return r.data;
}

/** One fresh idempotency key per command ATTEMPT. */
export const requestKey = (): string => crypto.randomUUID();

// ── Command inputs (mirror the route discriminated unions) ────────────────────
type Base = { requestKey: string; reason: string };
export type HolidaySetCommandInput =
  | (Base & { command: 'create_version'; calendarId?: string; calendar?: { name: string; jurisdiction: string }; effectiveFrom: string; effectiveTo?: string; timezone?: string })
  | (Base & { command: 'copy_version'; sourceVersionId: string; effectiveFrom: string; effectiveTo?: string })
  | (Base & { command: 'add_holiday'; versionId: string; expectedLockVersion: number; holiday: HolidayInput })
  | (Base & { command: 'update_holiday'; versionId: string; holidayId: string; expectedLockVersion: number; holiday: HolidayInput })
  | (Base & { command: 'remove_holiday'; versionId: string; holidayId: string; expectedLockVersion: number })
  | (Base & { command: 'publish_version'; versionId: string; expectedVersionLockVersion: number; expectedCalendarLockVersion: number });

export type WorkCalendarCommandInput =
  | (Base & { command: 'create_version'; calendarId?: string; calendar?: { name: string }; effectiveFrom: string; effectiveTo?: string; timezone?: string; holidayCalendarVersionId: string; workingWeekdays: number[]; weekdayFractions?: Record<string, number> })
  | (Base & { command: 'copy_version'; sourceVersionId: string; effectiveFrom: string; effectiveTo?: string })
  | (Base & { command: 'set_pattern'; versionId: string; expectedLockVersion: number; workingWeekdays: number[]; weekdayFractions?: Record<string, number>; holidayCalendarVersionId?: string })
  | (Base & { command: 'publish_version'; versionId: string; expectedVersionLockVersion: number; expectedCalendarLockVersion: number });

export type AssignmentCommandInput =
  | (Base & { command: 'assign'; scope: AssignmentScope; payGroupId?: string; workCalendarVersionId: string; effectiveFrom: string; effectiveTo?: string })
  | (Base & { command: 'end_assignment'; assignmentId: string; effectiveTo: string })
  | (Base & { command: 'cancel_assignment'; assignmentId: string });

export interface ListArgs { search?: string; cursor?: string; limit?: number }

export const workCalendarKeys = {
  all: ['hr', 'work-calendars'] as const,
  holidayList: (a: ListArgs) => ['hr', 'work-calendars', 'holiday', 'list', a] as const,
  holidayDetail: (id: string) => ['hr', 'work-calendars', 'holiday', id] as const,
  holidays: (versionId: string) => ['hr', 'work-calendars', 'holidays', versionId] as const,
  workList: (a: ListArgs) => ['hr', 'work-calendars', 'work', 'list', a] as const,
  workDetail: (id: string) => ['hr', 'work-calendars', 'work', id] as const,
  assignments: (payGroupId?: string) => ['hr', 'work-calendars', 'assignments', payGroupId ?? 'all'] as const,
};

export const workCalendarsApi = {
  // reads
  listHolidayCalendars: (a: ListArgs) => post<Page<HolidayCalendarSummary>>(READ, { action: 'list_holiday_calendars', ...a }),
  listWorkCalendars: (a: ListArgs) => post<Page<WorkCalendarSummary>>(READ, { action: 'list_work_calendars', ...a }),
  getHolidayCalendar: (id: string) => post<HolidayCalendarDetail>(READ, { action: 'get_holiday_calendar', id }),
  getWorkCalendar: (id: string) => post<WorkCalendarDetail>(READ, { action: 'get_work_calendar', id }),
  listHolidays: (versionId: string) => post<{ items: HolidayDateDto[] }>(READ, { action: 'list_holidays', versionId }),
  listAssignments: (payGroupId?: string) => post<{ items: AssignmentRow[] }>(READ, { action: 'list_assignments', ...(payGroupId ? { payGroupId } : {}) }),
  resolve: (payGroupId: string, periodStart: string, periodEnd: string) => post<ResolvePreview>(READ, { action: 'resolve', payGroupId, periodStart, periodEnd }),
  // commands
  holidaySetCommand: (input: HolidaySetCommandInput) => post<HolidaySetCommandResult>(HOLIDAY_SET, input),
  workCalendarCommand: (input: WorkCalendarCommandInput) => post<WorkCalendarCommandResult>(VERSION, input),
  assignmentCommand: (input: AssignmentCommandInput) => post<AssignmentCommandResult>(ASSIGNMENT, input),
};

// ── Read hooks ────────────────────────────────────────────────────────────────
export function useHolidayCalendars(a: ListArgs) {
  return useQuery({ queryKey: workCalendarKeys.holidayList(a), queryFn: () => workCalendarsApi.listHolidayCalendars(a), placeholderData: p => p });
}
export function useWorkCalendars(a: ListArgs) {
  return useQuery({ queryKey: workCalendarKeys.workList(a), queryFn: () => workCalendarsApi.listWorkCalendars(a), placeholderData: p => p });
}
export function useHolidayCalendar(id: string | null) {
  return useQuery({ queryKey: workCalendarKeys.holidayDetail(id ?? ''), queryFn: () => workCalendarsApi.getHolidayCalendar(id!), enabled: !!id });
}
export function useWorkCalendar(id: string | null) {
  return useQuery({ queryKey: workCalendarKeys.workDetail(id ?? ''), queryFn: () => workCalendarsApi.getWorkCalendar(id!), enabled: !!id });
}
export function useHolidays(versionId: string | null) {
  return useQuery({ queryKey: workCalendarKeys.holidays(versionId ?? ''), queryFn: () => workCalendarsApi.listHolidays(versionId!), enabled: !!versionId });
}
export function useAssignments(payGroupId?: string) {
  return useQuery({ queryKey: workCalendarKeys.assignments(payGroupId), queryFn: () => workCalendarsApi.listAssignments(payGroupId) });
}

export function useWorkCalendarMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: workCalendarKeys.all }); },
  });
}
