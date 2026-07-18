/**
 * tests/unit/criticalPermResolver.test.ts
 *
 * Slice 1 Part C.2 — resolver matrix for the COMPLIANCE_GATED_KEYS carve-out.
 *
 * The tests cover the pure resolveWithSet() function (which auth.ts calls for
 * EVERY permission check after the Slice-1 change) and the authoritative
 * permission loaders' fail-closed behaviour on DB errors.
 *
 * Slice-1 narrowing (decision 2026-07-18):
 *   Only communications.compliance_read and communications.compliance_export are
 *   excluded from the superadmin default set (COMPLIANCE_GATED_KEYS).
 *   The 6 operational critical keys (permissions.manage, roles.manage,
 *   auth.security.manage_policy, auth.passkeys.admin_revoke,
 *   auth.trusted_devices.admin_revoke, communications.admin) remain in the
 *   superadmin default set — they are inherent admin capabilities.
 *
 * States for a COMPLIANCE_GATED key (compliance_read):
 *   1. approved-active grant (user_permissions row, granted=true)  → ALLOW
 *   2. no grant, no role-set entry (superadmin post-Slice-1)       → DENY
 *   3. pending approval (no user_permissions row yet)               → DENY (same as 2)
 *   4. revoked grant (user_permissions row deleted)                 → DENY (same as 2)
 *   5. explicit user-deny (user_permissions row, granted=false)     → DENY even if role set has it
 *   6. permission-table query FAILURE                               → DENY compliance key
 *
 * Regression (operational critical keys must NOT be gated):
 *   7. superadmin auto-holds an operational critical key (permissions.manage)
 *      even without a user_permissions row → ALLOW via role set
 *   8. superadmin auto-holds a non-critical key → ALLOW via role set
 *
 * Note on state 3 (pending) and 4 (revoked): both manifest identically in the
 * resolver — no user_permissions row → no override → role-set fallback → DENY.
 *
 * Note on expiry: user_permissions has no expires_at column; grant expiry is
 * NOT supported at the user_permissions level. Expiry of the underlying
 * permission_grant_approvals request row (7-day window) is separate. This is a
 * known gap reported in the Slice-1 deliverable.
 */

jest.mock('../../netlify/functions/lib/db', () => ({
  sb: {
    from: jest.fn(),
  },
}));

import {
  resolveWithSet,
  CRITICAL_GRANT_KEYS,
  COMPLIANCE_GATED_KEYS,
  invalidateRolePermissions,
  loadRolePermissions,
} from '../../netlify/functions/lib/permissions';
import { loadUserOverrides } from '../../netlify/functions/lib/auth';
import { sb } from '../../netlify/functions/lib/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A compliance-gated key — excluded from the superadmin default set. */
const COMPLIANCE_KEY      = 'communications.compliance_read';
/** An operational critical key — still in CRITICAL_GRANT_KEYS but NOT gated for superadmin. */
const OPERATIONAL_CRIT_KEY = 'permissions.manage';
/** A plain non-critical key — always in the superadmin set. */
const NONCRITICAL_KEY     = 'communications.view';

/**
 * Post-Slice-1 superadmin role set: excludes COMPLIANCE_GATED_KEYS but retains
 * all operational critical keys (permissions.manage, roles.manage, auth.*, etc.)
 * and all non-critical keys.
 */
const superadminRoleSetNarrow = new Set<string>([
  // includes the operational critical key — it is NOT excluded
  OPERATIONAL_CRIT_KEY,
  // includes the plain non-critical key
  NONCRITICAL_KEY,
  // does NOT include COMPLIANCE_KEY (excluded by COMPLIANCE_GATED_KEYS filter)
]);

/** Role set that includes the compliance key — used to test explicit-deny wins. */
const roleSetWithCompliance    = new Set<string>([COMPLIANCE_KEY, NONCRITICAL_KEY]);
/** Role set without the compliance key — the normal superadmin state. */
const roleSetWithoutCompliance = new Set<string>([NONCRITICAL_KEY]);

