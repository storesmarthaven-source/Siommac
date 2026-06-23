/**
 * src/store/session.ts  —  Authentication & user identity
 *
 * Owns everything that changes on login/logout:
 *   - JWT tokens
 *   - User profile fields (id, name, role, avatar, etc.)
 *   - 2FA state
 *   - Company branding
 *
 * The store hydrates itself from localStorage on first import so a page
 * refresh instantly restores the UI without an extra API round-trip.
 *
 * Integration with the API layer:
 *   - Calls `registerAuthExpiredHandler` so the fetch wrapper can call
 *     `expire()` when a token refresh fails — this triggers the login screen.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { create } from 'zustand';
import { registerAuthExpiredHandler } from '@lib/api';
import { logger } from '@lib/logger';
import {
  loadSession,
  saveSession,
  clearSession,
  type PersistedSession,
} from '@lib/session';
import type { LoginResponse, Verify2faResponse } from '../../types/api';
import type { UserRole, ColorScheme, LayoutMode } from '@cfg';
import type { PermissionOverride } from '@api/schemas/auth';

// ── State shape ───────────────────────────────────────────────────────────────

export interface SessionState {
  // ── Identity ───────────────────────────────────────────────────────────────
  isAuthenticated: boolean;
  userId:          string | null;
  username:        string | null;
  fullName:        string | null;
  role:            UserRole | null;
  departmentId:    string | null;
  position:        string | null;
  profileImage:    string | null;

  // ── Tokens ─────────────────────────────────────────────────────────────────
  token:        string | null;
  refreshToken: string | null;
  expiresAt:    number | null;   // unix ms

  // ── Preferences (persisted per-user) ──────────────────────────────────────
  colorScheme: ColorScheme;
  layoutMode:  LayoutMode;

  // ── Company branding ───────────────────────────────────────────────────────
  companyName:    string | null;
  companyLogoUrl: string | null;

  // ── 2FA ────────────────────────────────────────────────────────────────────
  /** Intermediate pre-auth token — only present while 2FA challenge is in flight */
  preAuthToken:     string | null;
  /** true = enrolled; false = not enrolled; null = unknown (not yet checked) */
  totpEnabled:      boolean | null;

  // ── Passkeys / WebAuthn ────────────────────────────────────────────────────
  /** Number of registered passkeys — populated by the Security panel on load. */
  passkeyCount:     number;
  /** Authentication Method References for the current session (mirrors JWT amr claim). */
  amr:              string[];
  /** Coarse strength classification for the current session. */
  authStrength:     'password_only' | 'mfa' | 'passwordless_passkey' | 'trusted_device' | null;

  // ── RBAC — per-user permission overrides (Phase 2b) ───────────────────────
  /**
   * Per-user overrides loaded from the `user_permissions` table at login.
   * Empty array = use role defaults (rolePermissions below).
   * @see docs/PHASE_PLAN.md §Phase-2b
   */
  permissionOverrides: PermissionOverride[];

  /**
   * The role's resolved default permission set, loaded from the DB at login
   * (phase 12, roles-as-data). Replaces the previously hardcoded ROLE_PERMISSIONS
   * on the frontend so can()/useCan() stay synchronous against this snapshot.
   */
  rolePermissions: string[];

  // ── Actions ────────────────────────────────────────────────────────────────
  /** Called after password check succeeds — full session (2FA not required) */
  login:  (payload: LoginResponse) => void;
  /** Called after TOTP / backup code verification — grants full session */
  verify: (payload: Verify2faResponse) => void;
  /** Store the pre-auth token while the 2FA panel is shown */
  setPreAuthToken: (token: string) => void;
  /** Update profile image URL (optimistic, e.g. after photo upload) */
  setProfileImage: (url: string) => void;
  /** Update colour scheme (called from settings panel) */
  setColorScheme: (scheme: ColorScheme) => void;
  /** Update layout mode (called from settings panel) */
  setLayoutMode: (mode: LayoutMode) => void;
  /** Replace tokens after a silent refresh */
  refreshTokens: (token: string, refreshToken: string, expiresAt: number) => void;
  /** Apply per-user permission overrides loaded from DB at login (Phase 2b) */
  setPermissionOverrides: (overrides: PermissionOverride[]) => void;
  /** Update the registered passkey count (called by the Security panel). */
  setPasskeyCount: (count: number) => void;
  /** Session expired — clear state and show login */
  expire:  () => void;
  /** Full logout — clears state + localStorage */
  logout:  () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function payloadToState(p: LoginResponse | Verify2faResponse): Partial<SessionState> {
  return {
    isAuthenticated: true,
    userId:          p.userId        ?? null,
    username:        p.username      ?? null,
    fullName:        p.fullName      ?? null,
    role:            (p.role as UserRole) ?? null,
    departmentId:    p.departmentId  ?? null,
    position:        p.position      ?? null,
    profileImage:    p.profileImage  ?? null,
    token:           p.token         ?? null,
    refreshToken:    p.refreshToken  ?? null,
    expiresAt:       p.token         ? Date.now() + 15 * 60 * 1000 : null,
    colorScheme:     (p.colorScheme  as ColorScheme) ?? 'navy',
    layoutMode:      (p.layoutMode   as LayoutMode)  ?? 'sidebar',
    companyName:     p.companyName   ?? null,
    companyLogoUrl:  p.companyLogoUrl ?? null,
    permissionOverrides: p.permissionOverrides ?? [],
    rolePermissions:     p.rolePermissions ?? [],
    preAuthToken:    null,
    // Auth-method claims from the session response (present for WebAuthn + verify flows)
    amr:         (p as LoginResponse).amr ?? [],
    authStrength: (p as LoginResponse).authStrength ?? null,
  };
}

