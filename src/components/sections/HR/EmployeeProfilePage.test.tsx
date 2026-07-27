import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { EmployeeProfilePage } from './EmployeeProfilePage';
import type { EmployeeMasterAccess } from './employeeMasterAccess';

const employee = {
  id: 'emp-1', username: 'damani.baptiste', full_name: 'Damani Baptiste', first_name: 'Damani', last_name: 'Baptiste', display_name: null,
  role: 'employee', status: 'active', employment_type: 'permanent', department_id: 'dept-1', site_id: 'site-1', position: 'Project Manager',
  supervisor_id: 'manager-1', email: 'damani@siomac.test', personal_email: null, date_of_birth: null, nationality: 'Trinidad and Tobago',
  government_id: null, probation_end_date: '2022-09-12', employee_grade: null, work_schedule: 'Full-Time', cost_center: 'ADMIN', phone: '868-555-0147',
  emergency_contact_name: 'Althea Baptiste', emergency_contact_phone: '868-555-2190', emergency_contact_relationship: 'Spouse',
  employee_number: 'EMP-0021', start_date: '2021-03-12', end_date: null, contractor_flag: false, profile_image_url: null,
  profile_image_pending_thumb_url: null, profile_image_pending_submitted_at: null, departmentName: 'Administration',
  siteName: 'Port of Spain Office', supervisorName: 'Lila Auguste', workerType: 'employee' as const, trainingStatus: 'due_soon' as const,
  readiness: { percent: 67, assignmentComplete: true, payrollStatus: 'blocked' as const, trainingStatus: 'due_soon' as const, blockers: ['payroll', 'training'] as ('payroll' | 'training')[] },
  offboardingActive: false,
};
const detail = { employee, statusHistory: [], currentAssignment: null, statutory: null, payrollReadiness: { status: 'blocked' as const, blockers: ['NIS'], financeHandoffEligible: false } };

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
vi.mock('@lib/permissions', () => ({ can: () => false }));
vi.mock('@components/nav/navCore', () => ({ showSection: vi.fn() }));
vi.mock('@store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./EmployeeOnboardingSummary', () => ({ EmployeeOnboardingSummary: () => null }));

const access: EmployeeMasterAccess = {
  createEmployee: true, importEmployees: true, startOnboarding: true,
  requestChange: true, editEmployee: true, editContact: true, changeStatus: true, startOffboarding: true,
  viewDocuments: true, uploadDocument: true, downloadDocument: true, verifyDocument: true, archiveDocument: true,
  viewStatutory: true, editStatutory: true, viewTraining: true, viewOnboarding: true, viewAudit: true,
};

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
    expect(screen.getByText('Payroll readiness is blocked')).toBeTruthy();
  });

  it('keeps deep employment work on its own page and does not fabricate restricted finance data', () => {
    render(<EmployeeProfilePage employeeId="emp-1" access={access} onBack={vi.fn()} onAction={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Employment' }));

    expect(screen.getByText('Employment Details')).toBeTruthy();
    expect(screen.getByText('Employment History')).toBeTruthy();
    expect(screen.getByText('Pay Administration & Legal Employer')).toBeTruthy();
    expect(screen.getByText(/require the corresponding Finance capabilities/i)).toBeTruthy();
  });
});
