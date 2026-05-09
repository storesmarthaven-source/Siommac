// ─── Backend API ──────────────────────────────────────────
const API = '/api';

// text/plain content-type avoids CORS preflight that Apps Script can't answer
function getSessionToken() {
  try {
    const raw = localStorage.getItem('siomac_session_v1');
    return raw ? (JSON.parse(raw).token || '') : '';
  } catch (_) {
    return '';
  }
}

// AJAX loading bar disabled — background syncs are silent
window._ajaxLoaderStart = function () {};
window._ajaxLoaderDone  = function () {};

function _rawApi(action, args) {
  args = args || {};
  // 1) sanity-check the API URL before firing
  if (!API || /PASTE_YOUR_EXEC_URL_HERE/i.test(API)) {
    return Promise.resolve({ success: false, message: 'API URL not set.' });
  }

  _ajaxLoaderStart();

  return new Promise(function (resolve) {
    $.ajax({
      url:         API,
      method:      'POST',
      contentType: 'text/plain;charset=utf-8',
      data:        JSON.stringify({ action: action, args: args, token: getSessionToken() }),
      dataType:    'text',
      success: function (text) {
        _ajaxLoaderDone();
        try {
          const parsed = JSON.parse(text);
          // Token expired or invalid — trigger auto-logout with a clear message
          if (parsed && parsed.success === false && parsed.message === 'Unauthorized') {
            if (typeof handleSessionExpired === 'function') {
              handleSessionExpired();
            }
          }
          resolve(parsed);
        } catch (e) {
          console.error('api parse fail', action, String(text).slice(0, 200));
          const isHtml = /^\s*</.test(text);
          if (isHtml) {
            resolve({ success: false, message: 'Server returned HTML instead of JSON. Check API deployment settings.' });
          } else {
            resolve({ success: false, message: 'Server returned non-JSON: ' + String(text).slice(0, 140) });
          }
        }
      },
      error: function (xhr, status, err) {
        _ajaxLoaderDone();
        console.error('api ajax fail', action, status, err);
        resolve({ success: false, message: 'Network error: ' + (err || status || 'unreachable') });
      }
    });
  });
}

// Quick connection check — call from the browser console: pingApi()
function pingApi() {
  return _rawApi('ping', {}).then(function (out) {
    console.log('pingApi →', out);
    return out;
  });
}
window.pingApi = pingApi;

