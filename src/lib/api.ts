/**
 * src/lib/api.ts  —  Typed fetch wrapper
 *
 * Enterprise guarantees:
 *   ✓ JWT attached to every request automatically
 *   ✓ Proactive token refresh 60 s before expiry
 *   ✓ Cross-tab refresh co-ordination via BroadcastChannel (see tab-sync.ts)
 *   ✓ Single in-flight refresh promise — concurrent callers queue behind it
 *   ✓ Automatic retry on transient 5xx / network errors (exponential back-off)
 *   ✓ AbortSignal support for all requests — prevents stale response races
 *   ✓ Structured error logging via logger.ts
 *   ✓ Session expiry routed to sessionStore.expire() via registered callback
 *   ✓ Never throws — always resolves to ApiResponse for safe pattern-matching
 *
 * Usage:
 *   // Typed REST route:
 *   const res = await apiFetch<LoginResponse>('/auth/login', {
 *     method: 'POST', body: { username, password }, public: true,
 *   });
 *
 *   // With abort:
 *   const ctrl = new AbortController();
 *   const res  = await apiFetch('/auth/status', { signal: ctrl.signal });
 *   // ctrl.abort() cancels the in-flight request
 *
 * @deprecated apiAction — use apiFetch with typed REST routes instead.
 * Existing call sites are preserved for backward compat during migration.
 * New code must never call apiAction.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { API_URL, TOKEN_REFRESH_HEADROOM_MS, ACCESS_TOKEN_TTL_MS } from '@cfg';
import { logger } from '@lib/logger';
import type { ApiResponse } from '../../types/api';
import {
  getToken,
  getRefreshToken,
  patchTokens,
  clearSession,
  loadSession,
} from './session';

// ── Retry configuration ───────────────────────────────────────────────────────

const MAX_RETRIES    = 2;
const RETRY_BASE_MS  = 300;   // first retry after 300 ms, second after 600 ms

/** HTTP status codes that are safe to retry (transient server errors).
 *  429 is deliberately EXCLUDED — a rate-limited request must back off, not
 *  hammer at 300ms; fast-retrying it amplifies the limit and ignores Retry-After.
 *  Reads still get a gentle retry from the query layer (TanStack exponential). */
const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

function _shouldRetry(status: number, attempt: number): boolean {
  return attempt < MAX_RETRIES && RETRYABLE_STATUS.has(status);
}

function _retryDelay(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
}

// ── Token refresh ─────────────────────────────────────────────────────────────

// One promise at a time — all concurrent callers await the same refresh
let _refreshPromise: Promise<string | null> | null = null;

async function _doRefresh(): Promise<string | null> {
  const rt = getRefreshToken();
  if (!rt) {
    _onAuthExpired();
    return null;
  }

  try {
    const res  = await fetch(`${API_URL.replace(/\/$/, '')}/refreshToken`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ args: { refreshToken: rt } }),
    });

    const json = await res.json() as {
      success:       boolean;
      token?:        string;
      refreshToken?: string;
      expiresAt?:    number;
    };

    if (!json.success || !json.token) {
      logger.warn('Token refresh rejected by server — forcing logout');
      clearSession();
      _onAuthExpired();
      return null;
    }

    const expiresAt = json.expiresAt ?? (Date.now() + ACCESS_TOKEN_TTL_MS);
    patchTokens(json.token, json.refreshToken ?? rt, expiresAt);

    // Broadcast new tokens to other tabs
    _broadcastTokens(json.token, json.refreshToken ?? rt, expiresAt);

    return json.token;
  } catch (err) {
    logger.error('Token refresh network error', err);
    return null;
  }
}

async function _refreshToken(): Promise<string | null> {
  if (!_refreshPromise) {
    _refreshPromise = _doRefresh().finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

// ── Cross-tab token synchronisation ──────────────────────────────────────────
// Prevents two tabs from running concurrent refresh calls and invalidating
// each other's refresh tokens.

const CHANNEL_NAME = 'siomac-token-sync';

interface TokenBroadcast {
  type:         'TOKEN_REFRESHED' | 'SESSION_EXPIRED';
  token?:       string;
  refreshToken?: string;
  expiresAt?:   number;
}

let _channel: BroadcastChannel | null = null;

function _getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_channel) {
    _channel = new BroadcastChannel(CHANNEL_NAME);
    _channel.onmessage = (evt: MessageEvent<TokenBroadcast>) => {
      const { type, token, refreshToken, expiresAt } = evt.data;
      if (type === 'TOKEN_REFRESHED' && token && refreshToken && expiresAt) {
        // Another tab refreshed — adopt their tokens without making our own call
        patchTokens(token, refreshToken, expiresAt);
        logger.debug('Adopted token refresh from another tab');
      } else if (type === 'SESSION_EXPIRED') {
        clearSession();
        _onAuthExpired();
      }
    };
  }
  return _channel;
}

