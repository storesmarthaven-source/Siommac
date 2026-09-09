/**
 * src/api/calendar.ts
 *
 * TanStack Query hooks for the platform Calendar & Tasks module. Reads the one
 * shared CalendarItemDTO (types/calendar.ts); mutations invalidate the list so
 * every view (calendar page + widgets) refreshes together.
 */

import { useQuery, useMutation, useQueryClient, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { toast } from '@store/ui';
import { useSessionStore } from '@store/session';
import type {
  CalendarItemDTO, CalendarListRequest, CalendarListResponse,
  CreateTaskRequest, CreateActivityRequest, UpdateEntryRequest,
  CalendarTaskStatus, RecurrenceScope, CalendarAttendeeDTO,
  CalendarRemindersResponse, SetCalendarRemindersRequest,
  CalendarAttendeeResponseRequest,
  CalendarDayContextRequest, CalendarDayContextResponse,
  CalendarCollectionsResponse,
  CalendarCategoriesResponse,
  CreateCalendarCollectionRequest, UpdateCalendarCollectionRequest, ArchiveCalendarCollectionRequest,
  CalendarConnectionsResponse, CalendarProvider, CompleteCalendarOAuthRequest,
  ConnectCalendarCredentialsRequest, ToggleExternalCalendarRequest,
} from '../../types/calendar';

export type {
  CalendarItemDTO, CalendarItemType, CalendarItemOrigin, CalendarTaskStatus,
  CalendarTaskPriority, CalendarVisibility, RecurrenceScope,
  CalendarAttendeeDTO, CalendarAttendeeResponse, CalendarColorKey, UpdateEntryRequest,
  CalendarEntryKind, CalendarAvailability, CalendarCategoryDTO, CalendarCategoriesResponse, CalendarTitleIconType,
  CalendarHolidayMarkerDTO, CalendarDayContextRequest,
  CalendarCollectionDTO, CreateCalendarCollectionRequest, UpdateCalendarCollectionRequest,
  CalendarConnectionDTO, CalendarConnectionsResponse, CalendarProvider,
  CalendarProviderAvailabilityDTO, ExternalCalendarDTO,
  CompleteCalendarOAuthRequest, ConnectCalendarCredentialsRequest, ToggleExternalCalendarRequest,
} from '../../types/calendar';

// ── query keys ──────────────────────────────────────────────────────────────

export const calendarKeys = {
  all:  ['calendar'] as const,
  list: (req: CalendarListRequest) => [...calendarKeys.all, 'list', req] as const,
  item: (id: string) => [...calendarKeys.all, 'item', id] as const,
  reminders: (id: string) => [...calendarKeys.all, 'reminders', id] as const,
  dayContext: (req: CalendarDayContextRequest) => [...calendarKeys.all, 'day-context', req] as const,
  departments: () => [...calendarKeys.all, 'departments'] as const,
  collections: () => [...calendarKeys.all, 'collections'] as const,
  connections: () => [...calendarKeys.all, 'connections'] as const,
  categories: () => [...calendarKeys.all, 'categories'] as const,
};

export interface CalendarDepartmentOption { id: string; name: string }

export function useCalendarCategories(enabled = true) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: calendarKeys.categories(),
    enabled: enabled && isAuthenticated,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<CalendarCategoriesResponse>('calendar/categories/list', {}, { signal });
      if (!res.success) throw new Error(res.message ?? 'Failed to load calendar categories');
      return res.categories;
    },
  });
}

/** Lightweight authenticated department catalogue for calendar audience controls. */
export function useCalendarDepartments(enabled = true) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: calendarKeys.departments(),
    enabled: enabled && isAuthenticated,
    staleTime: 60_000,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data?: CalendarDepartmentOption[]; message?: string }>('listDepartments', {}, { signal });
      if (!res.success) throw new Error(res.message ?? 'Failed to load departments');
      return (res.data ?? []).map(({ id, name }) => ({ id, name }));
    },
  });
}

// ── list ────────────────────────────────────────────────────────────────────

export function useCalendarList(req: CalendarListRequest, enabled = true) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey:        calendarKeys.list(req),
    enabled:         enabled && isAuthenticated && !!req.from && !!req.to,
    placeholderData: prev => prev,   // keep the current month visible while the next loads
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<CalendarListResponse>('calendar/list', req as unknown as Record<string, unknown>, { signal });
      if (!res.success) throw new Error(res.message ?? 'Failed to load calendar');
      return res.items;
    },
  });
}

export function useCalendarCollections(enabled = true) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: calendarKeys.collections(),
    enabled: enabled && isAuthenticated,
    staleTime: 30_000,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<CalendarCollectionsResponse>('calendar/calendars/list', {}, { signal });
      if (!res.success) throw new Error(res.message ?? 'Failed to load calendars');
      return res.calendars;
    },
  });
}

export function useCalendarConnections(enabled = true) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: calendarKeys.connections(),
    enabled: enabled && isAuthenticated,
    staleTime: 30_000,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<CalendarConnectionsResponse>('calendar/connections/list', {}, { signal });
      if (!res.success) throw new Error(res.message ?? 'Failed to load connected calendars');
      return res;
    },
  });
}

/** Published public-holiday metadata for day headers. This deliberately stays
 * outside the item list so a holiday cannot consume an event lane. */
export function useCalendarDayContext(req: CalendarDayContextRequest | null) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: req ? calendarKeys.dayContext(req) : [...calendarKeys.all, 'day-context', 'none'],
    enabled: isAuthenticated && req !== null,
    staleTime: 60 * 60_000,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<CalendarDayContextResponse>('calendar/day-context', req as unknown as Record<string, unknown>, { signal });
      if (!res.success) throw new Error(res.message ?? 'Failed to load calendar day context');
      return res.holidays;
    },
  });
}

