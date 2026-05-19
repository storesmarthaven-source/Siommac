/**
 * src/components/sections/Employees/index.tsx
 *
 * Public entry point for the Employees feature module.
 *
 * Provides:
 *   - QueryClientProvider (wraps ALL employee sub-sections so they share one cache)
 *   - ToastContainer (renders toast notifications produced by mutations)
 *   - SectionRouter — mounts the correct section based on `sectionId` prop
 *
 * Usage (called from main.tsx or a legacy shim):
 *   import { mountEmployeesModule } from '@sections/Employees';
 *   mountEmployeesModule(document.getElementById('employees-root'), {
 *     sectionId:       'employees',
 *     currentRole:     AppState.get('currentRole'),
 *     currentUsername: AppState.get('currentUser'),
 *     queryClient,     // the singleton created in main.tsx
 *   });
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { render }                   from 'preact';
import { type VNode }               from 'preact';
import { QueryClientProvider }      from '@tanstack/preact-query';
import type { QueryClient }         from '@tanstack/query-core';
import { ToastContainer }           from '@shared/Toast';
import { ErrorBoundary }            from '@shared/ErrorBoundary';
import type { UserRole }            from './types';
import { EmployeesSection }         from './EmployeesSection';
import { DepartmentsSection }       from './DepartmentsSection';
import { LeaveSection }             from './LeaveSection';
import { HistorySection }           from './HistorySection';
import { PayslipsSection }          from './PayslipsSection';
import { ManagerDashboard }         from './ManagerDashboard';

// ── Section IDs ───────────────────────────────────────────────────────────────

export type EmployeeSectionId =
  | 'employees'
  | 'departments'
  | 'leave'
  | 'history'
  | 'payslips'
  | 'manager-overview'
  | 'manager-employees'
  | 'manager-leaves';

// ── Mount options ─────────────────────────────────────────────────────────────

export interface MountOptions {
  sectionId:       EmployeeSectionId;
  currentRole:     UserRole;
  currentUsername: string;
  queryClient:     QueryClient;
}

// ── Root component ────────────────────────────────────────────────────────────

function EmployeesRoot({ sectionId, currentRole, currentUsername, queryClient }: MountOptions): VNode {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary sectionName="Employees">
        <SectionRouter
          sectionId={sectionId}
          currentRole={currentRole}
          currentUsername={currentUsername}
        />
      </ErrorBoundary>
      {/* Toast container renders at the bottom of the body via portal */}
      <ToastContainer />
    </QueryClientProvider>
  );
}

// ── Section router ────────────────────────────────────────────────────────────

function SectionRouter({
  sectionId,
  currentRole,
  currentUsername,
}: {
  sectionId:       EmployeeSectionId;
  currentRole:     UserRole;
  currentUsername: string;
}): VNode {
  switch (sectionId) {
    case 'employees':
      return <EmployeesSection currentRole={currentRole} currentUsername={currentUsername} />;

    case 'departments':
      return <DepartmentsSection />;

    case 'leave':
    case 'manager-leaves':
      return <LeaveSection currentRole={currentRole} currentUsername={currentUsername} />;

    case 'history':
      return <HistorySection />;

    case 'payslips':
      return <PayslipsSection />;

    case 'manager-overview':
    case 'manager-employees':
      return <ManagerDashboard currentUsername={currentUsername} />;

    default:
      return (
        <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>
          Unknown section: {sectionId}
        </div>
      );
  }
}

// ── Imperative mount function ─────────────────────────────────────────────────

/**
 * Mount the Employees feature module into a DOM element.
 * Called from the legacy transition shim in main.tsx or nav.js when
 * a user navigates to an employees-related section.
 *
 * @param container - The DOM element to mount into (replaces innerHTML)
 * @param opts      - Mount options
 */
export function mountEmployeesModule(container: Element, opts: MountOptions): void {
  render(<EmployeesRoot {...opts} />, container);
}

/**
 * Unmount the Employees feature module from a DOM element.
 * Call this before navigating away to clean up subscriptions and timers.
 */
export function unmountEmployeesModule(container: Element): void {
  render(null, container);
}

// ── Named exports for individual sections (for testing / future use) ──────────

export {
  EmployeesSection,
  DepartmentsSection,
  LeaveSection,
  HistorySection,
  PayslipsSection,
  ManagerDashboard,
};

export type { UserRole, EmployeeSectionId as SectionId };
