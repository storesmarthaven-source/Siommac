// ─── Supabase Realtime ───────────────────────────────────────────────────────
// Subscribes to postgres_changes on messages, message_replies,
// support_tickets, ticket_replies, and notifications.
// Requirements: tables must be added to the supabase_realtime publication:
//   alter publication supabase_realtime add table messages;
//   alter publication supabase_realtime add table message_replies;
//   alter publication supabase_realtime add table support_tickets;
//   alter publication supabase_realtime add table ticket_replies;
//   alter publication supabase_realtime add table leave_requests;
//   alter publication supabase_realtime add table attendance;
// When a change arrives the badge sync + data fetch fires immediately.
// Auto-reconnects on error with exponential back-off (max 60s).

(function () {
  const SUPABASE_URL      = 'https://gaflqcwcrvnusnlghwej.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_-Rp8vH10OaIHKitdWgbgRQ__jK2i5Qp';

  let _client      = null;
  let _retryTimer  = null;
  let _retryDelay  = 5000;   // start at 5s, doubles on each failure, caps at 60s
  const MAX_DELAY  = 60000;

  function _getToken() {
    try {
      const raw = localStorage.getItem('siomac_session_v1');
      return raw ? (JSON.parse(raw).token || null) : null;
    } catch (_) { return null; }
  }

  function _initRealtime() {
    if (!window.supabase) {
      console.warn('[Realtime] Supabase JS client not loaded — poll fallback active.');
      return;
    }

    // Tear down any existing client + pending retry
    _teardown();

    const token = _getToken();

    _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth:     { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
      global:   { headers: token ? { Authorization: 'Bearer ' + token } : {} }
    });

    // Pass our custom JWT so postgres_changes can satisfy RLS
    if (token) _client.realtime.setAuth(token);

    _client
      .channel('siomac-live', { config: { broadcast: { self: false } } })

      // ── messages ─────────────────────────────────────────────────────────
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchMsgs     === 'function') window._fetchMsgs();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchMsgs     === 'function') window._fetchMsgs();
      })

      // ── message replies ───────────────────────────────────────────────────
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_replies' }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchMsgs     === 'function') window._fetchMsgs();
      })

      // ── support tickets ───────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchTickets  === 'function') window._fetchTickets();
      })

      // ── ticket replies ────────────────────────────────────────────────────
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_replies' }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
        if (typeof window._fetchTickets  === 'function') window._fetchTickets();
      })

      // ── leave requests (drives notification badge) ────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
      })

      // ── attendance (drives check-in count badge) ──────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
        if (typeof _scheduleHdrBadgeSync === 'function') _scheduleHdrBadgeSync();
      })

      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected — instant updates active.');
          _retryDelay = 5000; // reset back-off on success
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Tables not yet in publication, network blip, or auth issue —
          // poll fallback is already running; retry realtime after back-off
          console.warn(`[Realtime] ${status} — retrying in ${_retryDelay / 1000}s. Poll fallback active.`);
          _scheduleRetry();
        }
      });
  }

  function _scheduleRetry() {
    clearTimeout(_retryTimer);
    _retryTimer = setTimeout(() => {
      // Only retry if still logged in
      if (_getToken()) _initRealtime();
    }, _retryDelay);
    _retryDelay = Math.min(_retryDelay * 2, MAX_DELAY);
  }

  function _teardown() {
    clearTimeout(_retryTimer);
    if (_client) {
      try { _client.removeAllChannels(); } catch (_) {}
      _client = null;
    }
    _retryDelay = 5000; // reset for next login
  }

  window._initRealtime     = _initRealtime;
  window._teardownRealtime = _teardown;
})();
