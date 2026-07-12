/**
 * src/lib/apiLegacy.ts
 *
 * Backend API + SWR cache layer — ported from assets/js/api.js.
 *
 * Replaces jQuery $.ajax with native fetch (same content-type:text/plain to
 * avoid CORS preflight), keeps the identical SWR interface, and registers the
 * same globals so app.js and any remaining callers work unchanged:
 *
 *   window.api(action, args)               → Promise<ApiResult>
 *   window.apiSwr(action, args, opts)      → Promise<ApiResult>
 *   window.swr                             → SWR cache object
 *   window._swrLastHash                    → Map<string,string>
 *   window.pingApi()                       → Promise<ApiResult>
 *   window.setImgSrc(img, url)             → void
 *   window._ajaxLoaderStart / _ajaxLoaderDone → no-ops (kept for compat)
 *
 * NOTE: cache.ts monkey-patches window.swr.set / window.swr.clear / the
 * internal Map.set to write-through to IndexedDB. That patch is applied after
 * DOMContentLoaded (or immediately if swr is already defined). Because this
 * module is imported before DOMContentLoaded fires, the patch will land on
 * the swr object exported here.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

// ── Session token ─────────────────────────────────────────────────────────────

const SESSION_KEY = 'siomac_session_v1';

function _getSessionToken(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as { token?: string }).token ?? '' : '';
  } catch {
    return '';
  }
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface ApiResult {
  success:  boolean;
  message?: string;
  data?:    unknown;
  [key: string]:  unknown;
}

// ── Raw fetch wrapper ─────────────────────────────────────────────────────────

const API_PATH = '/api';

/** Mutation actions that should auto-bust the SWR cache on success. */
const SWR_MUTATIONS = /^(add|update|delete|bulk|upload|approve|reject|submit|setup|login|logout)/i;

export function _rawApi(action: string, args: Record<string, unknown> = {}): Promise<ApiResult> {
  if (!API_PATH || /PASTE_YOUR_EXEC_URL_HERE/i.test(API_PATH)) {
    return Promise.resolve({ success: false, message: 'API URL not set.' });
  }

  const token = _getSessionToken();
  const body  = JSON.stringify({ action, args, token });
  const headers: HeadersInit = { 'Content-Type': 'text/plain;charset=utf-8' };
  if (token) (headers).Authorization = 'Bearer ' + token;

  return fetch(API_PATH, { method: 'POST', headers, body })
    .then(res => res.text())
    .then(text => {
      try {
        const parsed = JSON.parse(text) as ApiResult;
        if (!(parsed?.success) && parsed.message === 'Unauthorized') {
          const fn = (window as unknown as { handleSessionExpired?: () => void }).handleSessionExpired;
          if (typeof fn === 'function') fn();
        }
        return parsed;
      } catch {
        console.error('[api] parse fail', action, text.slice(0, 200));
        if (/^\s*</.test(text)) {
          return { success: false, message: 'Server returned HTML instead of JSON. Check API deployment settings.' };
        }
        return { success: false, message: 'Server returned non-JSON: ' + text.slice(0, 140) };
      }
    })
    .catch((err: unknown) => {
      console.error('[api] fetch fail', action, err);
      return { success: false, message: 'Network error: ' + (err instanceof Error ? err.message : String(err)) };
    });
}

// ── SWR cache ─────────────────────────────────────────────────────────────────

export interface SwrEntry { data: unknown; ts: number }

const _cache    = new Map<string, SwrEntry>();
const _inflight = new Map<string, Promise<unknown>>();
const _subs     = new Map<string, Set<(data: unknown) => void>>();
const DEFAULT_TTL = 60_000;

function _swrGet(key: string): SwrEntry | undefined { return _cache.get(key); }

function _swrSet(key: string, data: unknown): void {
  _cache.set(key, { data, ts: Date.now() });
  _swrFire(key, data);
}

function _swrClear(key?: string): void {
  if (key == null) _cache.clear();
  else             _cache.delete(key);
}

function _swrClearByPrefix(pfx: string): void {
  for (const k of _cache.keys()) { if (k.startsWith(pfx)) _cache.delete(k); }
}

function _swrOn(key: string, cb: (data: unknown) => void): () => void {
  if (!_subs.has(key)) _subs.set(key, new Set());
  _subs.get(key)!.add(cb);
  return () => _subs.get(key)?.delete(cb);
}

function _swrFire(key: string, data: unknown): void {
  _subs.get(key)?.forEach(cb => { try { cb(data); } catch { /* swallow */ } });
}

interface SwrFetchOpts {
  ttl?:     number;
  force?:   boolean;
  onData?:  (data: unknown, isStale: boolean, fromCache: boolean) => void;
  onError?: (err: unknown) => void;
}

