// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { canAccessModuleNavItem } from '@lib/moduleRegistry';
import { hrModule } from './module';
import { HRQueryNotice, type HrQueryStateLike } from './HRQueryState';
import { HrApiError } from '@api/hr/client';

const item = (id: string) => {
  const found = hrModule.navItems.find(candidate => candidate.id === id);
  if (!found) throw new Error(`Missing HR nav item ${id}`);
  return found;
};

describe('HR capability navigation', () => {
  it('admits the five management roles that can hold HR capabilities', () => {
    expect(hrModule.roles).toEqual(['hr_staff', 'hr_manager', 'admin', 'manager', 'superadmin']);
  });

  it('gates every HR page by its page capability', () => {
    const employees = item('s-hr-employees');
    expect(canAccessModuleNavItem(employees, 'hr_staff', key => key === 'hr.employees.view')).toBe(true);
    expect(canAccessModuleNavItem(employees, 'hr_staff', () => false)).toBe(false);

    const requests = item('s-hr-requests');
    expect(canAccessModuleNavItem(requests, 'hr_staff', key => key === 'hr.requests.submit_own')).toBe(true);
    expect(canAccessModuleNavItem(requests, 'hr_staff', key => key === 'hr.requests.manage')).toBe(true);
    expect(canAccessModuleNavItem(requests, 'hr_staff', () => false)).toBe(false);

    for (const navItem of hrModule.navItems) {
      expect(navItem.permission !== undefined || (navItem.permissionsAny?.length ?? 0) > 0, navItem.id).toBe(true);
    }
  });
});

function query(overrides: Partial<HrQueryStateLike> = {}): HrQueryStateLike {
  return {
    data: undefined,
    error: undefined,
    isError: false,
    isFetching: false,
    refetch: vi.fn(() => Promise.resolve(undefined)),
    ...overrides,
  };
}

describe('HR query state behavior', () => {
  it('shows a quiet refresh indicator while cached data remains available', () => {
    render(<div><span>cached rows</span><HRQueryNotice queries={[query({ data: ['row'], isFetching: true })]} /></div>);
    expect(screen.getByText('cached rows')).toBeTruthy();
    expect(screen.getByTestId('hr-background-refresh')).toBeTruthy();
  });

  it('shows an actionable retry on failure', () => {
    const refetch = vi.fn(() => Promise.resolve(undefined));
    render(<HRQueryNotice queries={[query({ isError: true, error: new Error('Service unavailable'), refetch })]} />);
    expect(screen.getByText('Service unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('gives stale-write guidance for conflicts', () => {
    const conflict = new HrApiError('hr/unit/update', { success: false, code: 'stale_write', message: 'Version mismatch' });
    render(<HRQueryNotice queries={[query({ isError: true, error: conflict })]} />);
    expect(screen.getByText(/changed since it was loaded/i)).toBeTruthy();
  });
});
