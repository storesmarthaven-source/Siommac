// ─── Supabase Realtime ───────────────────────────────────────────────────────
// Subscribes to postgres_changes on notifications, messages, and support_tickets.
// When a change arrives the badge sync fires immediately — no polling needed.
// Falls back silently if Realtime is unavailable (e.g. tables not yet enabled).

(function () {
  const SUPABASE_URL     = 'https://gaflqcwcrvnusnlghwej.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_-Rp8vH10OaIHKitdWgbgRQ__jK2i5Qp';

  let _realtimeClient = null;
  let _channel        = null;

  function _initRealtime(userId) {
    if (!window.supabase) {
      console.warn('[Realtime] Supabase JS client not loaded — skipping realtime.');
      return;
    }

    // Tear down any previous subscription (e.g. user switching accounts)
    if (_realtimeClient) {
      try { _realtimeClient.removeAllChannels(); } catch (_) {}
    }

    _realtimeClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } }
    });

    // Single channel — listens to INSERT/UPDATE on all three tables.
    // On any event we fire _scheduleHdrBadgeSync() which calls getHeaderCounts
    // (one lightweight combined query) and updates all badges simultaneously.
    _channel = _realtimeClient
      .channel('siomac-realtime')

      // New notification for this user
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications'
      }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchNotifs   === 'function') window._fetchNotifs();
      })

      // New message (to or from this user)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages'
      }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchMsgs     === 'function') window._fetchMsgs();
      })

      // Message marked as read
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages'
      }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
      })

      // New ticket or ticket updated (status change, reply, etc.)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'support_tickets'
      }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchTickets  === 'function') window._fetchTickets();
      })

      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected — instant badge updates active.');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] Subscription issue:', status, '— polling fallback still active.');
        }
      });
  }

  function _teardown() {
    if (_realtimeClient) {
      try { _realtimeClient.removeAllChannels(); } catch (_) {}
      _realtimeClient = null;
      _channel        = null;
    }
  }

  // Expose so app.js can call after login/logout
  window._initRealtime  = _initRealtime;
  window._teardownRealtime = _teardown;
})();
