/**
 * src/hooks/useRealtimeSignals.ts
 *
 * Subscribes to the `communication_signals` table in Supabase Realtime,
 * filtered by the session's channel_key. On any INSERT, invalidates the
 * communications summary so badge counts refresh immediately.
 *
 * The signal rows have no business payload — they are safe to expose to
 * Realtime because they carry only (channel_key, domain, created_at).
 * Business data always comes through the authenticated /api/* endpoints.
 *
 * On each signal it also schedules a header-badge sync, so the imperative
 * `[data-pill-badge]` counts refresh in realtime through this canonical path
 * (notifications/messages/tickets) rather than waiting for the 30 s poll. This
 * is what the legacy RealtimeController did via per-table subscriptions; routing
 * it through communication_signals lets that controller eventually retire.
 *
 * Usage: mount once in AppShell after login, passing the channelKey from
 * useCommunicationSummary().
 */

import { useEffect, useRef } from 'preact/hooks';
import { useQueryClient }     from '@tanstack/preact-query';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@cfg';
import { communicationKeys, notificationKeys, messageKeys, ticketKeys } from '@api/queryKeys';
import { scheduleHdrBadgeSync } from '@components/nav';
import { emitMessagesSignal } from '@components/sections/Messages/messenger/integration/messengerSignalBus';

type SupabaseClient  = ReturnType<typeof window.supabase.createClient>;
type SupabaseChannel = ReturnType<SupabaseClient['channel']>;

export function useRealtimeSignals(channelKey: string | null, realtimeToken: string | null = null): void {
  const qc           = useQueryClient();
  const clientRef    = useRef<SupabaseClient | null>(null);
  const channelRef   = useRef<SupabaseChannel | null>(null);
  const tokenRef     = useRef<string | null>(realtimeToken);
  tokenRef.current   = realtimeToken;

  // Token rotation: re-authorize the LIVE connection without resubscribing
  // (the summary poll re-mints the token; churning the channel would drop
  // signal delivery windows). Channel lifecycle stays keyed on channelKey.
  useEffect(() => {
    if (realtimeToken && clientRef.current) {
      (clientRef.current as unknown as { realtime: { setAuth(t: string): void } }).realtime.setAuth(realtimeToken);
    }
  }, [realtimeToken]);

  useEffect(() => {
    if (!channelKey) return;
    if (typeof window === 'undefined' || !window.supabase) return;

    // Tear down any existing subscription
    if (channelRef.current && clientRef.current) {
      void clientRef.current.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth:     { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    clientRef.current = client as unknown as SupabaseClient;

    // Authenticated realtime (finding #5): present the server-issued JWT so
    // the communication_signals RLS (mig 351) authorizes this connection.
    // Without a token (server env not configured yet) the connection stays
    // anonymous — which only works until the RLS migration is applied.
    if (tokenRef.current) {
      (client as unknown as { realtime: { setAuth(t: string): void } }).realtime.setAuth(tokenRef.current);
    }

    const channel = client
      .channel(`comms-signals-${channelKey}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'communication_signals',
          filter: `channel_key=eq.${channelKey}`,
        },
        (payload: { new?: { domain?: string } }) => {
          // Refresh the imperative header pill badges through the canonical path.
          scheduleHdrBadgeSync();
          // Summary (badge counts) always refreshes; the domain routes the rest.
          void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
          const domain = payload.new?.domain;
          if (domain === 'notifications') {
            void qc.invalidateQueries({ queryKey: notificationKeys.all });
          } else if (domain === 'messages') {
            void qc.invalidateQueries({ queryKey: messageKeys.all });
            emitMessagesSignal();   // Messenger workspace refetch bridge (no-op when unmounted)
          } else if (domain === 'tickets') {
            void qc.invalidateQueries({ queryKey: ticketKeys.all });
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current && clientRef.current) {
        void clientRef.current.removeChannel(channelRef.current);
        channelRef.current = null;
        clientRef.current  = null;
      }
    };
  }, [channelKey, qc]);
}