function _swrFetch(key: string, fetcher: () => Promise<unknown>, opts: SwrFetchOpts = {}): Promise<unknown> {
  const ttl     = opts.ttl ?? DEFAULT_TTL;
  const force   = !!opts.force;
  const cached  = _cache.get(key);
  const isFresh = !!cached && (Date.now() - cached.ts) < ttl;

  // 1) Deliver cached data synchronously so UI renders immediately on repeat visits
  if (cached && opts.onData) {
    try { opts.onData(cached.data, !isFresh, true); } catch { /* swallow */ }
  }
  if (cached && isFresh && !force) return Promise.resolve(cached.data);

  // 2) Dedupe in-flight
  if (_inflight.has(key)) {
    const p = _inflight.get(key)!;
    if (opts.onData) void p.then(d => { try { opts.onData!(d, false, false); } catch { /* swallow */ } });
    return p;
  }

  // 3) Fetch + emit
  const p = fetcher().then(data => {
    _cache.set(key, { data, ts: Date.now() });
    _inflight.delete(key);
    if (opts.onData) { try { opts.onData(data, false, false); } catch { /* swallow */ } }
    _swrFire(key, data);
    return data;
  }).catch((err: unknown) => {
    _inflight.delete(key);
    if (opts.onError) { try { opts.onError(err); } catch { /* swallow */ } }
    throw err;
  });
  _inflight.set(key, p);
  return p;
}

function _swrMutate(key: string, dataOrFetcher: unknown, revalidate?: boolean): Promise<unknown> | void {
  if (typeof dataOrFetcher === 'function') {
    return _swrFetch(key, dataOrFetcher as () => Promise<unknown>, { force: true });
  }
  if (dataOrFetcher === undefined) { _swrClear(key); return; }
  _cache.set(key, { data: dataOrFetcher, ts: Date.now() });
  _swrFire(key, dataOrFetcher);
  if (revalidate) _swrClear(key);
}

function _swrFocusRevalidate(enable: boolean): void {
  if (!enable) return;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    _subs.forEach((set, key) => { if (set.size) _cache.delete(key); });
  });
}

/** The swr object — shape kept identical so cache.ts monkey-patch lands correctly. */
export const swr = {
  get:             _swrGet,
  set:             _swrSet,
  clear:           _swrClear,
  clearByPrefix:   _swrClearByPrefix,
  on:              _swrOn,
  fetch:           _swrFetch,
  mutate:          _swrMutate,
  focusRevalidate: _swrFocusRevalidate,
  /** Direct reference to the internal Map — used by cache.ts monkey-patch. */
  _cache:   _cache,
  _inflight:_inflight,
};

// ── Last-served hash — skip re-render when fresh data === cached data ─────────

export const _swrLastHash = new Map<string, string>();

// ── SWR-aware api wrapper ─────────────────────────────────────────────────────

export interface ApiSwrOpts {
  key?:     string;
  ttl?:     number;
  force?:   boolean;
  onData?:  (data: unknown, isStale?: boolean, fromCache?: boolean) => void;
  onError?: (err: unknown) => void;
}

export function apiSwr(action: string, args: Record<string, unknown> = {}, opts: ApiSwrOpts = {}): Promise<unknown> {
  const key = opts.key ?? (action + ':' + JSON.stringify(args));
  return _swrFetch(key, () => _rawApi(action, args), {
    ttl:   opts.ttl,
    force: opts.force,
    onData: (data, isStale, fromCache) => {
      const hash = JSON.stringify(data);
      if (_swrLastHash.get(key) === hash) return;
      _swrLastHash.set(key, hash);
      if (opts.onData) opts.onData(data, isStale, fromCache);
    },
    onError: opts.onError,
  });
}

// ── Mutation-aware api() wrapper ──────────────────────────────────────────────

export function api(action: string, args: Record<string, unknown> = {}): Promise<ApiResult> {
  return _rawApi(action, args).then(result => {
    if (result?.success && SWR_MUTATIONS.test(action)) {
      swr.clear();
      _swrLastHash.clear();
    }
    return result;
  });
}

// ── Dev helper ────────────────────────────────────────────────────────────────

export function pingApi(): Promise<ApiResult> {
  return _rawApi('ping', {}).then(out => { console.log('pingApi →', out); return out; });
}

// ── Enable focus-revalidation ─────────────────────────────────────────────────

swr.focusRevalidate(true);

// ── Refresh-button cache bust ─────────────────────────────────────────────────
// Capture-phase so it fires before bubble-phase loaders, ensuring they see a miss.
document.addEventListener('click', e => {
  const btn = (e.target as Element)?.closest?.('[id^="refresh"]');
  if (btn) { swr.clear(); _swrLastHash.clear(); }
}, true);

// ── Window registrations ──────────────────────────────────────────────────────

type Win = Window & typeof globalThis & Record<string, unknown>;
const w = window as Win;

w.api             = api;
w.apiSwr          = apiSwr;
w._rawApi         = _rawApi;
w.swr             = swr;
w._swrLastHash    = _swrLastHash;
w.pingApi         = pingApi;
w.setImgSrc       = (img: HTMLImageElement, url: string) => { if (img && img.src !== url) img.src = url; };
w._ajaxLoaderStart= () => { /* noop */ };   // no-op (background syncs are silent)
w._ajaxLoaderDone = () => { /* noop */ };   // no-op
