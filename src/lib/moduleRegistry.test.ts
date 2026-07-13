/**
 * src/lib/moduleRegistry.test.ts — additive module-registration contract.
 */

import { describe, it, expect } from 'vitest';
import {
  type ModuleDefinition,
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
