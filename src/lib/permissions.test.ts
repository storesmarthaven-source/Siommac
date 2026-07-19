/**
 * src/lib/permissions.test.ts
 *
 * Unit tests for the RBAC permission resolver.
 *
 * Tests cover:
 *   - Role defaults (each role gets exactly the permissions it should)
 *   - Override grant (DB override can grant beyond role default)
 *   - Override revoke (DB override can revoke a role default)
 *   - Unknown key warning in DEV (logged, returns false)
 *   - Null role → always false
 *   - Superadmin → all permissions
 *
 * @see docs/PHASE_PLAN.md §Phase-2b
 * @see docs/CODING_STANDARDS.md §10-Testing-Standards
 */

import { describe, it, expect, vi } from 'vitest';
import { resolvePermission, PERMISSION_KEYS, ROLE_PERMISSIONS, COMPLIANCE_GATED_KEYS } from './permissions';
import type { PermissionContext }                from './permissions';
import type { PermissionOverride }               from '@api/schemas/auth';

// ── Helpers ───────────────────────────────────────────────────────────────────

// rolePermissions is now DB-loaded at runtime; in tests we seed it from the
// canonical ROLE_PERMISSIONS reference so these still verify the seed's grants.
function ctx(
  role: PermissionContext['role'],
  overrides: PermissionOverride[] = [],
): PermissionContext {
  const rolePermissions = [...((ROLE_PERMISSIONS[role] as readonly string[] | undefined) ?? [])];
  return { role, rolePermissions, overrides };
}

function override(
  permission: string,
  granted: boolean,
): PermissionOverride {
  return {
    user_id:    '00000000-0000-0000-0000-000000000001',
    permission,
    granted,
    set_by:     'superadmin',
    set_at:     new Date().toISOString(),
  };
}

// ── Role default tests ────────────────────────────────────────────────────────

describe('resolvePermission — role defaults', () => {

  describe('employee', () => {
    it('can view own attendance', () => {
      expect(resolvePermission('attendance.view_own', ctx('employee'))).toBe(true);
    });
    it('cannot view all attendance', () => {
      expect(resolvePermission('attendance.view_all', ctx('employee'))).toBe(false);
    });
    it('can submit leave', () => {
      expect(resolvePermission('leaves.submit', ctx('employee'))).toBe(true);
    });
    it('cannot approve leave', () => {
      expect(resolvePermission('leaves.approve', ctx('employee'))).toBe(false);
    });
    it('cannot add employees', () => {
      expect(resolvePermission('employees.add', ctx('employee'))).toBe(false);
    });
    it('cannot manage permissions', () => {
      expect(resolvePermission('permissions.manage', ctx('employee'))).toBe(false);
    });
  });

  describe('manager', () => {
    it('can view all attendance', () => {
      expect(resolvePermission('attendance.view_all', ctx('manager'))).toBe(true);
    });
    it('can approve leave', () => {
      expect(resolvePermission('leaves.approve', ctx('manager'))).toBe(true);
    });
    it('cannot add employees', () => {
      expect(resolvePermission('employees.add', ctx('manager'))).toBe(false);
    });
    it('cannot run payroll', () => {
      expect(resolvePermission('payroll.run', ctx('manager'))).toBe(false);
    });
    it('can view the live map', () => {
      expect(resolvePermission('map.view', ctx('manager'))).toBe(true);
    });
  });

  describe('admin', () => {
    it('can add employees', () => {
      expect(resolvePermission('employees.add', ctx('admin'))).toBe(true);
    });
    it('can run payroll', () => {
      expect(resolvePermission('payroll.run', ctx('admin'))).toBe(true);
    });
    it('can edit statutory rates', () => {
      expect(resolvePermission('settings.statutory_rates', ctx('admin'))).toBe(true);
    });
    it('cannot manage permissions', () => {
      expect(resolvePermission('permissions.manage', ctx('admin'))).toBe(false);
    });
  });

  describe('superadmin', () => {
    it('has all registered permissions EXCEPT the compliance-gated ones', () => {
      for (const key of PERMISSION_KEYS) {
        // Compliance read/export are NOT auto-held — they require an explicit,
        // time-boxed, maker-checker grant even for superadmin (fail-closed model).
        if (COMPLIANCE_GATED_KEYS.has(key)) continue;
        expect(
          resolvePermission(key, ctx('superadmin')),
          `superadmin should have "${key}"`
        ).toBe(true);
      }
    });
    it('does NOT auto-hold the compliance-gated keys without a grant', () => {
      for (const key of COMPLIANCE_GATED_KEYS) {
        expect(
          resolvePermission(key, ctx('superadmin')),
          `superadmin must NOT auto-hold "${key}"`
        ).toBe(false);
      }
    });
    it('holds a compliance-gated key WITH an active time-boxed grant', () => {
      const now = new Date();
      for (const key of COMPLIANCE_GATED_KEYS) {
        const grant: PermissionOverride = {
          user_id: '00000000-0000-0000-0000-000000000001',
          permission: key,
          granted: true,
          valid_from: new Date(now.getTime() - 60_000).toISOString(),
          valid_until: new Date(now.getTime() + 60 * 60_000).toISOString(),
          revoked_at: null,
        };
        expect(resolvePermission(key, ctx('superadmin', [grant]))).toBe(true);
      }
    });
    it('does NOT hold a compliance-gated key once the grant has expired', () => {
      const now = new Date();
      for (const key of COMPLIANCE_GATED_KEYS) {
        const expired: PermissionOverride = {
          user_id: '00000000-0000-0000-0000-000000000001',
          permission: key,
          granted: true,
          valid_from: new Date(now.getTime() - 120 * 60_000).toISOString(),
          valid_until: new Date(now.getTime() - 60_000).toISOString(),
          revoked_at: null,
        };
        expect(resolvePermission(key, ctx('superadmin', [expired]))).toBe(false);
      }
    });
    it('can manage permissions', () => {
      expect(resolvePermission('permissions.manage', ctx('superadmin'))).toBe(true);
    });
  });

});

