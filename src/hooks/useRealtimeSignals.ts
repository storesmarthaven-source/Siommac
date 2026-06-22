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
 * Usage: mount once in AppShell after login, passing the channelKey from
 * useCommunicationSummary().
 */

import { useEffect, useRef } from 'preact/hooks';
import { useQueryClient }     from '@tanstack/preact-query';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@cfg';
import { communicationKeys }  from '@api/queryKeys';

type SupabaseClient  = ReturnType<typeof window.supabase.createClient>;
type SupabaseChannel = ReturnType<SupabaseClient['channel']>;

export function useRealtimeSignals(channelKey: string | null): void {
  const qc           = useQueryClient();
  const clientRef    = useRef<SupabaseClient | null>(null);
  const channelRef   = useRef<SupabaseChannel | null>(null);

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
        () => {
          // Signal has no payload — just invalidate so summary refetches
          void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
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
