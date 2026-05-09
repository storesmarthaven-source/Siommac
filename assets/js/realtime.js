// ─── Supabase Realtime ───────────────────────────────────────────────────────
// Subscribes to postgres_changes on messages, support_tickets, ticket_replies.
// When a change arrives the badge sync fires immediately — no polling needed.
// Falls back silently if Realtime is unavailable.

(function () {
  const SUPABASE_URL      = 'https://gaflqcwcrvnusnlghwej.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_-Rp8vH10OaIHKitdWgbgRQ__jK2i5Qp';

  let _realtimeClient = null;

  function _initRealtime() {
    if (!window.supabase) {
      console.warn('[Realtime] Supabase JS client not loaded.');
      return;
    }

    // Tear down any previous subscription
    if (_realtimeClient) {
      try { _realtimeClient.removeAllChannels(); } catch (_) {}
      _realtimeClient = null;
    }

    // Get the app's JWT so Supabase Realtime can authenticate past RLS
    const token = (function () {
      try {
        const raw = localStorage.getItem('siomac_session_v1');
        return raw ? (JSON.parse(raw).token || null) : null;
      } catch (_) { return null; }
    })();

    _realtimeClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      },
      realtime: { params: { eventsPerSecond: 10 } }
    });

    // If we have a token, set it as the Supabase session so RLS is satisfied
    if (token) {
      _realtimeClient.realtime.setAuth(token);
    }

    _realtimeClient
      .channel('siomac-realtime')

      // New message sent
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages'
      }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchMsgs     === 'function') window._fetchMsgs();
      })

      // Message read/updated
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages'
      }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
      })

      // New or updated ticket
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'support_tickets'
      }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchTickets  === 'function') window._fetchTickets();
      })

      // New ticket reply
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'ticket_replies'
      }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchTickets  === 'function') window._fetchTickets();
      })

      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected — instant updates active.');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] Subscription issue:', status, '— 30s poll fallback active.');
        }
      });
  }

  function _teardown() {
    if (_realtimeClient) {
      try { _realtimeClient.removeAllChannels(); } catch (_) {}
      _realtimeClient = null;
    }
  }

  window._initRealtime     = _initRealtime;
  window._teardownRealtime = _teardown;
})();
