/**
 * src/lib/auth.ts
 *
 * Typed authentication service.
 *
 * RESPONSIBILITY (per docs/CODING_STANDARDS.md §P3 — one responsibility):
 *   This module is the ONLY place that calls login/logout/refresh API endpoints.
 *   All other code reads auth state from `store/session.ts` and calls helpers
 *   here to mutate it. Components never call auth endpoints directly.
 *
 * TOKEN MODEL (Phase 2b+ — DONE):
 *   Access token  — 15-min JWT in localStorage `siomac_session_v1` (freshness only;
 *                   silently refreshed, never the session's lifetime).
 *   Refresh token — httpOnly Secure cookie (`siomac_rt`, path=/api), set/rotated/
 *                   cleared by the server. JS never sees it — XSS cannot exfiltrate
 *                   it. Server-side session table = refresh_tokens (device list,
 *                   revocation; surfaced on the Access Control Sessions page).
 *
 *   The public interface (`signIn`, `signOut`, `refreshSession`, `getSession`)
 *   is intentionally designed to be backend-agnostic. The implementation detail
 *   of "which transport" lives only inside each function.
 *
 * SECURITY NOTES (docs/SECURITY.md):
 *   - VULN-001 (HS256): RS256 signing active when JWT keys are configured.
 *   - VULN-003 (no rate limiting): rate limiting is enforced server-side.
 *
 * @see docs/ARCHITECTURE.md §9-Authentication-&-Session
 * @see docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules
 * @see docs/SECURITY.md
 * @see docs/PHASE_PLAN.md §Phase-2b
 */

import { logger }               from '@lib/logger';
import { supabase }             from '@lib/supabase';
import { getQueryClient }       from '@lib/queryClient';
import {
  loginApi,
  verify2faApi,
  setup2faApi,
  confirm2faSetupApi,
  logoutApi,
} from '@components/auth/api';
import type { LoginResult }     from '@components/auth/api';
import type {
  LoginPayload,
  Verify2faPayload,
  ConfirmSetupPayload,
  FullSession,
} from '@api/schemas/auth';
import { FullSessionSchema }    from '@api/schemas/auth';
import { loadPermissionOverrides } from '@api/auth';

// ── Result types ──────────────────────────────────────────────────────────────

/** Successful full session — user is now authenticated */
export interface AuthSuccess {
  status:  'authenticated';
  session: FullSession;
}

/** 2FA challenge — user must enter TOTP code */
export interface Auth2faRequired {
  status:       'two_factor_required';
  preAuthToken: string;
}

/** 2FA setup required — admin has mandated TOTP enrollment */
export interface Auth2faSetupRequired {
  status:       'setup_required';
  preAuthToken: string;
  qrCode?:      string;
  manualCode?:  string;
}

export type SignInResult = AuthSuccess | Auth2faRequired | Auth2faSetupRequired;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a raw LoginResult into a typed FullSession.
 * Throws if the shape doesn't match — catches backend regressions early.
 */
function parseSession(raw: LoginResult): FullSession {
  const parsed = FullSessionSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error('[auth] Session shape mismatch', {
      issues: parsed.error.issues,
      raw,
    });
    throw new Error('Invalid session data received from server.');
  }
  return parsed.data;
}

/**
 * Load permission overrides for a user from the DB and apply them to the
 * session store. Called after every successful login.
 *
 * Silently swallows errors — if overrides can't be loaded, fall back to
 * role defaults (the safe default; per docs/CODING_STANDARDS.md §P4).
 */
