/**
 * src/components/realtime/RealtimeController.ts
 *
 * Supabase Realtime subscription — ported from assets/js/realtime.js.
 *
 * Subscribes to postgres_changes on messages, message_replies, message_reads,
 * support_tickets, ticket_replies, leave_requests, and attendance.
 *
 * On any change it immediately calls the relevant window._ data-fetch shims
 * (set by NavController's panel mounts) and schedules a header-badge sync.
 *
 * Auto-reconnects on error with exponential back-off capped at 60 s.
 *
 * Usage:
 *   import { initRealtime, teardownRealtime } from './RealtimeController';
 *   initRealtime();    // call after login (applySession)
 *   teardownRealtime();// call on logout
 *
 * The module also sets window._initRealtime / window._teardownRealtime so
 * app.js can continue to call them unchanged during the transition period.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { env }                    from '@lib/env';
import { scheduleHdrBadgeSync }   from '@components/nav';
import { applyBrandingPush }      from './BrandingRealtimeBridge';

// ── Supabase client type (loaded via CDN — window.supabase) ──────────────────

interface SupabaseClient {
  channel(name: string, opts?: object): SupabaseChannel;
  removeAllChannels(): void;
}

interface SupabaseChannel {
  on(
    type: string,
    filter: { event: string; schema: string; table: string },
    cb: () => void,
  ): SupabaseChannel;
  subscribe(cb: (status: string, err?: unknown) => void): SupabaseChannel;
}

interface SupabaseStatic {
  createClient(url: string, key: string, opts?: object): SupabaseClient;
}

function supabaseLib(): SupabaseStatic | null {
  return (window as unknown as { supabase?: SupabaseStatic }).supabase ?? null;
}

// ── Internal state ────────────────────────────────────────────────────────────

let _client:     SupabaseClient | null = null;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _retryDelay  = 5_000;   // ms — doubles on each failure, caps at 60 s
const MAX_DELAY  = 60_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getToken(): string | null {
  try {
    const raw = localStorage.getItem('siomac_session_v1');
    return raw ? ((JSON.parse(raw) as { token?: string }).token ?? null) : null;
  } catch { return null; }
}

function callWin(name: string): void {
  const fn = (window as unknown as Record<string, unknown>)[name];
  if (typeof fn === 'function') (fn as () => void)();
}

// ── Core ──────────────────────────────────────────────────────────────────────

function scheduleRetry(): void {
  if (_retryTimer) clearTimeout(_retryTimer);
  _retryTimer = setTimeout(() => {
    if (getToken()) initRealtime();
  }, _retryDelay);
  _retryDelay = Math.min(_retryDelay * 2, MAX_DELAY);
}

export function teardownRealtime(): void {
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  if (_client) {
    try { _client.removeAllChannels(); } catch { /* ignore */ }
    _client = null;
  }
  _retryDelay = 5_000; // reset back-off for next login
}

export function initRealtime(): void {
  const lib = supabaseLib();
  if (!lib) {
    console.warn('[Realtime] Supabase JS client not loaded — poll fallback active.');
    return;
  }

  teardownRealtime(); // tear down any existing subscription before re-connecting

  _client = lib.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth:     { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  _client
    .channel('siomac-live', { config: { broadcast: { self: false } } })

    // Messages now flow through the canonical communications backbone: the
    // backend emits communication_signals and useRealtimeSignals refreshes the
    // message badge + lists. The legacy messages/message_replies/message_reads
    // table subscriptions were retired with routes/messages.ts.

    // ── support tickets ───────────────────────────────────────────────────────
    // ── ticket replies ────────────────────────────────────────────────────────
    // ── leave requests (drives notification + pending-leave badge) ────────────
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
      scheduleHdrBadgeSync();
    })

    // ── attendance (live map + project site cards + badge) ────────────────────
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
      scheduleHdrBadgeSync();
      // loadLiveAttendance re-renders project site cards if the data hash changed
      const liveMap = (window as unknown as { LiveMap?: { loadLiveAttendance?: () => void } }).LiveMap;
      liveMap?.loadLiveAttendance?.();
    })

    // ── settings (branding live push) ─────────────────────────────────────────
    // Delegated to BrandingRealtimeBridge — branding is its own concern, it just
    // rides this shared channel.
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'settings' }, () => {
      applyBrandingPush();
    })

    .subscribe((status: string, err?: unknown) => {
      if (status === 'SUBSCRIBED') {
        console.warn('[Realtime] Connected — instant updates active.');
        _retryDelay = 5_000; // reset back-off on success
      } else if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT'     ||
        status === 'CLOSED'
      ) {
        console.warn(
          // eslint-disable-next-line @typescript-eslint/no-base-to-string -- err is unknown from Supabase; String() is acceptable for logging
          `[Realtime] ${status}${err ? ': ' + (err instanceof Error ? err.message : String(err)) : ''} — retrying in ${_retryDelay / 1000}s. Poll fallback active.`,
        );
        scheduleRetry();
      }
    });
}

// ── Register on window so app.js can call unchanged ──────────────────────────

(window as unknown as Record<string, unknown>)._initRealtime     = initRealtime;
(window as unknown as Record<string, unknown>)._teardownRealtime = teardownRealtime;
