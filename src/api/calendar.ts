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
  CalendarTaskStatus, RecurrenceScope,
} from '../../types/calendar';

export type {
  CalendarItemDTO, CalendarItemType, CalendarItemOrigin, CalendarTaskStatus,
  CalendarTaskPriority, CalendarVisibility, RecurrenceScope,
} from '../../types/calendar';

// ── query keys ──────────────────────────────────────────────────────────────

export const calendarKeys = {
  all:  ['calendar'] as const,
  list: (req: CalendarListRequest) => [...calendarKeys.all, 'list', req] as const,
  item: (id: string) => [...calendarKeys.all, 'item', id] as const,
};

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

export function useCalendarItem(id: string | null) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: calendarKeys.item(id ?? ''),
    enabled:  !!id && isAuthenticated,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; item: CalendarItemDTO; attendees: { user_id: string; response_status: string }[]; message?: string }>(
        'calendar/get', { id }, { signal });
      if (!res.success) throw new Error(res.message ?? 'Failed to load item');
      return { item: res.item, attendees: res.attendees ?? [] };
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
      toast.success('Task created.'); invalidate();
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
      toast.success('Activity created.'); invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useUpdateEntry() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: UpdateEntryRequest) => apiPost<{ success: boolean; message?: string }>('calendar/update', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to update.'); return; }
      toast.success('Saved.'); invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useTaskStatus() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (req: { id: string; status: CalendarTaskStatus; scope?: RecurrenceScope; occurrenceDate?: string }) =>
      apiPost<{ success: boolean; message?: string }>('calendar/task/status', req as unknown as Record<string, unknown>),
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to update task.'); return; }
      invalidate();
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
      toast.success('Cancelled.'); invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}
