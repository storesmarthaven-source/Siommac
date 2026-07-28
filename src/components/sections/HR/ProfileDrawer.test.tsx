import { fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileDrawer } from './ProfileDrawer';
import { resolveEmployeeMasterAccess, type EmployeeMasterAccess } from './employeeMasterAccess';

const employee = {
  id: 'emp-1', username: 'amara.diallo', full_name: 'Amara Diallo', first_name: 'Amara', last_name: 'Diallo', display_name: null,
  role: 'employee', status: 'active', employment_type: 'full_time', department_id: 'dept-1', site_id: 'site-1', position: 'Field Engineer',
  supervisor_id: 'manager-1', email: 'amara@siomac.test', personal_email: 'amara.personal@test', date_of_birth: '1992-02-18', nationality: 'Guinean',
  government_id: null, probation_end_date: null, employee_grade: 'G5', work_schedule: 'Standard', cost_center: 'OPS', phone: '555-0100',
  emergency_contact_name: null, emergency_contact_phone: null, emergency_contact_relationship: null, employee_number: 'EMP-0010', start_date: '2025-01-01',
  end_date: null, contractor_flag: false, profile_image_url: null, profile_image_pending_thumb_url: null, profile_image_pending_submitted_at: null,
  departmentName: 'Operations', siteName: 'Head Office', supervisorName: 'Asha Singh', workerType: 'employee' as const, trainingStatus: 'due_soon' as const,
  readiness: { percent: 67, assignmentComplete: true, payrollStatus: 'blocked' as const, trainingStatus: 'due_soon' as const, blockers: ['payroll', 'training'] as ('payroll' | 'training')[] },
};

const detail = { employee, statusHistory: [], currentAssignment: null, statutory: null, payrollReadiness: { status: 'blocked' as const, blockers: ['NIS'], financeHandoffEligible: false } };

vi.mock('@api/hr/employees', () => ({
  useHrEmployee: () => ({ data: detail, ready: true, isError: false }),
  useHrWorkflowSummary: () => ({ data: { employee_id: 'emp-1', open_count: 1, urgent_count: 0, items: [] }, isLoading: false, isError: false }),
  useHrAudit: () => ({ data: [], isLoading: false, isError: false }),
  useHrDocuments: () => ({ data: [], isLoading: false, isError: false }),
  useHrTrainingSummary: () => ({ data: { total: 2, current: 1, dueSoon: 1, expired: 0, pending: 0, certificates: [] }, isLoading: false, isError: false }),
  useVerifyHrDocument: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useArchiveHrDocument: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  getHrDocumentDownloadUrl: vi.fn(),
  useDecideHrEmployeePhoto: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@api/security', () => ({ useAdminUserSecurityStatus: () => ({ data: null, isSuccess: false }) }));
vi.mock('@lib/permissions', () => ({ can: () => false }));
vi.mock('@store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@components/nav/navCore', () => ({ showSection: vi.fn() }));
vi.mock('./EmployeeOnboardingSummary', () => ({ EmployeeOnboardingSummary: () => <div>Onboarding summary</div> }));

// Derive the full-capability map instead of listing fields: a new capability must
// not silently leave these fixtures behind (and un-exercised).
const access: EmployeeMasterAccess = resolveEmployeeMasterAccess(() => true);

afterEach(() => { document.body.innerHTML = ''; });

describe('Employee profile drawer', () => {
  it('uses the authoritative readiness contract and keeps actions in the pinned footer', () => {
    render(<ProfileDrawer employeeId="emp-1" onClose={vi.fn()} onAction={vi.fn()} access={access} />);

    expect(screen.getByText('67%')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText('Due Soon')).toBeTruthy();
    expect(screen.getByText('Payroll readiness is blocked')).toBeTruthy();

    const footer = document.querySelector('.ui-rdrawer-foot');
    expect(footer).toBeTruthy();
    expect(within(footer as HTMLElement).getByRole('button', { name: 'Request Change' })).toBeTruthy();
    expect(document.querySelector('.ui-panel-actions')).toBeNull();
    expect(document.querySelector('.ui-panel-stats:not(.is-plain)')).toBeNull();
  });

  it('uses the simplified production tabs and combines assignment history with employment', () => {
    render(<ProfileDrawer employeeId="emp-1" onClose={vi.fn()} onAction={vi.fn()} access={access} />);

    expect(screen.getByRole('button', { name: 'Compliance' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assignments' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Training' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attendance' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Employment' }));
    expect(screen.getByText('Employment Details')).toBeTruthy();
    expect(screen.getByText('Employment History')).toBeTruthy();
  });
});
