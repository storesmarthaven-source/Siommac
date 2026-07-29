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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
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
const trainingAttention = shell.attentionPreview[0]!;
let shellData: EmployeeProfileShell | undefined = shell;

const emptyQuery = { data: undefined, isPending: false, isError: false, error: null };
let attentionData: { items: EmployeeProfileShell['attentionPreview'] } | undefined;
const attentionRefetch = vi.fn(() => Promise.resolve({ data: attentionData }));

vi.mock('@api/hr/employeeProfile', async () => {
  const actual = await vi.importActual<typeof import('@api/hr/employeeProfile')>('@api/hr/employeeProfile');
  return {
    ...actual,
    useEmployeeProfileShell: (employeeId: string | null) => {
      const data = shellData?.identity.employeeId === employeeId ? shellData : undefined;
      return {
        data, ready: !!data, isPending: !data, isError: false, error: null, refetch: vi.fn(),
      };
    },
    useEmployeeAttention: () => ({
      ...emptyQuery, data: attentionData, isFetching: false, refetch: attentionRefetch,
    }),
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

afterEach(() => {
  document.body.innerHTML = '';
  attentionData = undefined;
  shellData = shell;
  attentionRefetch.mockClear();
  shell.attentionPreview = [trainingAttention];
  shell.attentionTotal = 1;
  shell.readiness!.percent = 67;
});

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

  it('uses the shared UI-kit skeleton and withholds the previous employee during a switch', () => {
    shellData = undefined;
    renderDrawer();
    expect(document.querySelectorAll('.ui-skeleton').length).toBeGreaterThan(8);
    expect(screen.queryByText('Amara Diallo')).toBeNull();
    expect(document.querySelector('.drawer')?.getAttribute('aria-busy')).toBe('true');
  });

  it('renders the six approved drawer tabs in order, with no offboarding tab', () => {
    renderDrawer();
    const tabs = [...document.querySelectorAll('.tabs .tab')].map(t => t.getAttribute('data-tab'));
    expect(tabs).toEqual(['overview', 'employment', 'documents', 'readiness', 'access', 'activity']);
  });

  it('drives the tab counter from the shell indicators, not a hand-maintained value', () => {
    renderDrawer();
    const readinessTab = document.querySelector<HTMLElement>('.tab[data-tab="readiness"]')!;
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

  it('renders one red origin marker, not a gradient endpoint, at zero readiness', () => {
    shell.readiness!.percent = 0;
    renderDrawer();
    expect(document.querySelector('.gauge-zero-dot')).not.toBeNull();
    expect(document.querySelector('.gauge-value')).toBeNull();
  });

  it('renders the approved facts strip with the FTE-derived work arrangement', () => {
    renderDrawer();
    const facts = document.querySelector<HTMLElement>('.facts')!;
    expect(within(facts).getByText('Work Arrangement')).toBeTruthy();
    expect(within(facts).getByText('Full-Time')).toBeTruthy();
  });

  it('shows the attention row with its resolved owner prefix', () => {
    renderDrawer();
    const strip = document.querySelector<HTMLElement>('.attention-strip')!;
    expect(within(strip).getByText('Training Evidence Due')).toBeTruthy();
    expect(within(strip).getByText('Owner: Learning Team · Due 03 Jun 2025')).toBeTruthy();
  });

  it('pages attention work two items at a time and keeps the next arrow visible', async () => {
    const makeItem = (
      id: string, title: string,
    ): EmployeeProfileShell['attentionPreview'][number] => ({
      ...trainingAttention, id, title,
    });
    const allItems = [
      makeItem('a', 'First Issue'),
      makeItem('b', 'Second Issue'),
      makeItem('c', 'Third Issue'),
      makeItem('d', 'Fourth Issue'),
      makeItem('e', 'Fifth Issue'),
    ];
    shell.attentionPreview = allItems.slice(0, 2);
    shell.attentionTotal = allItems.length;
    attentionData = { items: allItems };

    renderDrawer();
    expect(document.querySelectorAll('.attention-strip .attention-item')).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('Show the next attention items'));

    await waitFor(() => expect(screen.getByText('Third Issue')).toBeTruthy());
    expect(screen.getByText('Fourth Issue')).toBeTruthy();
    expect(screen.queryByText('First Issue')).toBeNull();
    expect(document.querySelectorAll('.attention-strip .attention-item')).toHaveLength(2);
    expect(screen.getByLabelText('Show the next attention items')).toBeTruthy();
  });

  it('opens the contact dialog with every approved field, in one dialog', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('Edit Contact'));
    const dialog = document.querySelector<HTMLElement>('.contact-dialog')!;
    expect(dialog).not.toBeNull();
    expect(within(dialog).getByText('Edit Contact Information')).toBeTruthy();
    // Never a reduced one-field dialog.
    for (const name of ['workEmail', 'workPhone', 'mobile', 'emergencyName', 'relationship', 'emergencyPhone']) {
      expect(dialog.querySelector(`[name="${name}"]`), name).not.toBeNull();
    }
    expect(within(dialog).getAllByText('+1 (868)')).toHaveLength(3);
    expect(dialog.querySelectorAll('.tt-phone-prefix')).toHaveLength(3);
  });

  it('does not render a decorative online-presence dot on the employee photo', () => {
    renderDrawer();
    expect(document.querySelector('.identity .presence')).toBeNull();
  });

  it('omits Needs Attention entirely when the employee has no unresolved items', () => {
    shell.attentionPreview = [];
    shell.attentionTotal = 0;
    renderDrawer();
    expect(document.querySelector('.attention-strip')).toBeNull();
    expect(screen.queryByText('Needs Attention')).toBeNull();
  });

  it('keeps the footer actions pinned in the approved footer', () => {
    const onOpenFullRecord = vi.fn();
    renderDrawer({ onOpenFullRecord });
    const footer = document.querySelector<HTMLElement>('.footer')!;
    fireEvent.click(within(footer).getByText('View Full Employee Record'));
    expect(onOpenFullRecord).toHaveBeenCalledWith('overview');
    expect(within(footer).getByText('Request Change')).toBeTruthy();
  });

  it('drills contextual links into the matching full-record tab', () => {
    const onOpenFullRecord = vi.fn();
    renderDrawer({ onOpenFullRecord });

    fireEvent.click(screen.getByRole('button', { name: /^Details/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Employment/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Documents/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Access/ }));
    fireEvent.click(screen.getByRole('button', { name: /^View All/ }));
    fireEvent.click(screen.getByText('Training Evidence Due'));

    expect(onOpenFullRecord.mock.calls).toEqual([
      ['readiness'],
      ['employment'],
      ['documents'],
      ['access'],
      ['activity'],
      ['readiness'],
    ]);
    expect(screen.getByRole('tab', { name: /^Overview/ })).toHaveProperty('ariaSelected', 'true');
  });

  it('gates the Add Document action on the upload capability', () => {
    renderDrawer({ access: resolveEmployeeMasterAccess(p => p !== 'hr.employee_documents.upload') });
    fireEvent.click(document.querySelector('.tab[data-tab="documents"]')!);
    expect(screen.queryByText('Add Document')).toBeNull();
  });

  it('only offers implemented actions in the three-dot menu', () => {
    renderDrawer();
    fireEvent.click(screen.getByLabelText('More employee actions'));
    const menu = document.querySelector('.action-menu')!;
    const labels = [...menu.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toEqual(['Edit Employee', 'Change Employment Status', 'Start Offboarding']);
    expect(menu.querySelector('.danger')?.textContent).toBe('Start Offboarding');
  });
});