function _broadcastTokens(token: string, refreshToken: string, expiresAt: number): void {
  _getChannel()?.postMessage({ type: 'TOKEN_REFRESHED', token, refreshToken, expiresAt } satisfies TokenBroadcast);
}

function _broadcastExpiry(): void {
  _getChannel()?.postMessage({ type: 'SESSION_EXPIRED' } satisfies TokenBroadcast);
}

// Initialise the channel on module load so other tabs can push to us
_getChannel();

// ── Auth-expired callback ─────────────────────────────────────────────────────

let _onAuthExpiredFn: (() => void) | null = null;

/** Called by sessionStore on mount to wire logout to the fetch layer. */
export function registerAuthExpiredHandler(fn: () => void): void {
  _onAuthExpiredFn = fn;
}

function _onAuthExpired(): void {
  _broadcastExpiry();
  _onAuthExpiredFn?.();
}

// ── Token freshness check ─────────────────────────────────────────────────────

function _tokenNeedsRefresh(): boolean {
  const s = loadSession();
  if (!s?.expiresAt) return false;
  return s.expiresAt - Date.now() < TOKEN_REFRESH_HEADROOM_MS;
}

// ── Core fetch ────────────────────────────────────────────────────────────────

export interface ApiFetchOptions {
  method?:  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?:    Record<string, unknown> | unknown[] | null;
  headers?: Record<string, string>;
  /**
   * Callers may pass their own AbortSignal to cancel the request.
   * TanStack Query does this automatically for queries.
   */
  signal?:  AbortSignal;
  /** Skip Authorization header — use for /auth/login, /auth/refresh */
  public?:  boolean;
  /**
   * Explicit bearer token, overriding the session store. Used post-login when a
   * full token exists but the store isn't populated yet (e.g. the passkey-setup
   * interstitial). Ignored when `public` is set.
   */
  token?:   string;
  /** Internal: skip the proactive refresh check on retry */
  _skipRefreshCheck?: boolean;
  /**
   * Disable automatic retry (default false).
   * Always set retryable: false for mutations — retrying a POST is unsafe.
   */
  retryable?: boolean;
}

/**
 * Core typed fetch.
 * Path is relative to API_URL — e.g. '/auth/login', '/employees/list'.
 * Always resolves — network errors and server errors are caught and returned
 * as { success: false, message: '...' }.
 */
