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

/**
 * Seed the compliance-toast watermark for the current user, ONCE per session, from
 * the SERVER's current notification set (an id cursor). Everything fetched is
 * historical and must never surface as a realtime toast. No browser-vs-server time
 * comparison. Returns true when the watermark is seeded (or already was); false on a
 * fetch failure so the caller can retry on the next signal. Idempotent per user.
 */
async function seedComplianceWatermark(): Promise<boolean> {
  const [{ getMyNotifications }, { needsWatermarkSeed, seedComplianceToastWatermark }, { useSessionStore }] =
    await Promise.all([
      import('@api/notifications'),
      import('@components/realtime/complianceToasts'),
      import('@store/session'),
    ]);
  const userId = useSessionStore.getState().userId;
  if (!userId) return false;
  if (!needsWatermarkSeed(userId)) return true;   // already seeded this session
  let rows;
  try { rows = await getMyNotifications(userId); }
  catch { return false; }                          // retry on the next signal
  seedComplianceToastWatermark(userId, rows);
  return true;
}

/**
 * Drive the compliance-access rich toast off the WORKING communication_signals
 * (domain='notifications') signal — the `notifications` table is NOT in the realtime
 * publication, so its own subscription never fires. Fetch recent notifications and
 * hand them to surfaceComplianceToasts, which skips the mount watermark + already-
 * surfaced ids and fires each new compliance one DIRECTLY (no burst coalescing).
 */
async function surfaceComplianceFromNotifications(): Promise<void> {
  const [{ getMyNotifications }, { surfaceComplianceToasts }, { useSessionStore }] = await Promise.all([
    import('@api/notifications'),
    import('@components/realtime/complianceToasts'),
    import('@store/session'),
  ]);
  const userId = useSessionStore.getState().userId;
  if (!userId) return;
  let rows;
  try { rows = await getMyNotifications(userId); } catch { return; }
  surfaceComplianceToasts(rows);
}

export function useRealtimeSignals(channelKey: string | null, realtimeToken: string | null = null): void {
  const qc           = useQueryClient();
  const clientRef    = useRef<SupabaseClient | null>(null);
  const channelRef   = useRef<SupabaseChannel | null>(null);
  const tokenRef     = useRef<string | null>(realtimeToken);

  // Token rotation: keep the ref in sync and re-authorize the LIVE connection
  // without resubscribing (the summary poll re-mints the token; churning the
  // channel would drop signal delivery windows). Ref writes live in the effect,
  // never during render. Channel lifecycle stays keyed on channelKey.
  useEffect(() => {
    tokenRef.current = realtimeToken;
    if (realtimeToken && clientRef.current) {
      (clientRef.current as unknown as { realtime: { setAuth(t: string): void } }).realtime.setAuth(realtimeToken);
    }
  }, [realtimeToken]);

  // Window-focus fallback: on returning to the tab, re-pull the permission
  // snapshot (throttled) so a grant approved/revoked while the tab was
  // backgrounded reflects promptly even if the realtime signal was missed.
  useEffect(() => {
    let last = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - last < 15_000) return;
      last = now;
      void import('@lib/auth').then(m => m.refreshPermissionOverrides());
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    if (!channelKey) return;
    // `window.supabase` is typed as always-present, but this guard defends at
    // runtime against the Supabase UMD not having loaded yet (a real SPA race).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof window === 'undefined' || !window.supabase) return;

    // Compliance-toast init state machine (per subscription). We ESTABLISH the
    // subscription first and only seed the historical watermark AFTER it is
    // confirmed (SUBSCRIBED). Any notification signal that arrives before the
    // watermark is seeded is QUEUED (not toasted — it might be historical) and
    // DRAINED once seeding completes. This closes both the clock-skew misclassify
    // and the fetch-vs-subscribe gap.
    let disposed = false;
    let ready   = false;   // watermark seeded → safe to surface toasts
    let seeding = false;   // a seed attempt is in flight (avoid concurrent fetches)
    let pending = false;   // a notification signal arrived while not ready

    const attemptSeedAndDrain = async (): Promise<void> => {
      if (ready || seeding) return;
      seeding = true;
      const ok = await seedComplianceWatermark();
      seeding = false;
      if (disposed || !ok) return;   // seed failed → retry on the next signal
      ready = true;
      if (pending) { pending = false; void surfaceComplianceFromNotifications(); }
    };

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
            // The notifications table isn't published for realtime, so this working
            // signal is where the compliance toast fires. Only surface once the
            // watermark is seeded; otherwise queue (and kick a seed) so a historical
            // row can never toast during initialization.
            if (ready) void surfaceComplianceFromNotifications();
            else { pending = true; void attemptSeedAndDrain(); }
          } else if (domain === 'messages') {
            void qc.invalidateQueries({ queryKey: messageKeys.all });
            emitMessagesSignal();   // Messenger workspace refetch bridge (no-op when unmounted)
          } else if (domain === 'tickets') {
            void qc.invalidateQueries({ queryKey: ticketKeys.all });
          } else if (domain === 'permissions') {
            // A grant for THIS user changed (approved/revoked/set/cleared). Re-pull
            // the permission snapshot so can()/useCan() reflect it live — the
            // cross-session propagation path, since maker-checker means the approver
            // is never the affected user. NO toast here: the user-facing compliance
            // toast comes from the notification stream (single source) to avoid a
            // duplicate; this signal is snapshot-refresh only.
            void import('@lib/auth').then(m => m.refreshPermissionOverrides());
          }
        },
      )
      .subscribe((status: unknown) => {
        // Seed the watermark only AFTER the subscription is confirmed, so anything
        // created after this boundary arrives via the channel (queued → drained)
        // instead of racing the seed fetch.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        if (String(status) === 'SUBSCRIBED') void attemptSeedAndDrain();
      });

    channelRef.current = channel;

    return () => {
      disposed = true;
      if (channelRef.current && clientRef.current) {
        void clientRef.current.removeChannel(channelRef.current);
        channelRef.current = null;
        clientRef.current  = null;
      }
    };
  }, [channelKey, qc]);
}
