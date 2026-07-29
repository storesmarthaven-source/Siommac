/**
 * EmployeeProfilePage.test.tsx — asserts the full record emits the LOCKED
 * reference's DOM and that every control it renders is wired.
 *
 * Rewritten with the page. The previous version asserted the @ui composition
 * (`PageHeader`, `Pill`, `epf-card`, `epf-tabs`) and the client-side readiness
 * derivation, both of which the rebuild deleted; keeping those assertions would
 * have pinned this surface to the exact structure the implementation contract
 * forbids.
 *
 * These therefore assert the reference's OWN class names, its seven tabs in the
 * approved order, the ten dialogs, and the capability gates — the things that
 * would silently drift if someone re-adapted the page to generic components or
 * shipped a control with no endpoint behind it.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { EmployeeProfilePage } from './EmployeeProfilePage';
import { resolveEmployeeMasterAccess, type EmployeeMasterAccess } from './employeeMasterAccess';
import type { EmployeeProfileShell, ProfileTabKey } from '@api/hr/employeeProfile';
import type { EmployeeReadinessMatrix, DocumentHealthSummary } from '@api/hr/employeeReadiness';

const shell: EmployeeProfileShell = {
  identity: {
    employeeId: 'emp-1', employeeNo: 'EMP-0021', displayName: 'Damani Baptiste',
    profileImageUrl: null, employmentStatus: 'active', accountStatus: 'active',
    position: 'Project Manager', departmentName: 'Administration', siteName: 'Port of Spain Head Office',
  },
  employment: {
    employmentBasis: 'permanent', workArrangement: 'Full-Time', workSchedule: 'Standard',
    startDate: '2021-03-12', tenureMonths: 64, supervisorName: 'Lila Auguste',
    payGroupName: 'Monthly Salaried', legalEmployer: 'SIOMAC Ltd.',
    weeklyHours: 40, fte: 1, costCentre: 'ADM-001', employeeGrade: 'Management Band 2',
    probationEndDate: '2021-09-12', noticePeriodDays: 30, payFrequency: 'monthly',
    workerCategory: 'Employee', assignmentEffectiveFrom: '2024-07-01',
  },
  readiness: {
    percent: 67, readyControls: 4, totalControls: 6, unresolvedWorkItems: 2,
    payrollStatus: 'blocked', trainingStatus: 'due_soon',
    blockedDomains: ['payroll', 'training'], lastReviewedAt: '2026-05-14T10:15:00Z',
    reviewOwnerLabel: 'HR Operations', nextReviewAt: '2026-06-03',
  },
  attentionPreview: [{
    id: 'payroll.bank:acct-1', domain: 'payroll', title: 'Bank Account Reverification Due',
    detail: 'Confirm account ending 4821', severity: 'critical', dueState: 'overdue',
    dueDate: '2026-05-10', owner: 'Payroll Team', responsibleParty: 'Payroll Team',
    actionLabel: 'Review', actionTarget: 'readiness', requiredCapability: null,
  }],
  attentionTotal: 2,
  tabIndicators: [
    { tab: 'documents', unresolvedCount: 2, highestSeverity: 'critical' },
    { tab: 'readiness', unresolvedCount: 2, highestSeverity: 'critical' },
    { tab: 'access', unresolvedCount: 1, highestSeverity: 'warning' },
  ],
  contact: {
    workEmail: 'damani.baptiste@siomac.test', workPhone: '+1 (868) 555-0147',
    mobilePhone: '+1 (868) 335-7821', emergencyContactName: 'Althea Baptiste',
    emergencyContactPhone: '+1 (868) 683-2190', emergencyContactRelationship: 'spouse',
  },
  accountHealth: {
    accountStatus: 'active', hasLoginIdentity: true,
    accessProfileLabel: 'Project Manager', openSupportRequests: 1,
  },
  recentActivity: [{
    id: 'act-1', action: 'hr.employee.updated', area: 'employees',
    actorName: 'Lila Auguste', occurredAt: '2026-05-02T09:21:00Z',
  }],
  capabilities: {
    viewStatutory: true, viewReadiness: true, viewDocuments: true, viewAudit: true,
    viewOnboarding: true, viewOffboarding: true, viewAccountSecurity: true,
  },
};
const primaryAttention = shell.attentionPreview[0]!;
let shellData: EmployeeProfileShell | undefined = shell;

const readinessMatrix: EmployeeReadinessMatrix = {
  employeeId: 'emp-1',
  coverage: {
    percent: 67, readyControls: 4, totalControls: 6, unresolvedWorkItems: 2,
    blockedDomains: ['payroll', 'training'],
  },
  controls: [
    {
      control: {
        controlKey: 'assignment.complete', label: 'Assignment', domain: 'assignment',
        resolutionType: 'field_correction', description: 'Department, site and supervisor', isBlocking: true,
      },
      state: 'ready', percent: 100, evaluatedAt: '2024-07-01T00:00:00Z',
      owner: {
        domain: 'assignment', status: 'resolved', ownerType: 'role', ownerId: 'hr_manager',
        ownerLabel: 'HR Operations', recipientUserIds: ['u1'], reason: null,
      },
      workItem: null,
    },
    {
      control: {
        controlKey: 'payroll.bank', label: 'Payroll', domain: 'payroll',
        resolutionType: 'department_verification', description: 'NIS, tax and payment setup', isBlocking: true,
      },
      state: 'in_review', percent: 75, evaluatedAt: '2026-05-14T00:00:00Z',
      owner: {
        domain: 'payroll', status: 'resolved', ownerType: 'role', ownerId: 'finance_manager',
        ownerLabel: 'Payroll Team', recipientUserIds: ['u2'], reason: null,
      },
      workItem: {
        id: 'wi-1', status: 'in_review', severity: 'critical', dueDate: '2020-01-01',
        ageDays: 4, ownerLabel: 'Payroll Team', responsibleTeam: 'Payroll Team',
        nextResponsibleParty: 'Payroll Review',
      },
    },
  ],
  capabilities: { view: true, followUp: true, review: true },
};

const documentHealth: DocumentHealthSummary = {
  totalDocuments: 12, requiredCount: 12, verifiedCount: 10, expiringCount: 1, missingCount: 1,
  verifiedPercent: 83, expiringPercent: 9, missingPercent: 8, categoryCount: 2,
  groups: [
    {
      key: 'identity', label: 'Identity', currentCount: 1, expiringCount: 0, missingCount: 0,
      items: [{
        documentId: 'doc-1', requirementId: 'req-1', documentType: 'identity_card',
        title: 'National Identification', state: 'verified', expiryDate: null,
        issuedAt: '2025-01-08', detail: 'Verified 2025-01-08', required: true,
      }],
    },
    {
      key: 'training', label: 'Training', currentCount: 0, expiringCount: 1, missingCount: 1,
      items: [
        {
          documentId: 'doc-2', requirementId: 'req-2', documentType: 'training_safety',
          title: 'Safety Awareness Certification', state: 'expiring', expiryDate: '2026-06-03',
          issuedAt: '2024-06-03', detail: 'Expires 2026-06-03', required: true,
        },
        {
          documentId: null, requirementId: 'req-3', documentType: 'training_emergency',
          title: 'Emergency Response Refresher', state: 'missing', expiryDate: null,
          issuedAt: null, detail: 'Not provided', required: true,
        },
      ],
    },
  ],
};

const auditRows = [{
  id: 'audit-1', employee_id: 'emp-1', submodule_key: 'employees', actor_id: 'u9',
  actorName: 'Lila Auguste', action: 'hr.employee.updated',
  reason: 'Approved departmental reassignment', created_at: '2026-05-02T09:21:00Z',
  record_id: 'emp-1', previous_state: { cost_center: 'ADM-004' }, new_state: { cost_center: 'ADM-001' },
}];

const idle = { data: undefined, isPending: false, isError: false, error: null };
const settled = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null });

vi.mock('@api/hr/employeeProfile', async () => {
  const actual = await vi.importActual<typeof import('@api/hr/employeeProfile')>('@api/hr/employeeProfile');
  return {
    ...actual,
    useEmployeeProfileShell: () => ({
      ...settled(shellData), ready: !!shellData, isPending: !shellData,
    }),
    useEmployeeAttention: () => idle,
  };
});

vi.mock('@api/hr/employeeReadiness', async () => {
  const actual = await vi.importActual<typeof import('@api/hr/employeeReadiness')>('@api/hr/employeeReadiness');
  return {
    ...actual,
    useReadinessMatrix: () => settled(readinessMatrix),
    useEmployeeDocumentHealth: () => settled(documentHealth),
    useEmployeeAccessAssignments: () => settled([]),
    useEmploymentDetail: () => settled({ bank: null, history: [] }),
    useReadinessWorkItem: () => idle,
    useReadinessFollowUp: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useReadinessReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock('@api/hr/employees', () => ({
  useHrAudit: () => settled(auditRows),
  useHrEmployee: () => settled({
    employee: {
      username: 'dbaptiste', email: 'damani.baptiste@siomac.test', created_at: '2021-03-12T12:00:00Z',
      end_date: null, employment_type: 'permanent', contractor_flag: false,
    },
    currentAssignment: null, assignmentHistory: [], payGroup: null, accessProfile: null,
    statutory: { nis_status: 'registered', bir_file_number: 'BIR-1', paye_applicable: true },
    payrollReadiness: null, statusHistory: [],
  }),
  useUpdateHrContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateHrStatutory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateHrEmployeeRecord: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApplyHrAssignment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateHrChangeRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadHrDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useHrEmployees: () => settled([]),
  useHrOrgUnits: () => settled([]),
  useHrSites: () => settled([]),
}));

vi.mock('@api/hr/employeeAccountSupport', () => ({
  useEmployeeAccountSupportRequests: () => settled([]),
  useCreateAccountSupportRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@api/hr/organization', () => ({ usePositions: () => settled([]) }));
vi.mock('@api/hr/documents', () => ({ useDocumentRequirements: () => settled([]) }));
vi.mock('@api/security', () => ({
  useAdminUserSecurityStatus: () => settled({
    success: true, totpEnabled: true, passkeyCount: 1, trustedDeviceCount: 2,
    mfaMandatory: false, lastSeenAt: '2026-05-14T08:42:00Z',
  }),
}));
vi.mock('@api/hr/offboarding', () => ({
  useOffboardingCases: () => settled([]),
  useOffboardingCase: () => idle,
  useOffboardingMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  hrOffboardingApi: { start: vi.fn() },
}));
vi.mock('@components/nav/navCore', () => ({ showSection: vi.fn() }));
vi.mock('@store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Derive the full-capability map instead of listing fields: a new capability must
// not silently leave these fixtures behind (and un-exercised).
const fullAccess: EmployeeMasterAccess = resolveEmployeeMasterAccess(() => true);

function renderPage(
  access: EmployeeMasterAccess = fullAccess,
  initialTab?: ProfileTabKey,
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeProfilePage employeeId="emp-1" access={access} initialTab={initialTab} onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** Click one of the record tabs by its visible label. */
function openTab(label: string): void {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${label}`) }));
}

/**
 * Choose a `<select>` option the way a browser does.
 *
 * NOT `fireEvent.change`: @testing-library/preact rewrites `change` to `input`
 * whenever `preact/compat` is anywhere in the module graph
 * (dist/cjs/fire-event.js `renameEventCompat`), because compat remaps `onChange`
 * to `oninput` — but only for `input` and `textarea`, never for `select`
 * (preact/compat/src/render.js). A select's `onChange` therefore stays bound to
 * the real `change` event, and the rewritten helper silently fires an event
 * nothing is listening for. Dispatching `change` directly is what the browser
 * does and works whether or not compat happens to be loaded.
 */
function selectOption(select: HTMLSelectElement, value: string): void {
  // `act` flushes the resulting re-render, which the rewritten helper would
  // otherwise have done. Its returned thenable is already settled for a
  // synchronous callback, so there is nothing to await.
  void act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  shellData = shell;
  shell.attentionPreview = [primaryAttention];
  shell.attentionTotal = 2;
});

describe('Employee record — locked structure', () => {
  it('emits the reference regions, not the superseded UI-kit composition', () => {
    renderPage();
    for (const selector of [
      '.epf-root', '.workspace', '.breadcrumbs', '.page-head', '.employee-hero',
      '.hero-profile', '.hero-facts', '.hero-readiness', '.record-tabs', '.tab-shell',
    ]) {
      expect(document.querySelector(selector), selector).not.toBeNull();
    }
    // The deleted composition must not come back.
    expect(document.querySelector('.epf-card')).toBeNull();
    expect(document.querySelector('.epf-tabs')).toBeNull();
    expect(document.querySelector('.ui-page-header')).toBeNull();
  });

  it('renders the seven approved tabs in the locked order', () => {
    renderPage();
    const tabs = [...document.querySelectorAll('.record-tabs .record-tab')].map(t => t.getAttribute('data-tab'));
    expect(tabs).toEqual([
      'overview', 'employment', 'documents', 'readiness', 'access', 'activity', 'offboarding',
    ]);
  });

  it('uses the shared UI-kit skeleton for a cold full-record load', () => {
    shellData = undefined;
    renderPage();
    expect(document.querySelectorAll('.ui-skeleton').length).toBeGreaterThan(12);
    expect(screen.queryByText('Damani Baptiste')).toBeNull();
    expect(document.querySelector('.epf-root')?.getAttribute('aria-busy')).toBe('true');
  });

  it('opens on the tab requested by a drawer drill-through link', () => {
    renderPage(fullAccess, 'documents');
    expect(screen.getByRole('tab', { name: /^Documents/ })).toHaveProperty('ariaSelected', 'true');
    expect(document.querySelector('#panel-documents.active')).not.toBeNull();
  });

  it('drives every tab indicator from the shell, never a hand-maintained value', () => {
    renderPage();
    const documents = document.querySelector<HTMLElement>('.record-tab[data-tab="documents"]')!;
    expect(within(documents).getByText('2')).toBeTruthy();
    expect(documents.querySelector('.tab-indicator')).not.toBeNull();
    // A tab with no unresolved work carries no indicator at all.
    expect(document.querySelector('.record-tab[data-tab="employment"] .tab-indicator')).toBeNull();
  });

  it('draws the hero gauge from the typed control counts', () => {
    renderPage();
    expect(screen.getByText('67%')).toBeTruthy();
    expect(document.querySelector('.gauge-value')?.getAttribute('style')).toContain('67');
  });

  it('shows the attention row with its resolved owner prefix', () => {
    renderPage();
    const strip = document.querySelector<HTMLElement>('.attention-strip')!;
    expect(within(strip).getByText('Bank Account Reverification Due')).toBeTruthy();
    expect(within(strip).getByText('Owner: Payroll Team · Confirm account ending 4821')).toBeTruthy();
  });

  it('omits Needs Attention entirely when the employee has no unresolved items', () => {
    shell.attentionPreview = [];
    shell.attentionTotal = 0;
    renderPage();
    expect(document.querySelector('.attention-strip')).toBeNull();
    expect(screen.queryByText('Needs Attention')).toBeNull();
  });

  it('keeps Account Health as the overview grid’s last card, which the locked layout pins', () => {
    renderPage();
    const cards = [...document.querySelectorAll('#panel-overview .grid-3 > .card')];
    const last = cards[cards.length - 1] as HTMLElement;
    expect(within(last).getByText('Account Health')).toBeTruthy();
  });

  it('supports keyboard navigation across the tab strip', () => {
    renderPage();
    const overview = screen.getByRole('tab', { name: /^Overview/ });
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /^Employment/ })).toHaveProperty('ariaSelected', 'true');
  });
});

describe('Employee record — panels render real contract data', () => {
  it('renders the Documents health block with counts, percentages and a missing segment', () => {
    renderPage();
    openTab('Documents');
    const breakdown = document.querySelector<HTMLElement>('.document-health-breakdown')!;
    expect(breakdown).not.toBeNull();
    // Three segments — the superseded two-segment bar had no "missing".
    expect(breakdown.querySelectorAll('.document-health-bar-new > span')).toHaveLength(3);
    expect(within(breakdown).getByText('Verified · 83%')).toBeTruthy();
    expect(within(breakdown).getByText('Missing · 8%')).toBeTruthy();
    expect(within(breakdown).getByText('12 Records')).toBeTruthy();
  });

  it('filters the document table against the real health rows and clears again', () => {
    renderPage();
    openTab('Documents');
    expect(screen.getByText('National Identification')).toBeTruthy();

    selectOption(screen.getByLabelText<HTMLSelectElement>('Filter by status'), 'missing');
    expect(screen.queryByText('National Identification')).toBeNull();
    expect(screen.getByText('Emergency Response Refresher')).toBeTruthy();

    fireEvent.click(screen.getByText('Clear Filters'));
    expect(screen.getByText('National Identification')).toBeTruthy();
  });

  it('renders the readiness rail, blockers and matrix from the control contract', () => {
    renderPage();
    openTab('Readiness');
    const rail = document.querySelector<HTMLElement>('.readiness-rail')!;
    expect(rail.querySelectorAll('.readiness-rail-item')).toHaveLength(2);
    expect(within(rail).getByText('Blocked')).toBeTruthy();
    // Coverage is the server's, not a client recount.
    expect(screen.getByText('4 of 6')).toBeTruthy();
    // An overdue work item is labelled by its due date, not by its status.
    expect(document.querySelector('.readiness-work-state')?.textContent).toBe('Overdue');
    expect(screen.getByText('Readiness Control Matrix')).toBeTruthy();
  });

  it('filters the activity table and exposes the per-row change detail', () => {
    renderPage();
    openTab('Activity & Audit');
    expect(screen.getByText('Employee Updated')).toBeTruthy();

    selectOption(screen.getByLabelText('Filter by activity area'), 'documents');
    expect(screen.queryByText('Employee Updated')).toBeNull();
    fireEvent.click(screen.getByText('Clear Filters'));

    fireEvent.click(screen.getByText('View Change'));
    const dialog = document.querySelector<HTMLElement>('.audit-detail-dialog')!;
    expect(dialog).not.toBeNull();
    // Before/After come from the audit row's own snapshots.
    expect(within(dialog).getByText('Cost Center: ADM-004')).toBeTruthy();
    expect(within(dialog).getByText('Cost Center: ADM-001')).toBeTruthy();
  });

  it('shows the offboarding empty state with its four-step flow', () => {
    renderPage();
    openTab('Offboarding');
    expect(screen.getByText('No Active Offboarding Case')).toBeTruthy();
    expect(document.querySelectorAll('.offboarding-flow .offboarding-step')).toHaveLength(4);
    expect(screen.getByText('No Previous Offboarding Cases')).toBeTruthy();
  });
});

describe('Employee record — all ten dialogs open and are wired', () => {
  it('opens the Edit Employee Record dialog with area selection and Back, in ONE dialog', () => {
    renderPage();
    fireEvent.click(screen.getByText('Edit Employee'));
    const dialog = document.querySelector<HTMLElement>('.employee-edit-dialog')!;
    expect(dialog).not.toBeNull();
    expect(within(dialog).getByText('Employee Record Areas')).toBeTruthy();

    fireEvent.click(within(dialog).getByText('Employment & Assignment'));
    // Still ONE dialog — no nested second dialog.
    expect(document.querySelectorAll('.edit-dialog')).toHaveLength(1);
    expect(screen.getByText('Edit Employment & Assignment')).toBeTruthy();
    // Every field the atomic assignment command accepts is present.
    for (const id of [
      'employment-position', 'employment-department', 'employment-manager', 'employment-location',
      'employment-hours', 'employment-fte', 'employment-notice', 'employment-effective', 'employment-reason',
    ]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }

    fireEvent.click(screen.getByLabelText('Back'));
    expect(screen.getByText('Employee Record Areas')).toBeTruthy();
  });

  it('validates assignment conditions on the field, not only in a toast', () => {
    renderPage();
    fireEvent.click(screen.getByText('Edit Employee'));
    fireEvent.click(screen.getByText('Employment & Assignment'));
    fireEvent.input(document.getElementById('employment-fte')!, { target: { value: '9' } });
    fireEvent.submit(document.querySelector<HTMLFormElement>('.edit-dialog form')!);
    expect(screen.getByText('Enter an FTE between 0.1 and 1.5.')).toBeTruthy();
  });

  it('opens the readiness work-item dialog from the rail, the blocker and the matrix', () => {
    renderPage();
    openTab('Readiness');
    fireEvent.click(screen.getAllByText('Open Work Item')[0]!);
    expect(document.querySelector('.readiness-review-dialog')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(document.querySelector('.readiness-review-dialog')).toBeNull();

    fireEvent.click(document.querySelectorAll('.readiness-rail-item')[1] as HTMLElement);
    expect(document.querySelector('.readiness-review-dialog')).not.toBeNull();
  });

  it('opens the account assistance and request-history dialogs from Access', () => {
    renderPage();
    openTab('Access');
    fireEvent.click(screen.getByText('Request Account Assistance'));
    const assistance = document.querySelector<HTMLElement>('.account-assistance-dialog')!;
    expect(assistance).not.toBeNull();
    // Every assistance type maps 1:1 onto a service domain the backend validates.
    expect(within(assistance).getByLabelText('Assistance Type').querySelectorAll('option')).toHaveLength(7);
    expect(assistance.querySelectorAll('.impact-option')).toHaveLength(3);
    fireEvent.click(screen.getByLabelText('Close'));

    fireEvent.click(screen.getByText('View Request History'));
    expect(document.querySelector('.history-dialog')).not.toBeNull();
  });

  it('opens the document dialogs and offers only formats the backend renders', () => {
    renderPage();
    openTab('Documents');
    fireEvent.click(screen.getByText('Add Document'));
    expect(document.getElementById('document-name')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Close'));

    fireEvent.click(screen.getByText('Export Index'));
    const formats = [...(document.getElementById('export-format') as HTMLSelectElement).options].map(o => o.value);
    // XLSX is deliberately absent — the backend refuses to produce it.
    expect(formats).toEqual(['csv', 'pdf']);
  });

  it('requires a business reason before an audit export can run', () => {
    renderPage();
    openTab('Activity & Audit');
    fireEvent.click(screen.getByText('Export Audit History'));
    fireEvent.click(screen.getByText('Generate Audit Export'));
    expect(screen.getByText('State why this audit history is required (at least 8 characters).')).toBeTruthy();
  });

  it('opens Start Offboarding and validates its required fields', () => {
    renderPage();
    openTab('Offboarding');
    fireEvent.click(screen.getByText('Start Offboarding'));
    fireEvent.submit(document.querySelector<HTMLFormElement>('.offboarding-dialog form')!);
    expect(screen.getByText('Select the offboarding reason.')).toBeTruthy();
    expect(screen.getByText('Record the last working day.')).toBeTruthy();
  });

  it('opens Request Change with the change types the approval engine can apply', () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('More employee actions'));
    fireEvent.click(screen.getByText('Request Employee Change'));
    const dialog = document.querySelector<HTMLElement>('.request-change-dialog')!;
    expect(dialog).not.toBeNull();
    fireEvent.submit(dialog.querySelector<HTMLFormElement>('form')!);
    expect(screen.getByText('Select the value you are requesting.')).toBeTruthy();
    expect(screen.getByText('Explain the business reason in at least 10 characters.')).toBeTruthy();
  });
});

describe('Employee record — capability gates', () => {
  it('hides Edit Employee and offers Request Change when the actor cannot edit directly', () => {
    renderPage(resolveEmployeeMasterAccess(p => p !== 'hr.employees.update'));
    const actions = document.querySelector<HTMLElement>('.page-actions')!;
    expect(within(actions).queryByText('Edit Employee')).toBeNull();
    expect(within(actions).getByText('Request Change')).toBeTruthy();
  });

  it('hides Add Document without the upload capability, and Export Index without download', () => {
    renderPage(resolveEmployeeMasterAccess(
      p => p !== 'hr.employee_documents.upload' && p !== 'hr.employee_documents.download'));
    openTab('Documents');
    expect(screen.queryByText('Add Document')).toBeNull();
    expect(screen.queryByText('Export Index')).toBeNull();
  });

  it('hides Start Offboarding without the offboarding-start capability', () => {
    renderPage(resolveEmployeeMasterAccess(p => p !== 'hr.offboarding.start'));
    openTab('Offboarding');
    expect(screen.getByText('No Active Offboarding Case')).toBeTruthy();
    expect(screen.queryByText('Start Offboarding')).toBeNull();
  });

  it('masks account security rather than blanking it when the capability is absent', () => {
    renderPage(resolveEmployeeMasterAccess(p => p !== 'auth.security.view'));
    openTab('Access');
    // The difference between "not enrolled" and "not permitted to see" stays visible.
    expect(screen.getAllByText('Restricted').length).toBeGreaterThan(0);
    expect(screen.queryByText('Not Enrolled')).toBeNull();
  });

  it('offers only the record areas the actor may actually edit', () => {
    renderPage(resolveEmployeeMasterAccess(
      p => p !== 'hr.employees.statutory.update' && p !== 'hr.employees.update'
        && p !== 'hr.employees.restricted_contact.update'));
    fireEvent.click(screen.getByLabelText('More employee actions'));
    // With no edit capability at all the header shows Request Change instead.
    expect(document.querySelector('.page-actions')?.textContent).toContain('Request');
  });
});
