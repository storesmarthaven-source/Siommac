import { describe, expect, it } from 'vitest';
import {
  findCachedHrEmployeeRow,
  type HrEmployeePage,
  type HrEmployeeRow,
} from '../../src/api/hr/employees';

function row(id: string, name: string): HrEmployeeRow {
  return {
    id,
    username: id,
    full_name: name,
    first_name: name,
    last_name: null,
    display_name: null,
    role: 'employee',
    status: 'active',
    accountStatus: 'active',
    employment_type: 'full_time',
    department_id: null,
    site_id: null,
    position: null,
    supervisor_id: null,
    email: null,
    personal_email: null,
    date_of_birth: null,
    nationality: null,
    government_id: null,
    probation_end_date: null,
    employee_grade: null,
    work_schedule: null,
    cost_center: null,
    phone: null,
    mobile_phone: null,
    created_at: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    employee_number: null,
    start_date: null,
    end_date: null,
    contractor_flag: false,
    profile_image_url: null,
    profile_image_pending_thumb_url: null,
    profile_image_pending_submitted_at: null,
    departmentName: null,
    siteName: null,
    supervisorName: null,
    workerType: 'employee',
    trainingStatus: 'none',
    readiness: null,
    offboardingActive: false,
  };
}

describe('Employee detail placeholder cache lookup', () => {
  const first = row('employee-1', 'First Employee');
  const second = row('employee-2', 'Second Employee');

  it('finds either employee in the server-paginated Employee Master cache', () => {
    const page: HrEmployeePage = {
      rows: [first, second],
      meta: {
        total: 2,
        page: 1,
        pageSize: 25,
        departments: [],
        statuses: ['active'],
        employmentTypes: ['full_time'],
        trainingStatuses: ['none'],
      },
    };

    expect(findCachedHrEmployeeRow(page, 'employee-1')).toBe(first);
    expect(findCachedHrEmployeeRow(page, 'employee-2')).toBe(second);
  });

  it('supports the legacy array cache and never substitutes another employee', () => {
    expect(findCachedHrEmployeeRow([first, second], 'employee-2')).toBe(second);
    expect(findCachedHrEmployeeRow([first], 'employee-2')).toBeUndefined();
    expect(findCachedHrEmployeeRow(undefined, 'employee-1')).toBeUndefined();
  });
});