async function applyPermissionOverrides(userId: string): Promise<void> {
  try {
    const overrides = await loadPermissionOverrides(userId);
    const { useSessionStore } = await import('@store/session');
    useSessionStore.getState().setPermissionOverrides(overrides);
  } catch (err) {
    logger.warn('[auth] Could not load permission overrides — using role defaults', { err });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sign in with username + password.
 *
 * Returns one of three states:
 *   - `authenticated`       — full session granted; call applySession()
 *   - `two_factor_required` — user must enter TOTP code; call verify2fa()
 *   - `setup_required`      — TOTP enrollment mandatory; call beginSetup()
 */
export async function signIn(payload: LoginPayload): Promise<SignInResult> {
  logger.info('[auth] signIn attempt', { username: payload.username });

  const raw = await loginApi({
    username: payload.username,
    password: payload.password,
  });

  if (!raw.success) {
    throw new Error(raw.message ?? 'Login failed.');
  }

  // 2FA intermediate states
  if (raw.requiresTwoFactor && raw.preAuthToken) {
    return { status: 'two_factor_required', preAuthToken: raw.preAuthToken };
  }

  if (raw.requiresSetup && raw.preAuthToken) {
    return {
      status:       'setup_required',
      preAuthToken: raw.preAuthToken,
      qrCode:       raw.qrCode,
      manualCode:   raw.manualCode,
    };
  }

  // Full session granted
  const session = parseSession(raw);
  await _applyFullSession(session);
  return { status: 'authenticated', session };
}

/**
 * Verify a TOTP code after the login + 2FA challenge.
 */
export async function verify2fa(payload: Verify2faPayload): Promise<AuthSuccess> {
  const raw = await verify2faApi({
    preAuthToken: payload.preAuthToken,
    code:         payload.code,
  });

  if (!raw.success) {
    throw new Error(raw.message ?? 'Invalid code.');
  }

  const session = parseSession(raw);
  await _applyFullSession(session);
  return { status: 'authenticated', session };
}

/**
 * Begin 2FA setup — fetches QR code for the authenticator app.
 */
export async function begin2faSetup(preAuthToken: string): Promise<{
  qrCode:     string;
  manualCode: string;
}> {
  const raw = await setup2faApi({ preAuthToken });

  if (!raw.success) {
    throw new Error(raw.message ?? '2FA setup initiation failed.');
  }

  return {
    qrCode:     raw.qrCode     ?? '',
    manualCode: raw.manualCode ?? '',
  };
}

/**
 * Confirm 2FA setup by entering the first TOTP code from the authenticator app.
 * Returns backup codes to show the user once.
 */
export async function confirm2faSetup(payload: ConfirmSetupPayload): Promise<{
  session:     FullSession;
  backupCodes: string[];
}> {
  const raw = await confirm2faSetupApi({
    preAuthToken: payload.preAuthToken,
    code:         payload.code,
  });

  if (!raw.success) {
    throw new Error(raw.message ?? 'Could not confirm 2FA setup.');
  }

  const session = parseSession(raw);
  await _applyFullSession(session);

  return {
    session,
    backupCodes: raw.backupCodes ?? [],
  };
}

/**
 * Sign out: clears the session store, resets TanStack Query cache, and notifies
 * Supabase Realtime to unsubscribe (teardown is handled by RealtimeController).
 */
export async function signOut(): Promise<void> {
  const { useSessionStore } = await import('@store/session');
  const { username, userId } = useSessionStore.getState();

  logger.info('[auth] signOut', { username });

  // Fire-and-forget — don't block logout on backend response
  if (username && userId) {
    void logoutApi({ username, userId }).catch((err: unknown) => {
      logger.warn('[auth] Logout API call failed (non-fatal)', { err });
    });
  }

  // Tear down notifications Realtime channel and reset notification state
  try {
    const { teardownNotificationsRealtime } = await import('@lib/notifications');
    await teardownNotificationsRealtime();
  } catch {
    // ignore — may already be disconnected
  }
  try {
    const { useNotificationStore } = await import('@store/notifications');
    useNotificationStore.getState().reset();
  } catch {
    // ignore
  }

  // Tear down remaining Realtime subscriptions
  try {
    await supabase.removeAllChannels();
  } catch {
    // ignore — may already be disconnected
  }

  // Clear all cached queries — prevents stale data appearing for next user
  try {
    getQueryClient().clear();
  } catch {
    // ignore — QueryClient may not be initialised in tests
  }

  useSessionStore.getState().logout();
}

/**
 * Get the current session from the store.
 * Returns null if not authenticated.
 */
export function getSession(): FullSession | null {
  // Dynamic import to avoid circular dep at module-load time
  // Read synchronously via the window-bridged store (registered in main.tsx).
  // Avoids a static import cycle while staying browser-safe (no require()).
  try {
    const store = (globalThis as unknown as Record<string, unknown>).__siomacSessionStore as
      { getState(): import('@store/session').SessionState } | undefined;
    if (!store) return null;
    const s = store.getState();
    if (!s.isAuthenticated || !s.token || !s.userId || !s.username || !s.role) {
      return null;
    }
    return {
      token:          s.token,
      userId:         s.userId,
      username:       s.username,
      fullName:       s.fullName ?? '',
      role:           s.role,
      departmentId:   s.departmentId,
      position:       s.position,
      profileImage:   s.profileImage,
      companyName:    s.companyName,
      companyLogoUrl: s.companyLogoUrl,
      colorScheme:    s.colorScheme,
      layoutMode:     s.layoutMode,
    };
  } catch {
    return null;
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Apply a full session to the store and load permission overrides.
 * Private — only called by signIn / verify2fa / confirm2faSetup.
 */
async function _applyFullSession(session: FullSession): Promise<void> {
  const { useSessionStore } = await import('@store/session');
  useSessionStore.getState().login(session as unknown as import('../../types/api').LoginResponse);

  // Load per-user permission overrides from DB (non-blocking, fire in background)
  void applyPermissionOverrides(session.userId);

  // Subscribe to the user-scoped Realtime notifications channel (idempotent)
  const { initNotificationsRealtime } = await import('@lib/notifications');
  initNotificationsRealtime(session.userId);

  logger.info('[auth] Session established', {
    userId:   session.userId,
    username: session.username,
    role:     session.role,
  });
}