function stateFromPersisted(s: PersistedSession): Partial<SessionState> {
  return {
    isAuthenticated: true,
    userId:          s.userId,
    username:        s.username,
    fullName:        s.fullName,
    role:            s.role as UserRole,
    departmentId:    s.departmentId,
    position:        s.position,
    profileImage:    s.profileImage,
    token:           s.token,
    refreshToken:    s.refreshToken,
    expiresAt:       s.expiresAt,
    colorScheme:     s.colorScheme as ColorScheme,
    layoutMode:      s.layoutMode as LayoutMode,
    companyName:     s.companyName,
    companyLogoUrl:  s.companyLogoUrl,
    rolePermissions:     s.rolePermissions ?? [],
    permissionOverrides: s.permissionOverrides ?? [],
  };
}

const LOGGED_OUT: Partial<SessionState> = {
  isAuthenticated:     false,
  userId:              null,
  username:            null,
  fullName:            null,
  role:                null,
  departmentId:        null,
  position:            null,
  profileImage:        null,
  token:               null,
  refreshToken:        null,
  expiresAt:           null,
  companyName:         null,
  companyLogoUrl:      null,
  preAuthToken:        null,
  totpEnabled:         null,
  passkeyCount:        0,
  amr:                 [],
  authStrength:        null,
  permissionOverrides: [],
  rolePermissions:     [],
};

// ── Store ─────────────────────────────────────────────────────────────────────

// Hydrate from localStorage immediately so the first render is not blank
const _persisted = loadSession();

export const useSessionStore = create<SessionState>()((set) => ({
  // Default values — overridden by hydration below
  isAuthenticated: false,
  userId:          null,
  username:        null,
  fullName:        null,
  role:            null,
  departmentId:    null,
  position:        null,
  profileImage:    null,
  token:           null,
  refreshToken:    null,
  expiresAt:       null,
  colorScheme:     'navy',
  layoutMode:      'sidebar',
  companyName:     null,
  companyLogoUrl:  null,
  preAuthToken:        null,
  totpEnabled:         null,
  passkeyCount:        0,
  amr:                 [],
  authStrength:        null,
  permissionOverrides: [],
  rolePermissions:     [],

  // Apply persisted session if available
  ...(_persisted ? stateFromPersisted(_persisted) : {}),

  // ── Actions ─────────────────────────────────────────────────────────────────

  login(payload) {
    const next = payloadToState(payload);
    set(next as SessionState);

    // Persist to localStorage for page-refresh hydration
    if (payload.userId && payload.token) {
      saveSession({
        token:          payload.token!,
        refreshToken:   payload.refreshToken ?? '',
        userId:         payload.userId!,
        username:       payload.username ?? '',
        fullName:       payload.fullName ?? '',
        role:           payload.role ?? '',
        departmentId:   payload.departmentId ?? '',
        position:       payload.position ?? '',
        colorScheme:    payload.colorScheme ?? 'navy',
        layoutMode:     payload.layoutMode ?? 'sidebar',
        profileImage:   payload.profileImage ?? '',
        companyLogoUrl: payload.companyLogoUrl ?? '',
        companyName:    payload.companyName ?? '',
        expiresAt:      Date.now() + 15 * 60 * 1000,
        rolePermissions:     payload.rolePermissions ?? [],
        permissionOverrides: payload.permissionOverrides ?? [],
      });
      logger.info('Session established', { userId: payload.userId, role: payload.role });
    }
  },

  verify(payload) {
    // Same flow as login — verify response carries the full session payload
    useSessionStore.getState().login(payload as LoginResponse);
  },

  setPreAuthToken(token) {
    set({ preAuthToken: token });
  },

  setProfileImage(url) {
    set({ profileImage: url });
    // Patch the persisted copy too
    const s = loadSession();
    if (s) saveSession({ ...s, profileImage: url });
  },

  setColorScheme(scheme) {
    set({ colorScheme: scheme });
    const s = loadSession();
    if (s) saveSession({ ...s, colorScheme: scheme });
  },

  setLayoutMode(mode) {
    set({ layoutMode: mode });
    const s = loadSession();
    if (s) saveSession({ ...s, layoutMode: mode });
  },

  refreshTokens(token, refreshToken, expiresAt) {
    set({ token, refreshToken, expiresAt });
    const s = loadSession();
    if (s) saveSession({ ...s, token, refreshToken, expiresAt });
  },

  setPermissionOverrides(overrides) {
    set({ permissionOverrides: overrides });
  },

  setPasskeyCount(count) {
    set({ passkeyCount: count });
  },

  expire() {
    logger.warn('Session expired — forcing logout');
    clearSession();
    set(LOGGED_OUT as SessionState);
  },

  logout() {
    logger.info('User logged out', { userId: useSessionStore.getState().userId });
    clearSession();
    set({ ...LOGGED_OUT, colorScheme: 'navy', layoutMode: 'sidebar' } as SessionState);
  },
}));

// Wire up the API layer's auth-expired callback
registerAuthExpiredHandler(() => useSessionStore.getState().expire());

// ── Selectors (memoised — use these in components, not raw store access) ──────

export const selectIsAdmin        = (s: SessionState) => s.role === 'admin' || s.role === 'superadmin';
export const selectIsSuperAdmin   = (s: SessionState) => s.role === 'superadmin';
export const selectIsManager      = (s: SessionState) => s.role === 'manager' || selectIsAdmin(s);
export const selectUserId         = (s: SessionState) => s.userId;
export const selectRole           = (s: SessionState) => s.role;
export const selectFullName       = (s: SessionState) => s.fullName;
export const selectPermissions    = (s: SessionState) => s.permissionOverrides;
