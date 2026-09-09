/**
 * Authenticated Meetings API hooks.
 *
 * Calendar owns schedule/RSVP data and Communications owns discussion posts;
 * this client invalidates those shared query families whenever a meeting
 * mutation can change their projections.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryFunctionContext,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { useSessionStore } from '@store/session';
import { toast } from '@store/ui';
import type {
  MeetingArchiveRequest,
  MeetingArchiveResponse,
  MeetingCancelRequest,
  MeetingCancelResponse,
  MeetingCreateRequest,
  MeetingCreateResponse,
  MeetingGetResponse,
  MeetingDetailDTO,
  MeetingCursorPage,
  MeetingListItemDTO,
  MeetingAgendaUpdateRequest,
  MeetingAgendaUpdateResponse,
  MeetingParticipantsInviteRequest,
  MeetingParticipantsRemoveRequest,
  MeetingParticipantsResponse,
  MeetingRsvpRequest,
  MeetingRsvpResponse,
  MeetingSessionCommandResponse,
  MeetingSessionEndRequest,
  MeetingSessionStartRequest,
  MeetingUpdateRequest,
  MeetingUpdateResponse,
  MeetingsListRequest,
  MeetingsListResponse,
} from '../../types/meetings';

export type * from '../../types/meetings';

export const meetingKeys = {
  all: ['meetings'] as const,
  list: (request: MeetingsListRequest) => [...meetingKeys.all, 'list', request] as const,
  detail: (meetingId: string, occurrenceKey?: string) => [...meetingKeys.all, 'detail', meetingId, occurrenceKey ?? ''] as const,
};

function unwrap<T>(response: { success: boolean; data?: T; message?: string }, fallback: string): T {
  if (!response.success || response.data === undefined) throw new Error(response.message ?? fallback);
  return response.data;
}

function useMeetingInvalidation(): () => Promise<void> {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: meetingKeys.all }),
      client.invalidateQueries({ queryKey: ['calendar'] }),
      client.invalidateQueries({ queryKey: ['communications'] }),
    ]);
  };
}

export function useMeetingsList(request: MeetingsListRequest, enabled = true): UseQueryResult<MeetingCursorPage<MeetingListItemDTO>> {
  const authenticated = useSessionStore(state => state.isAuthenticated);
  return useQuery({
    queryKey: meetingKeys.list(request),
    enabled: enabled && authenticated,
    placeholderData: previous => previous,
    queryFn: async ({ signal }: QueryFunctionContext) => unwrap(
      await apiPost<MeetingsListResponse>('meetings/list', request as Record<string, unknown>, { signal }),
      'Failed to load meetings.',
    ),
  });
}

export function useMeeting(meetingId: string | null, occurrenceKey?: string): UseQueryResult<MeetingDetailDTO> {
  const authenticated = useSessionStore(state => state.isAuthenticated);
  return useQuery({
    queryKey: meetingKeys.detail(meetingId ?? '', occurrenceKey),
    enabled: authenticated && Boolean(meetingId),
    queryFn: async ({ signal }: QueryFunctionContext) => unwrap(
      await apiPost<MeetingGetResponse>('meetings/get', { meetingId, occurrenceKey }, { signal }),
      'Failed to load the meeting.',
    ),
  });
}

function useMeetingCommand<TRequest, TResponse extends { success: boolean; data?: unknown; message?: string }>(
  route: string,
  successMessage: string,
): UseMutationResult<TResponse, Error, TRequest> {
  const invalidate = useMeetingInvalidation();
  return useMutation({
    mutationFn: (request: TRequest) => apiPost<TResponse>(route, request as Record<string, unknown>),
    onSuccess: async response => {
      if (!response.success) { toast.error(response.message ?? 'The meeting could not be updated.'); return; }
      toast.success(successMessage);
      await invalidate();
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useCreateMeeting(): UseMutationResult<MeetingCreateResponse, Error, MeetingCreateRequest> { return useMeetingCommand<MeetingCreateRequest, MeetingCreateResponse>('meetings/create', 'Meeting scheduled.'); }
export function useUpdateMeeting(): UseMutationResult<MeetingUpdateResponse, Error, MeetingUpdateRequest> { return useMeetingCommand<MeetingUpdateRequest, MeetingUpdateResponse>('meetings/update', 'Meeting updated.'); }
export function useUpdateMeetingAgenda(): UseMutationResult<MeetingAgendaUpdateResponse, Error, MeetingAgendaUpdateRequest> { return useMeetingCommand<MeetingAgendaUpdateRequest, MeetingAgendaUpdateResponse>('meetings/agenda/update', 'Meeting agenda updated.'); }
export function useCancelMeeting(): UseMutationResult<MeetingCancelResponse, Error, MeetingCancelRequest> { return useMeetingCommand<MeetingCancelRequest, MeetingCancelResponse>('meetings/cancel', 'Meeting cancelled.'); }
export function useArchiveMeeting(): UseMutationResult<MeetingArchiveResponse, Error, MeetingArchiveRequest> { return useMeetingCommand<MeetingArchiveRequest, MeetingArchiveResponse>('meetings/archive', 'Meeting archived.'); }
export function useInviteMeetingParticipants(): UseMutationResult<MeetingParticipantsResponse, Error, MeetingParticipantsInviteRequest> { return useMeetingCommand<MeetingParticipantsInviteRequest, MeetingParticipantsResponse>('meetings/participants/invite', 'Participants invited.'); }
export function useRemoveMeetingParticipant(): UseMutationResult<MeetingParticipantsResponse, Error, MeetingParticipantsRemoveRequest> { return useMeetingCommand<MeetingParticipantsRemoveRequest, MeetingParticipantsResponse>('meetings/participants/remove', 'Participant removed.'); }
export function useMeetingRsvp(): UseMutationResult<MeetingRsvpResponse, Error, MeetingRsvpRequest> { return useMeetingCommand<MeetingRsvpRequest, MeetingRsvpResponse>('meetings/rsvp', 'Response saved.'); }
export function useStartMeetingSession(): UseMutationResult<MeetingSessionCommandResponse, Error, MeetingSessionStartRequest> { return useMeetingCommand<MeetingSessionStartRequest, MeetingSessionCommandResponse>('meetings/sessions/start', 'Meeting started.'); }
export function useEndMeetingSession(): UseMutationResult<MeetingSessionCommandResponse, Error, MeetingSessionEndRequest> { return useMeetingCommand<MeetingSessionEndRequest, MeetingSessionCommandResponse>('meetings/sessions/end', 'Meeting ended.'); }
