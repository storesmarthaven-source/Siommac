/**
 * ProfileDrawer.test.tsx — asserts the drawer emits the LOCKED reference's DOM.
 *
 * Rewritten with the drawer itself. The previous versions asserted the @ui
 * composition (`ui-entity-head`, `ui-info-card`, `ui-rdrawer-foot`), which the
 * rebuild deleted; keeping them would have pinned this surface to the very
 * structure the implementation contract forbids.
 *
 * They therefore assert the mockup's OWN class names and copy — the things that
 * would silently drift if someone re-adapted the drawer to generic components.
 */
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { ProfileDrawer } from './ProfileDrawer';
import { resolveEmployeeMasterAccess, type EmployeeMasterAccess } from './employeeMasterAccess';
import type { EmployeeProfileShell } from '@api/hr/employeeProfile';

const shell: EmployeeProfileShell = {
  identity: {
    employeeId: 'emp-1', employeeNo: 'EMP-0010', displayName: 'Amara Diallo',
    profileImageUrl: null, employmentStatus: 'active', accountStatus: 'active',
    position: 'Field Engineer', departmentName: 'Operations', siteName: 'Head Office',
  },
  employment: {
    employmentBasis: 'permanent', workArrangement: 'Full-Time', workSchedule: 'Standard',
    startDate: '2021-03-12', tenureMonths: 64, supervisorName: 'Asha Singh',
    payGroupName: 'Monthly Salaried', legalEmployer: 'SIOMAC Ltd.',
    weeklyHours: 40, fte: 1, costCentre: 'ADM-001', employeeGrade: 'G7',
    probationEndDate: '2021-09-12', noticePeriodDays: 30, payFrequency: 'monthly',
    workerCategory: 'Employee', assignmentEffectiveFrom: '2024-07-01',
  },
  readiness: {
    percent: 67, readyControls: 2, totalControls: 3, unresolvedWorkItems: 1,
    payrollStatus: 'blocked', trainingStatus: 'due_soon',
    blockedDomains: ['training'], lastReviewedAt: '2026-05-13T10:15:00Z',
    reviewOwnerLabel: 'Learning Team', nextReviewAt: '2026-06-03',
  },
  attentionPreview: [{
    id: 'training.expiring:cert-1', domain: 'training', title: 'Training Evidence Due',
    detail: 'Due 03 Jun 2025', severity: 'warning', dueState: 'due_soon', dueDate: '2026-06-03',
    owner: 'Learning Team', responsibleParty: 'Learning Team', actionLabel: 'Review',
    actionTarget: 'readiness', requiredCapability: null,
  }],
  attentionTotal: 1,
  tabIndicators: [{ tab: 'readiness', unresolvedCount: 1, highestSeverity: 'warning' }],
  contact: {
    workEmail: 'amara@siomac.test', workPhone: '+1 (868) 555-0147', mobilePhone: null,
    emergencyContactName: 'Althea Baptiste', emergencyContactPhone: '+1 (868) 683-2190',
    emergencyContactRelationship: 'spouse',
  },
  accountHealth: {
    accountStatus: 'active', hasLoginIdentity: true,
    accessProfileLabel: 'Project Manager', openSupportRequests: 0,
  },
  recentActivity: [],
  capabilities: {
    viewStatutory: true, viewReadiness: true, viewDocuments: true, viewAudit: true,
    viewOnboarding: true, viewOffboarding: true, viewAccountSecurity: true,
  },
};

const emptyQuery = { data: undefined, isPending: false, isError: false, error: null };

vi.mock('@api/hr/employeeProfile', async () => {
  const actual = await vi.importActual<typeof import('@api/hr/employeeProfile')>('@api/hr/employeeProfile');
  return {
    ...actual,
    useEmployeeProfileShell: () => ({ data: shell, isPending: false, isError: false, error: null, refetch: vi.fn() }),
    useEmployeeAttention: () => emptyQuery,
  };
});