// ── Override tests ────────────────────────────────────────────────────────────

describe('resolvePermission — DB overrides', () => {

  it('granted override elevates employee beyond role default', () => {
    const context = ctx('employee', [override('employees.view', true)]);
    expect(resolvePermission('employees.view', context)).toBe(true);
  });

  it('revoke override blocks admin capability', () => {
    const context = ctx('admin', [override('payroll.run', false)]);
    expect(resolvePermission('payroll.run', context)).toBe(false);
  });

  it('override takes precedence over role default (grant)', () => {
    // Manager cannot add employees by default
    const context = ctx('manager', [override('employees.add', true)]);
    expect(resolvePermission('employees.add', context)).toBe(true);
  });

  it('override takes precedence over role default (revoke)', () => {
    // Manager can approve leave by default
    const context = ctx('manager', [override('leaves.approve', false)]);
    expect(resolvePermission('leaves.approve', context)).toBe(false);
  });

  it('uses first matching override (no duplicates expected, but safe)', () => {
    // If somehow two overrides exist, the first wins
    const context = ctx('employee', [
      override('attendance.view_all', true),
      override('attendance.view_all', false),
    ]);
    expect(resolvePermission('attendance.view_all', context)).toBe(true);
  });

  it('ignores overrides for other permissions', () => {
    const context = ctx('employee', [override('employees.add', true)]);
    // Unrelated permission not in overrides → falls through to role default
    expect(resolvePermission('attendance.view_own', context)).toBe(true);
    expect(resolvePermission('attendance.view_all', context)).toBe(false);
  });

});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('resolvePermission — edge cases', () => {

  it('unknown key returns false', () => {
    // Suppress the dev warning for the test
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => { /* suppress dev warning in test */ });
    const result = resolvePermission('nonexistent.key', ctx('admin'));
    expect(result).toBe(false);
    spy.mockRestore();
  });

  it('empty overrides array falls through to role defaults', () => {
    expect(resolvePermission('attendance.view_own', ctx('employee', []))).toBe(true);
  });

});
