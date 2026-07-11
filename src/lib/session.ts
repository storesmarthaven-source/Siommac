/**
 * src/lib/session.ts
 *
 * Typed helpers for reading/writing the persisted session object in
 * localStorage.  This is the single place that knows the storage key and shape.
 *
 * The session object is intentionally minimal — it holds only what is needed
 * to resume a session across a page reload without hitting the API.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { SESSION_KEY } from '@cfg';

export interface PersistedSession {
  /** Access token (15-min JWT). The refresh token is NOT here — it lives in an
   *  httpOnly cookie set by the server, invisible to JS by design (XSS-proof). */
  token:          string;
  userId:         string;
  username:       string;
  fullName:       string;
  role:           string;
  departmentId:   string;
  position:       string;
  colorScheme:    string;
  layoutMode:     string;
  profileImage:   string;
  companyLogoUrl: string;
  companyName:    string;
  /** unix ms — when the ACCESS TOKEN expires. Freshness only: a stale token is
   *  silently refreshed (proactively by apiFetch, or on 401) — it NEVER means the
   *  session itself has ended. The session's actual lifetime is `idleExpiresAt`. */
  expiresAt:      number;
  /** unix ms — the sliding IDLE deadline (attSystem slides it forward on user
   *  activity). Passing this means the session policy says "logged out". */
  idleExpiresAt?: number;
  /** The role's configured idle window (ms) — used to re-arm `idleExpiresAt`. */
  idleTimeoutMs?: number;
  /** "Remember me" widens the idle window at login. */
  rememberMe?:    boolean;
  /** RBAC snapshot — persisted so can()/useCan() work immediately on refresh */
  rolePermissions?:     string[];
  permissionOverrides?: { user_id: string; permission: string; granted: boolean; set_by: string; set_at: string }[];
  /** Whether the role is a clocking employee (gets self-service nav) */
  isEmployee?:          boolean;
  /** Data scope: 'all' (org-wide) or 'own' (own department only). UI hint only. */
  roleScope?:           'own' | 'all';
}

/**
 * Read and validate the persisted session. Returns null if missing/corrupt or the
 * IDLE deadline has passed (the session policy's logout). An expired ACCESS token
 * does NOT null the session — the refresh-token machinery (apiFetch proactive
 * refresh / 401-retry / ensureFreshToken) restores freshness; treating token
 * expiry as logout was the root cause of "reload logs me out after 15 minutes".
 */
export function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PersistedSession;
    if (!s.token || !s.userId) return null;
    if (s.idleExpiresAt && s.idleExpiresAt < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

/** Persist a session (called on successful login / token refresh). */
export function saveSession(s: PersistedSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // storage full or private mode — degrade gracefully
  }
}

/** Clear the persisted session (logout). */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Read just the access token without parsing the full object. */
export function getToken(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return '';
    return (JSON.parse(raw) as Partial<PersistedSession>).token ?? '';
  } catch {
    return '';
  }
}

/** Patch only the access-token fields after a silent refresh — keeps other fields
 *  intact. The rotated refresh token never reaches JS (httpOnly cookie), so there
 *  is nothing else to patch; any legacy plaintext refreshToken from the pre-cookie
 *  era is scrubbed so no secret lingers in localStorage. */
export function patchTokens(token: string, expiresAt: number): void {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as PersistedSession & { refreshToken?: string };
    s.token     = token;
    s.expiresAt = expiresAt;
    delete s.refreshToken;
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