// ─── SWR-style cache (stale-while-revalidate) ────────────────
// Read calls hit cache first, return instantly if fresh; if stale, serve stale + revalidate.
// Mutations bust the cache. In-flight requests are deduped. Optional revalidate-on-focus.
const swr = (function () {
  const cache    = new Map();  // key → { data, ts }
  const inflight = new Map();  // key → Promise
  const subs     = new Map();  // key → Set<callback>
  const DEFAULT_TTL = 60 * 1000;

  function get(key)            { return cache.get(key); }
  function set(key, data)      { cache.set(key, { data, ts: Date.now() }); fire(key, data); }
  function clear(key)          { if (key == null) cache.clear(); else cache.delete(key); }
  function clearByPrefix(pfx)  { for (const k of cache.keys()) if (k.indexOf(pfx) === 0) cache.delete(k); }
  function on(key, cb)         { if (!subs.has(key)) subs.set(key, new Set()); subs.get(key).add(cb); return () => subs.get(key) && subs.get(key).delete(cb); }
  function fire(key, data)     { if (subs.has(key)) subs.get(key).forEach(cb => { try { cb(data); } catch (_) {} }); }

  // SWR core: emit cache (if any) immediately, then fetch + emit fresh
  function fetch(key, fetcher, opts) {
    opts = opts || {};
    const ttl   = opts.ttl != null ? opts.ttl : DEFAULT_TTL;
    const force = !!opts.force;
    const cached = cache.get(key);
    const isFresh = cached && (Date.now() - cached.ts) < ttl;

    // 1) deliver cached synchronously-via-microtask if available
    if (cached && opts.onData) {
      Promise.resolve().then(() => { try { opts.onData(cached.data, /*isStale*/ !isFresh, /*fromCache*/ true); } catch (_) {} });
    }
    // fresh + not forced → no revalidation
    if (cached && isFresh && !force) return Promise.resolve(cached.data);

    // 2) dedupe in-flight
    if (inflight.has(key)) {
      const p = inflight.get(key);
      if (opts.onData) p.then(d => { try { opts.onData(d, false, false); } catch (_) {} });
      return p;
    }

    // 3) fetch + emit
    const p = fetcher().then(data => {
      cache.set(key, { data, ts: Date.now() });
      inflight.delete(key);
      if (opts.onData) { try { opts.onData(data, false, false); } catch (_) {} }
      fire(key, data);
      return data;
    }).catch(err => {
      inflight.delete(key);
      if (opts.onError) { try { opts.onError(err); } catch (_) {} }
      throw err;
    });
    inflight.set(key, p);
    return p;
  }

  // mutate(): write to cache directly (e.g. optimistic UI)
  function mutate(key, dataOrFetcher, revalidate) {
    if (typeof dataOrFetcher === 'function') return fetch(key, dataOrFetcher, { force: true });
    if (dataOrFetcher === undefined) return clear(key);
    cache.set(key, { data: dataOrFetcher, ts: Date.now() });
    fire(key, dataOrFetcher);
    if (revalidate) clear(key); // force refetch on next read
  }

  // revalidate-on-focus: when user returns to the tab, refetch any subscribed keys
  let _focusInstalled = false;
  function focusRevalidate(enable) {
    if (enable && !_focusInstalled) {
      _focusInstalled = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        // bump ttl by clearing — next fetch will refetch
        // (only keys with active subscribers are worth revalidating; skip the rest)
        subs.forEach((set, key) => { if (set.size) cache.delete(key); });
      });
    }
  }

  return { get, set, clear, clearByPrefix, on, fetch, mutate, focusRevalidate, _cache: cache, _inflight: inflight };
})();

// last-served hash per key — skip re-render when fresh data == cached data (avoids flicker)
const _swrLastHash = new Map();

// SWR-aware api wrapper: cache + dedupe + emit to onData callback
function apiSwr(action, args, opts) {
  opts = opts || {};
  const key = opts.key || (action + ':' + JSON.stringify(args || {}));
  return swr.fetch(key, () => _rawApi(action, args), {
    ttl:   opts.ttl,
    force: opts.force,
    onData: function (data, isStale, fromCache) {
      // skip render if same payload as last delivered
      const hash = JSON.stringify(data);
      if (_swrLastHash.get(key) === hash) return;
      _swrLastHash.set(key, hash);
      if (opts.onData) opts.onData(data, isStale, fromCache);
    },
    onError: opts.onError
  });
}

// Mutations that should bust the read cache. Match by action prefix or exact name.
const SWR_MUTATIONS = /^(add|update|delete|bulk|upload|approve|reject|submit|setup|login|logout)/i;

// Wrap api() so successful mutations auto-invalidate the entire SWR cache.
// Reads (list*, get*) pass through unchanged.
function api(action, args) {
  args = args || {};
  return _rawApi(action, args).then(function (result) {
    if (result && result.success && SWR_MUTATIONS.test(action)) {
      swr.clear();
      _swrLastHash.clear();
    }
    return result;
  });
}

swr.focusRevalidate(true); // re-pull data when user returns to tab

// ─── Frontend image URL cache ─────────────────────────────────────────────────
// Signed URLs for the same storage path are stable for ~55 min (server caches them).
// This map ensures <img> src is never swapped to an identical URL, preventing
// any browser re-fetch or flash even across rapid _rawApi calls.
// Usage: setImgSrc(imgElement, url)  — only updates src if url actually changed.
window.setImgSrc = function (img, url) {
  if (img && img.src !== url) img.src = url;
};

// Explicit "Refresh" buttons must bypass cache. Capture-phase wipes cache before
// the existing bubble-phase loaders run, so they always see a miss.
document.addEventListener('click', function (e) {
  const btn = e.target.closest && e.target.closest('[id^="refresh"]');
  if (btn) { swr.clear(); _swrLastHash.clear(); }
}, true);