// ---------------------------------------------------------------------------
// Constant assertions
// ---------------------------------------------------------------------------

describe('COMPLIANCE_GATED_KEYS is a proper subset of CRITICAL_GRANT_KEYS', () => {
  it('compliance_read is in CRITICAL_GRANT_KEYS', () => {
    expect(CRITICAL_GRANT_KEYS.has(COMPLIANCE_KEY)).toBe(true);
  });
  it('compliance_read is in COMPLIANCE_GATED_KEYS', () => {
    expect(COMPLIANCE_GATED_KEYS.has(COMPLIANCE_KEY)).toBe(true);
  });
  it('permissions.manage is in CRITICAL_GRANT_KEYS', () => {
    expect(CRITICAL_GRANT_KEYS.has(OPERATIONAL_CRIT_KEY)).toBe(true);
  });
  it('permissions.manage is NOT in COMPLIANCE_GATED_KEYS (still auto-granted to superadmin)', () => {
    expect(COMPLIANCE_GATED_KEYS.has(OPERATIONAL_CRIT_KEY)).toBe(false);
  });
  it('COMPLIANCE_GATED_KEYS contains exactly 2 keys', () => {
    expect(COMPLIANCE_GATED_KEYS.size).toBe(2);
    expect(COMPLIANCE_GATED_KEYS.has('communications.compliance_read')).toBe(true);
    expect(COMPLIANCE_GATED_KEYS.has('communications.compliance_export')).toBe(true);
  });
  it('CRITICAL_GRANT_KEYS contains all 8 expected keys', () => {
    const expected = [
      'communications.compliance_read',
      'communications.compliance_export',
      'auth.security.manage_policy',
      'auth.passkeys.admin_revoke',
      'auth.trusted_devices.admin_revoke',
      'permissions.manage',
      'roles.manage',
      'communications.admin',
    ];
    for (const k of expected) {
      expect(CRITICAL_GRANT_KEYS.has(k)).toBe(true);
    }
    expect(CRITICAL_GRANT_KEYS.size).toBe(expected.length);
  });
  it('every COMPLIANCE_GATED key is also in CRITICAL_GRANT_KEYS (proper subset)', () => {
    for (const k of COMPLIANCE_GATED_KEYS) {
      expect(CRITICAL_GRANT_KEYS.has(k)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 6-state matrix for a COMPLIANCE_GATED key (compliance_read)
// ---------------------------------------------------------------------------

describe('compliance key resolver — 6-state matrix', () => {
  // ── State 1: approved-active grant ────────────────────────────────────────
  it('ALLOW when user_permissions has granted=true override', () => {
    const overrides = [{ permission: COMPLIANCE_KEY, granted: true }];
    expect(resolveWithSet(COMPLIANCE_KEY, roleSetWithoutCompliance, overrides)).toBe(true);
  });

  it('ALLOW: override takes priority over missing role-set entry', () => {
    const overrides = [{ permission: COMPLIANCE_KEY, granted: true }];
    expect(resolveWithSet(COMPLIANCE_KEY, new Set<string>(), overrides)).toBe(true);
  });

  // ── State 2: no grant, no role-set entry (post-Slice-1 superadmin default) ──
  it('DENY when no override and compliance key absent from role set', () => {
    expect(resolveWithSet(COMPLIANCE_KEY, roleSetWithoutCompliance, [])).toBe(false);
  });

  // ── State 3: pending approval — no user_permissions row yet ───────────────
  it('DENY (pending = no row yet): same as no-grant state', () => {
    expect(resolveWithSet(COMPLIANCE_KEY, roleSetWithoutCompliance, [])).toBe(false);
  });

  // ── State 4: revoked grant — user_permissions row deleted ─────────────────
  it('DENY (revoked = row deleted): same as no-grant state', () => {
    expect(resolveWithSet(COMPLIANCE_KEY, roleSetWithoutCompliance, [])).toBe(false);
  });

  // ── State 5: explicit user-deny ───────────────────────────────────────────
  it('DENY when user_permissions has granted=false override', () => {
    const overrides = [{ permission: COMPLIANCE_KEY, granted: false }];
    expect(resolveWithSet(COMPLIANCE_KEY, roleSetWithoutCompliance, overrides)).toBe(false);
  });

  it('DENY: explicit user-deny wins even when compliance key IS in the role set', () => {
    const overrides = [{ permission: COMPLIANCE_KEY, granted: false }];
    expect(resolveWithSet(COMPLIANCE_KEY, roleSetWithCompliance, overrides)).toBe(false);
  });

  // ── State 6: DB query failure ──────────────────────────────────────────────
  it('does not reinterpret a DB failure as an empty override list', async () => {
    const from = sb.from as unknown as jest.Mock;
    const error = { code: 'XX000', message: 'simulated permission-store failure' };
    from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: null, error }),
      }),
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(loadUserOverrides('test-user')).rejects.toMatchObject({
        status: 503,
        code: 'authorization_unavailable',
      });
    } finally {
      log.mockRestore();
    }
  });
});

describe('role permission store failure', () => {
  it('does not restore hardcoded role grants when the DB lookup fails', async () => {
    const from = sb.from as unknown as jest.Mock;
    const error = { code: 'XX000', message: 'simulated role-store failure' };
    from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: null, error }),
      }),
    });
    invalidateRolePermissions('authorization_failure_test_role');
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(loadRolePermissions('authorization_failure_test_role')).rejects.toMatchObject({
        status: 503,
        code: 'authorization_unavailable',
      });
    } finally {
      log.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: operational critical keys remain auto-granted for superadmin
// ---------------------------------------------------------------------------

describe('operational critical keys — NOT excluded from superadmin role set', () => {
  it('ALLOW: superadmin auto-holds permissions.manage via role set (no user_permissions needed)', () => {
    // The post-Slice-1 superadmin role set INCLUDES permissions.manage.
    // resolveWithSet with an empty override + a role set that has the key = ALLOW.
    const superadminSet = new Set<string>([OPERATIONAL_CRIT_KEY]);
    expect(resolveWithSet(OPERATIONAL_CRIT_KEY, superadminSet, [])).toBe(true);
  });

  it('ALLOW: superadmin auto-holds a non-critical key via role set', () => {
    const superadminSet = new Set<string>([NONCRITICAL_KEY]);
    expect(resolveWithSet(NONCRITICAL_KEY, superadminSet, [])).toBe(true);
  });

  it('operational critical key is NOT in COMPLIANCE_GATED_KEYS (superadmin keeps auto-grant)', () => {
    for (const k of CRITICAL_GRANT_KEYS) {
      if (!COMPLIANCE_GATED_KEYS.has(k)) {
        // Operational critical key: must NOT be in COMPLIANCE_GATED_KEYS
        expect(COMPLIANCE_GATED_KEYS.has(k)).toBe(false);
      }
    }
    // 6 operational critical keys = 8 total - 2 compliance
    expect(CRITICAL_GRANT_KEYS.size - COMPLIANCE_GATED_KEYS.size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Post-Slice-1 superadmin role set invariant
// ---------------------------------------------------------------------------

describe('loadRolePermissions("superadmin") post-Slice-1 invariant', () => {
  it('superadmin static role set MUST NOT contain any COMPLIANCE_GATED key', () => {
    // With no override and a role set that excludes compliance keys, result is DENY.
    for (const key of COMPLIANCE_GATED_KEYS) {
      expect(resolveWithSet(key, superadminRoleSetNarrow, [])).toBe(false);
    }
  });

  it('superadmin static role set MUST contain operational critical keys (e.g. permissions.manage)', () => {
    // The narrowed set includes permissions.manage — it is NOT compliance-gated.
    expect(resolveWithSet(OPERATIONAL_CRIT_KEY, superadminRoleSetNarrow, [])).toBe(true);
  });
});
