/**
 * src/lib/moduleRegistry.test.ts — additive module-registration contract.
 */

import { describe, it, expect } from 'vitest';
import {
  type ModuleDefinition,
  canAccessModuleNavItem,
  registerModule, getModules, getModule, getModulesForRole, getModuleForSection,
} from './moduleRegistry';

function makeModule(id: string, overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return {
    id,
    navItems: [{ id: `s-${id}`, label: id.toUpperCase(), icon: 'fa-box' }],
    roles: ['admin', 'superadmin'],
    mount: { sectionId: `s-${id}`, rootId: `preact-${id}-root`, mount: () => { /* test stub: no real mount */ } },
    ...overrides,
  };
}

describe('registerModule / getModules', () => {
  it('registers and lists modules', () => {
    registerModule(makeModule('mtest1'));
    expect(getModule('mtest1')?.id).toBe('mtest1');
    expect(getModules().some(m => m.id === 'mtest1')).toBe(true);
  });

  it('is idempotent — re-registering replaces, not duplicates', () => {
    registerModule(makeModule('mtest2', { roles: ['admin', 'superadmin'] }));
    registerModule(makeModule('mtest2', { roles: ['manager'] }));
    expect(getModules().filter(m => m.id === 'mtest2')).toHaveLength(1);
    expect(getModule('mtest2')?.roles).toEqual(['manager']);
  });
});

describe('getModulesForRole', () => {
  it('filters by role', () => {
    registerModule(makeModule('mtest3', { roles: ['superadmin'] }));
    expect(getModulesForRole('superadmin').some(m => m.id === 'mtest3')).toBe(true);
    expect(getModulesForRole('employee').some(m => m.id === 'mtest3')).toBe(false);
  });
});

describe('getModuleForSection', () => {
  it('finds the owning module by any nav item id (incl. children)', () => {
    registerModule(makeModule('mtest4', {
      navItems: [
        { id: 's-mtest4', label: 'Parent', icon: 'fa-box' },
        { id: 's-mtest4-child', label: 'Child', icon: 'fa-box', parent: 's-mtest4' },
      ],
    }));
    expect(getModuleForSection('s-mtest4-child')?.id).toBe('mtest4');
    expect(getModuleForSection('s-nope')).toBeUndefined();
  });
});

describe('canAccessModuleNavItem', () => {
  it('allows an item when role and permission requirements both pass', () => {
    expect(canAccessModuleNavItem(
      { id: 's-ac-approvals', label: 'Approvals', icon: 'fa-check', roles: ['manager'], permission: 'communications.compliance_approve' },
      'manager',
      key => key === 'communications.compliance_approve',
    )).toBe(true);
  });

  it('denies when the item role restriction does not include the current role', () => {
    expect(canAccessModuleNavItem(
      { id: 's-ac-users', label: 'Users', icon: 'fa-user-lock', roles: ['superadmin'] },
      'manager',
      () => true,
    )).toBe(false);
  });

  it('denies permission-gated items when the actor lacks the capability', () => {
    expect(canAccessModuleNavItem(
      { id: 's-ac-approvals', label: 'Approvals', icon: 'fa-check', permission: 'communications.compliance_approve' },
      'employee',
      () => false,
    )).toBe(false);
  });
});

describe('Approvals nav visibility tracks the compliance_approve capability', () => {
  // Mirrors the real gate in AccessControl/module.ts: s-ac-approvals is gated ONLY
  // on communications.compliance_approve (no roles fallback).
  const APPROVALS_ITEM = {
    id: 's-ac-approvals', label: 'Approvals', icon: 'fa-clipboard-check',
    permission: 'communications.compliance_approve',
  } as const;

  it('an approver (holds compliance_approve) sees the Approvals page', () => {
    expect(canAccessModuleNavItem(
      APPROVALS_ITEM, 'manager',
      key => key === 'communications.compliance_approve',
    )).toBe(true);
  });

  it('a read/export grantee does NOT automatically see the Approvals page', () => {
    // Grantee holds the time-boxed access keys but NOT the reviewer key.
    const granteeCan = (key: string) =>
      key === 'communications.compliance_read' || key === 'communications.compliance_export';
    expect(canAccessModuleNavItem(APPROVALS_ITEM, 'manager', granteeCan)).toBe(false);
  });
});