export async function apiFetch<T extends ApiResponse = ApiResponse>(
  path:    string,
  opts:    ApiFetchOptions = {},
  attempt: number = 0,
): Promise<T> {
  // Abort immediately if caller already cancelled
  if (opts.signal?.aborted) {
    return { success: false, message: 'Request cancelled' } as T;
  }

  // 1) Proactive token refresh
  if (!opts.public && !opts._skipRefreshCheck && _tokenNeedsRefresh()) {
    await _refreshToken();
  }

  const token = opts.public ? '' : (opts.token ?? getToken());

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = {
    method:  opts.method ?? (opts.body != null ? 'POST' : 'GET'),
    headers,
    body:    opts.body != null ? JSON.stringify(opts.body) : undefined,
    signal:  opts.signal,
  };

  // Build the full URL: join API_URL and path, ensuring exactly one '/' between
  // them. An empty path (legacy apiAction) stays as API_URL with no trailing slash.
  const url = path === '' ? API_URL
    : `${API_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (opts.signal?.aborted) {
      return { success: false, message: 'Request cancelled' } as T;
    }
    // Network error — retry if allowed
    if (opts.retryable !== false && attempt < MAX_RETRIES) {
      logger.warn(`Network error on ${path} — retry ${attempt + 1}/${MAX_RETRIES}`, { path, attempt });
      await _retryDelay(attempt);
      return apiFetch<T>(path, opts, attempt + 1);
    }
    logger.error(`Network error on ${path} (no more retries)`, err, { path });
    return { success: false, message: `Network error: ${err instanceof Error ? err.message : String(err)}` } as T;
  }

  // 2) Retry on transient server errors
  if (_shouldRetry(res.status, attempt) && opts.retryable !== false) {
    logger.warn(`HTTP ${res.status} on ${path} — retry ${attempt + 1}/${MAX_RETRIES}`, { path, status: res.status });
    await _retryDelay(attempt);
    return apiFetch<T>(path, opts, attempt + 1);
  }

  // 3) Unrecoverable 401 — try one silent refresh then retry.
  //    Only trigger session expiry if there was an active session to begin with.
  //    Pre-login requests (no session stored) must return silently — never force
  //    logout for unauthenticated users who haven't yet signed in.
  if (res.status === 401 && !opts.public && !opts._skipRefreshCheck) {
    const hasSession = !!loadSession();
    if (!hasSession) {
      // No session was ever established — return a plain error, do NOT expire
      return { success: false, message: 'Unauthorized' } as T;
    }
    const newToken = await _refreshToken();
    if (newToken) {
      return apiFetch<T>(path, { ...opts, _skipRefreshCheck: true }, 0);
    }
    _onAuthExpired();
    return { success: false, message: 'Session expired. Please log in again.' } as T;
  }

  try {
    const json = await res.json();
    // Legacy protocol: backend returns { success: false, message: 'Unauthorized' }
    // Same guard: only treat as session expiry if a session exists.
    if (
      json &&
      (json as ApiResponse).success === false &&
      (json as ApiResponse).message === 'Unauthorized' &&
      !opts.public
    ) {
      const hasSession = !!loadSession();
      if (!hasSession) {
        return { success: false, message: 'Unauthorized' } as T;
      }
      const newToken = await _refreshToken();
      if (newToken) {
        return apiFetch<T>(path, { ...opts, _skipRefreshCheck: true }, 0);
      }
      _onAuthExpired();
      return { success: false, message: 'Session expired. Please log in again.' } as T;
    }
    return json as T;
  } catch {
    return { success: false, message: `Server returned non-JSON (HTTP ${res.status})` } as T;
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

export const apiGet = <T extends ApiResponse = ApiResponse>(
  path:  string,
  opts?: Omit<ApiFetchOptions, 'method' | 'body'>,
): Promise<T> => apiFetch<T>(path, { method: 'GET', ...opts });

/**
 * Authenticated POST. Wraps body in { args } to match the server's
 * validation convention: all routes call zv(c, Schema, body.args ?? {}).
 */
export const apiPost = <T extends ApiResponse = ApiResponse>(
  path:  string,
  body:  Record<string, unknown>,
  opts?: Omit<ApiFetchOptions, 'method' | 'body'>,
): Promise<T> => apiFetch<T>(path, { method: 'POST', body: { args: body }, retryable: false, ...opts });

export const apiPatch = <T extends ApiResponse = ApiResponse>(
  path:  string,
  body:  Record<string, unknown>,
  opts?: Omit<ApiFetchOptions, 'method' | 'body'>,
): Promise<T> => apiFetch<T>(path, { method: 'PATCH', body: { args: body }, retryable: false, ...opts });

export const apiDelete = <T extends ApiResponse = ApiResponse>(
  path:  string,
  opts?: Omit<ApiFetchOptions, 'method' | 'body'>,
): Promise<T> => apiFetch<T>(path, { method: 'DELETE', retryable: false, ...opts });

/**
 * Public endpoints — no JWT, no retry on 401.
 * Wraps body in { args } to match the server's legacy action-dispatch
 * validation convention: all routes call zv(c, Schema, body.args ?? {}).
 */
export const authPost = <T extends ApiResponse = ApiResponse>(
  path:  string,
  body:  Record<string, unknown>,
): Promise<T> => apiFetch<T>(path, { method: 'POST', body: { args: body }, public: true, retryable: false });

// ── Legacy action-dispatch (backward compat only) ─────────────────────────────

/**
 * @deprecated
 * Use `apiPost`, `apiGet`, or `apiFetch` with typed REST paths instead.
 * This wrapper exists only to support legacy JS modules during the migration
 * period (Phases 2–6).  It will be deleted in Phase 7.
 *
 * ESLint rule `no-restricted-imports` is configured to warn on new usages.
 * Run `npm run lint:frontend` to find remaining call sites.
 */
export async function apiAction<T extends ApiResponse = ApiResponse>(
  action: string,
  args:   Record<string, unknown> = {},
): Promise<T> {
  const isMutation = /^(add|update|delete|bulk|upload|approve|reject|submit|setup|login|logout)/i.test(action);
  return apiFetch<T>('', {
    method:    'POST',
    body:      { action, args },
    retryable: !isMutation,
  });
}
