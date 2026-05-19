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
  token:          string;
  refreshToken:   string;
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
  /** unix ms — when the access token expires */
  expiresAt:      number;
}

/** Read and validate the persisted session.  Returns null if missing/expired/corrupt. */
export function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PersistedSession;
    if (!s.token || !s.userId) return null;
    if (s.expiresAt && s.expiresAt < Date.now()) return null;
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

/** Read just the refresh token. */
export function getRefreshToken(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return '';
    return (JSON.parse(raw) as Partial<PersistedSession>).refreshToken ?? '';
  } catch {
    return '';
  }
}

/** Patch only the token fields after a silent refresh — keeps other fields intact. */
export function patchTokens(token: string, refreshToken: string, expiresAt: number): void {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as PersistedSession;
    s.token        = token;
    s.refreshToken = refreshToken;
    s.expiresAt    = expiresAt;
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
