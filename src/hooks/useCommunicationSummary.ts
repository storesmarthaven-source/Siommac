/**
 * src/hooks/useCommunicationSummary.ts
 *
 * Convenience wrapper around useCommsSummary that exposes individual badge
 * counts and the realtime channel key. Consumed by badge-sync logic and
 * any component that needs header counts without importing the full
 * communications API module.
 */

import { useCommsSummary } from '@api/communications';

export interface CommunicationCounts {
  notificationsUnread: number;
  messagesUnread:      number;
  ticketsOpen:         number;
  workflowTasks:       number;
  handoffFailures:     number;
  /** Realtime channel key — pass to useRealtimeSignals */
  channelKey:          string | null;
  isLoading:           boolean;
}

export function useCommunicationSummary(): CommunicationCounts {
  const q = useCommsSummary();
  const d = q.data;

  return {
    notificationsUnread: d?.notificationsUnread ?? 0,
    messagesUnread:      d?.messagesUnread      ?? 0,
    ticketsOpen:         d?.ticketsOpen         ?? 0,
    workflowTasks:       d?.workflowTasks        ?? 0,
    handoffFailures:     d?.handoffFailures      ?? 0,
    channelKey:          d?.realtimeChannelKey   ?? null,
    isLoading:           q.isLoading,
  };
}