vi.mock('@api/hr/employeeReadiness', () => ({
  useReadinessMatrix: () => emptyQuery,
  useEmployeeDocumentHealth: () => emptyQuery,
  useEmployeeAccessAssignments: () => emptyQuery,
  useEmploymentDetail: () => emptyQuery,
  useReadinessFollowUp: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@api/hr/employees', () => ({
  useHrAudit: () => emptyQuery,
  useUpdateHrContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const access: EmployeeMasterAccess = resolveEmployeeMasterAccess(() => true);

type DrawerProps = Parameters<typeof ProfileDrawer>[0];

function renderDrawer(props: Partial<DrawerProps> = {}): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfileDrawer
        employeeId="emp-1" onClose={vi.fn()} onAction={vi.fn()} access={access} {...props}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => { document.body.innerHTML = ''; });

describe('Employee profile drawer', () => {
  it('emits the locked structural regions rather than the generic UI-kit composition', () => {
    renderDrawer();
    for (const cls of ['.epd-root', '.drawer', '.topbar', '.identity', '.facts', '.tabs', '.scroll', '.footer']) {
      expect(document.querySelector(cls), cls).not.toBeNull();
    }
    // The superseded composition must not come back.
    expect(document.querySelector('.ui-entity-head')).toBeNull();
    expect(document.querySelector('.ui-info-card')).toBeNull();
    expect(document.querySelector('.ui-rdrawer-foot')).toBeNull();
  });

  it('renders the six approved drawer tabs in order, with no offboarding tab', () => {
    renderDrawer();
    const tabs = [...document.querySelectorAll('.tabs .tab')].map(t => t.getAttribute('data-tab'));
    expect(tabs).toEqual(['overview', 'employment', 'documents', 'readiness', 'access', 'activity']);
  });

  it('drives the tab counter from the shell indicators, not a hand-maintained value', () => {
    renderDrawer();
    const readinessTab = document.querySelector('.tab[data-tab="readiness"]') as HTMLElement;
    expect(within(readinessTab).getByText('1')).toBeTruthy();
    // A tab with no unresolved work carries no indicator at all.
    expect(document.querySelector('.tab[data-tab="access"] .badge')).toBeNull();
  });

  it('shows the readiness gauge from the typed control counts', () => {
    renderDrawer();
    expect(screen.getByText('67%')).toBeTruthy();
    const value = document.querySelector('.gauge-value');
    // The arc is driven by the real percentage, not a fixed decorative length.
    expect(value?.getAttribute('style')).toContain('67');
  });

  it('renders the approved facts strip with the FTE-derived work arrangement', () => {
    renderDrawer();
    const facts = document.querySelector('.facts') as HTMLElement;
    expect(within(facts).getByText('Work Arrangement')).toBeTruthy();
    expect(within(facts).getByText('Full-Time')).toBeTruthy();
  });

  it('shows the attention row with its resolved owner prefix', () => {
    renderDrawer();
    const strip = document.querySelector('.attention-strip') as HTMLElement;
    expect(within(strip).getByText('Training Evidence Due')).toBeTruthy();
    expect(within(strip).getByText('Owner: Learning Team · Due 03 Jun 2025')).toBeTruthy();
  });

  it('opens the contact dialog with every approved field, in one dialog', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('Edit Contact'));
    const dialog = document.querySelector('.contact-dialog') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(within(dialog).getByText('Edit Contact Information')).toBeTruthy();
    // Never a reduced one-field dialog.
    for (const name of ['workEmail', 'workPhone', 'mobile', 'emergencyName', 'relationship', 'emergencyPhone']) {
      expect(dialog.querySelector(`[name="${name}"]`), name).not.toBeNull();
    }
  });

  it('keeps the footer actions pinned in the approved footer', () => {
    const onOpenFullRecord = vi.fn();
    renderDrawer({ onOpenFullRecord });
    const footer = document.querySelector('.footer') as HTMLElement;
    fireEvent.click(within(footer).getByText('View Full Employee Record'));
    expect(onOpenFullRecord).toHaveBeenCalled();
    expect(within(footer).getByText('Request Change')).toBeTruthy();
  });

  it('gates the Add Document action on the upload capability', () => {
    renderDrawer({ access: resolveEmployeeMasterAccess(p => p !== 'hr.employee_documents.upload') });
    fireEvent.click(document.querySelector('.tab[data-tab="documents"]') as HTMLElement);
    expect(screen.queryByText('Add Document')).toBeNull();
  });

  it('only offers implemented actions in the three-dot menu', () => {
    renderDrawer();
    fireEvent.click(screen.getByLabelText('More employee actions'));
    const menu = document.querySelector('.action-menu') as HTMLElement;
    const labels = [...menu.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toEqual(['Edit Employee', 'Change Employment Status', 'Start Offboarding']);
    expect(menu.querySelector('.danger')?.textContent).toBe('Start Offboarding');
  });
});