export function useCalendarItem(id: string | null) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: calendarKeys.item(id ?? ''),
    enabled:  !!id && isAuthenticated,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; item: CalendarItemDTO; attendees: CalendarAttendeeDTO[]; message?: string }>(
        'calendar/get', { id }, { signal });
      if (!res.success) throw new Error(res.message ?? 'Failed to load item');
      return { item: res.item, attendees: res.attendees };
    },
  });
}

export function useCalendarReminders(id: string | null) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: calendarKeys.reminders(id ?? ''),
    enabled: !!id && isAuthenticated,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<CalendarRemindersResponse>('calendar/reminders/get', { id }, { signal });
      if (!res.success) throw new Error(res.message ?? 'Failed to load reminders');
      return res.offsetMinutes;
    },
  });
}

// ── mutations ───────────────────────────────────────────────────────────────

function useInvalidateCalendar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: calendarKeys.all });
}

export function useCreateTask() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: CreateTaskRequest) => apiPost<{ success: boolean; id?: string; message?: string }>('calendar/task/create', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to create task.'); return; }
      toast.success('Task created.'); void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useCreateActivity() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: CreateActivityRequest) => apiPost<{ success: boolean; id?: string; message?: string }>('calendar/activity/create', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to create activity.'); return; }
      toast.success('Activity created.'); void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useCreateCalendarCollection() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: CreateCalendarCollectionRequest) => apiPost<{ success: boolean; id?: string; message?: string }>('calendar/calendars/create', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to create calendar.'); return; }
      toast.success('Calendar created.'); void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useUpdateCalendarCollection() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: UpdateCalendarCollectionRequest) => apiPost<{ success: boolean; id?: string; message?: string }>('calendar/calendars/update', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to update calendar.'); return; }
      toast.success('Calendar updated.'); void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useArchiveCalendarCollection() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: ArchiveCalendarCollectionRequest) => apiPost<{ success: boolean; id?: string; message?: string }>('calendar/calendars/archive', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to archive calendar.'); return; }
      toast.success('Calendar archived.'); void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

function useCalendarConnectionMutation<TRequest extends Record<string, unknown>, TResponse extends { success: boolean; message?: string }>(
  endpoint: string,
  successMessage: string,
) {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: TRequest) => apiPost<TResponse>(endpoint, req),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'The calendar connection could not be updated.'); return; }
      toast.success(successMessage);
      void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useStartCalendarOAuth() {
  return useMutation({
    mutationFn: (provider: Extract<CalendarProvider, 'google' | 'microsoft'>) =>
      apiPost<{ success: boolean; authorizationUrl?: string; message?: string }>('calendar/connections/oauth/start', { provider }),
  });
}

export function useCompleteCalendarOAuth() {
  return useCalendarConnectionMutation<CompleteCalendarOAuthRequest & Record<string, unknown>, { success: boolean; message?: string; syncWarning?: string }>(
    'calendar/connections/oauth/complete',
    'Calendar account connected.',
  );
}

export function useConnectCalendarCredentials() {
  return useCalendarConnectionMutation<ConnectCalendarCredentialsRequest & { idempotencyKey: string } & Record<string, unknown>, { success: boolean; message?: string; syncWarning?: string }>(
    'calendar/connections/credentials/connect',
    'Calendar account connected.',
  );
}

export function useToggleExternalCalendar() {
  return useCalendarConnectionMutation<ToggleExternalCalendarRequest & Record<string, unknown>, { success: boolean; message?: string; syncWarning?: string }>(
    'calendar/connections/calendar/toggle',
    'Calendar visibility updated.',
  );
}

export function useSyncCalendarConnection() {
  return useCalendarConnectionMutation<{ connectionId: string }, { success: boolean; message?: string }>(
    'calendar/connections/sync',
    'Calendar sync complete.',
  );
}

export function useDisconnectCalendarConnection() {
  return useCalendarConnectionMutation<{ connectionId: string; idempotencyKey: string }, { success: boolean; message?: string }>(
    'calendar/connections/disconnect',
    'Calendar account disconnected.',
  );
}

export function useUpdateEntry(options: { announceSuccess?: boolean } = {}) {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: async (req: UpdateEntryRequest) => {
      const response = await apiPost<{ success: boolean; message?: string }>('calendar/update', req as unknown as Record<string, unknown>);
      if (!response.success) throw new Error(response.message ?? 'Failed to update.');
      return response;
    },
    onSuccess: () => {
      if (options.announceSuccess !== false) toast.success('Saved.');
      void invalidate();
    },
  });
}

export function useTaskStatus() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: { id: string; status: CalendarTaskStatus; scope?: RecurrenceScope; occurrenceDate?: string }) =>
      apiPost<{ success: boolean; message?: string }>('calendar/task/status', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to update task.'); return; }
      void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useCancelEntry() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: { id: string; scope?: RecurrenceScope; occurrenceDate?: string }) =>
      apiPost<{ success: boolean; message?: string }>('calendar/cancel', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to cancel.'); return; }
      toast.success('Cancelled.'); void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useSetCalendarReminders() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: SetCalendarRemindersRequest) =>
      apiPost<CalendarRemindersResponse>('calendar/reminders/set', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to save reminders.'); return; }
      toast.success('Reminder settings saved.'); void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useRespondToCalendarActivity() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: CalendarAttendeeResponseRequest) =>
      apiPost<{ success: boolean; message?: string }>('calendar/activity/respond', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to record your response.'); return; }
      toast.success('Response recorded.'); void invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}
