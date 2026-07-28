import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { EmployeeProfilePage } from './EmployeeProfilePage';
import { resolveEmployeeMasterAccess, type EmployeeMasterAccess } from './employeeMasterAccess';

const employee = {
  id: 'emp-1', username: 'damani.baptiste', full_name: 'Damani Baptiste', first_name: 'Damani', last_name: 'Baptiste', display_name: null,
  role: 'employee', status: 'active', accountStatus: 'active', employment_type: 'permanent', department_id: 'dept-1', site_id: 'site-1', position: 'Project Manager',
  supervisor_id: 'manager-1', email: 'damani@siomac.test', personal_email: null, date_of_birth: null, nationality: 'Trinidad and Tobago',
  government_id: null, probation_end_date: '2022-09-12', employee_grade: null, work_schedule: 'Full-Time', cost_center: 'ADMIN', phone: '868-555-0147',
  mobile_phone: '868-335-7821', created_at: '2021-03-12T12:00:00Z',
  emergency_contact_name: 'Althea Baptiste', emergency_contact_phone: '868-555-2190', emergency_contact_relationship: 'Spouse',
  employee_number: 'EMP-0021', start_date: '2021-03-12', end_date: null, contractor_flag: false, profile_image_url: null,
  profile_image_pending_thumb_url: null, profile_image_pending_submitted_at: null, departmentName: 'Administration',
  siteName: 'Port of Spain Office', supervisorName: 'Lila Auguste', workerType: 'employee' as const, trainingStatus: 'due_soon' as const,
  readiness: { percent: 67, assignmentComplete: true, payrollStatus: 'blocked' as const, trainingStatus: 'due_soon' as const, blockers: ['payroll', 'training'] as ('payroll' | 'training')[] },
  offboardingActive: false,
};
const detail = {
  employee,
  statusHistory: [],
  currentAssignment: {
    id: 'assignment-1', employee_id: 'emp-1', position_id: null, department_id: 'dept-1', site_id: 'site-1',
    supervisor_id: 'manager-1', assignment_type: 'primary', effective_from: '2021-03-12', effective_to: null,
    is_current: true, departmentName: 'Administration', siteName: 'Port of Spain Office',
    supervisorName: 'Lila Auguste', positionTitle: 'Project Manager',
  },
  assignmentHistory: [{
    id: 'assignment-1', employee_id: 'emp-1', position_id: null, department_id: 'dept-1', site_id: 'site-1',
    supervisor_id: 'manager-1', assignment_type: 'primary', effective_from: '2021-03-12', effective_to: null,
    is_current: true, departmentName: 'Administration', siteName: 'Port of Spain Office',
    supervisorName: 'Lila Auguste', positionTitle: 'Project Manager',
  }],
  payGroup: { id: 'pay-group-1', code: 'MONTHLY', name: 'Monthly Salaried', frequency: 'monthly', effectiveFrom: '2021-03-12', effectiveTo: null },
  accessProfile: null,
  statutory: null,
  payrollReadiness: { status: 'blocked' as const, blockers: ['NIS'], financeHandoffEligible: false },
};

vi.mock('@api/hr/employees', () => ({
  useHrEmployee: () => ({ data: detail, ready: true, isError: false }),
  useHrWorkflowSummary: () => ({ data: { employee_id: 'emp-1', open_count: 0, urgent_count: 0, items: [] }, isLoading: false, isError: false }),
  useHrAudit: () => ({ data: [], isLoading: false, isError: false }),
  useHrDocuments: () => ({ data: [], isLoading: false, isError: false }),
  useHrTrainingSummary: () => ({ data: { total: 2, current: 1, dueSoon: 1, expired: 0, pending: 0, certificates: [] }, isLoading: false, isError: false }),
  useVerifyHrDocument: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useArchiveHrDocument: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  getHrDocumentDownloadUrl: vi.fn(),
  useDecideHrEmployeePhoto: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@api/security', () => ({ useAdminUserSecurityStatus: () => ({ data: null, isSuccess: false }) }));
vi.mock('@api/finance/bankAccounts', () => ({ useBankAccounts: () => ({ data: [], isLoading: false, isError: false }) }));
vi.mock('@api/finance/statutoryForms', () => ({ useEmployerProfile: () => ({ data: null, isLoading: false, isError: false }) }));
vi.mock('@api/hr/offboarding', () => ({
  useOffboardingCases: () => ({ data: [], isLoading: false, isError: false }),
  useOffboardingCase: () => ({ data: null, isLoading: false, isError: false }),
}));
vi.mock('@lib/permissions', () => ({ can: () => false }));
vi.mock('@components/nav/navCore', () => ({ showSection: vi.fn() }));
vi.mock('@store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./EmployeeOnboardingSummary', () => ({ EmployeeOnboardingSummary: () => null }));

// Derive the full-capability map instead of listing fields: a new capability must
// not silently leave these fixtures behind (and un-exercised).
const access: EmployeeMasterAccess = resolveEmployeeMasterAccess(() => true);

describe('Full employee record page', () => {
  it('separates quick identity from deep work and uses the approved focused tabs', () => {
    render(<EmployeeProfilePage employeeId="emp-1" access={access} onBack={vi.fn()} onAction={vi.fn()} />);

    expect(screen.getByText('Damani Baptiste')).toBeTruthy();
    expect(screen.getByText('EMP-0021')).toBeTruthy();
    expect(screen.getByText('Port of Spain Office')).toBeTruthy();
    for (const tab of ['Overview', 'Employment', 'Documents', 'Readiness', 'Access', 'Activity & Audit', 'Offboarding']) {
      expect(screen.getByRole('tab', { name: tab })).toBeTruthy();
    }
    expect(screen.queryByText('Performance Review')).toBeNull();
    expect(screen.getByText('Payroll Readiness Is Blocked')).toBeTruthy();
    expect(screen.getByText('Employment Snapshot')).toBeTruthy();
    expect(screen.getAllByText('Monthly Salaried')).toHaveLength(2);
    expect(screen.getByText('Contact')).toBeTruthy();
    expect(screen.getByText('868-335-7821')).toBeTruthy();
  });

  it('keeps deep employment work on its own page and does not fabricate restricted finance data', () => {
    render(<EmployeeProfilePage employeeId="emp-1" access={access} onBack={vi.fn()} onAction={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Employment' }));

    expect(screen.getByRole('heading', { name: 'Employment' })).toBeTruthy();
    expect(screen.getByText('Complete Employment History')).toBeTruthy();
    expect(screen.getByText('Pay Administration & Legal Employer')).toBeTruthy();
    expect(screen.getByText(/Finance Capabilities Are Required/i)).toBeTruthy();
  });

  it('renders the selected deep-work sections without unrelated performance content', () => {
    render(<EmployeeProfilePage employeeId="emp-1" access={access} onBack={vi.fn()} onAction={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(screen.getByText('Employee Document Health')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Readiness' }));
    expect(screen.getByText('Readiness Control Matrix')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Activity & Audit' }));
    expect(screen.getByText('Recorded Events')).toBeTruthy();
    expect(screen.queryByText(/performance review/i)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Offboarding' }));
    expect(screen.getByText('No Active Offboarding Case')).toBeTruthy();
  });
});
