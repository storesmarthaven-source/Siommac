/**
 * src/components/sections/Employees/types.ts
 *
 * Canonical frontend types for the Employees feature domain.
 * These are camelCase API response shapes — the backend returns camelCase JSON.
 * Keep these in sync with the Zod schemas in netlify/functions/lib/validate.ts.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

// ── Shared primitives ─────────────────────────────────────────────────────────

export type UserRole        = 'superadmin' | 'admin' | 'manager' | 'employee';
export type UserStatus      = 'active' | 'inactive';
export type TodayStatus     = 'checkedin' | 'checkedout' | 'notchecked';
export type PayCycle        = 'daily' | 'weekly' | 'fortnightly' | 'monthly';
export type PayBasis        = 'salary' | 'hourly';
// LeaveStatus / LeaveType / SubmitLeavePayload / UpdateLeavePayload / LeaveRequest REMOVED.
// Legacy leave types retired with the legacy leave system. Use types/hrLeave.ts instead.
export type AttendanceStatus = 'present' | 'late' | 'absent';

// ── Employee (list view — from listEmployees) ─────────────────────────────────

export interface EmployeeListItem {
  idx:            number;
  id:             string;
  username:       string;
  fullName:       string;
  employeeNumber: string;
  department:     string;
  departmentId:   string;
  position:       string;
  role:           UserRole;
  status:         'Active' | 'Inactive';    // backend returns capitalised
  email:          string;
  phone:          string;
  payCycle:       PayCycle | '';
  todayStatus:    TodayStatus;
  profileImage:   string;
}

// ── Employee (detail view — from getEmployeeByUsername) ───────────────────────

export interface EmployeeDetail {
  id:                          string;
  username:                    string;
  fullName:                    string;
  role:                        UserRole;
  employeeNumber:              string;
  departmentId:                string;
  department:                  string;
  position:                    string;
  status:                      UserStatus;
  email:                       string;
  phone:                       string;
  colorScheme:                 string;
  layoutMode:                  string;
  hourlyRate:                  number;
  profileImage:                string;
  payCycle:                    PayCycle;
  payBasis:                    PayBasis;
  monthlySalary:               number;
  standardHoursPerDay:         number;
  nisApplicable:               boolean;
  healthSurchargeApplicable:   boolean;
  taxResident:                 boolean;
}

// ── Add / Update payloads ─────────────────────────────────────────────────────

export interface AddEmployeePayload {
  username:                    string;
  password:                    string;
  fullName:                    string;
  role:                        UserRole;
  department?:                 string;
  position?:                   string;
  employeeNumber?:             string;
  email?:                      string;
  phone?:                      string;
  payCycle?:                   PayCycle;
  payBasis?:                   PayBasis;
  hourlyRate?:                 number;
  monthlySalary?:              number;
  standardHoursPerDay?:        number;
  nisApplicable?:              boolean;
  healthSurchargeApplicable?:  boolean;
  taxResident?:                boolean;
}

export interface UpdateEmployeePayload {
  username:                    string;
  fullName?:                   string;
  role?:                       UserRole;
  department?:                 string;
  position?:                   string;
  status?:                     UserStatus;
  employeeNumber?:             string;
  email?:                      string;
  phone?:                      string;
  password?:                   string;
  payCycle?:                   PayCycle;
  payBasis?:                   PayBasis;
  hourlyRate?:                 number;
  monthlySalary?:              number;
  standardHoursPerDay?:        number;
  nisApplicable?:              boolean;
  healthSurchargeApplicable?:  boolean;
  taxResident?:                boolean;
  profileImageBase64?:         string;
  removeProfileImage?:         boolean;
}

// ── Department ────────────────────────────────────────────────────────────────

export interface Department {
  id:            string;
  name:          string;
  description:   string;
  managerId:     string;
  manager:       string;
  employeeCount: number;
}

export interface Manager {
  id:   string;
  name: string;
}

export interface AddDepartmentPayload {
  name:       string;
  managerId?: string;
}

export interface UpdateDepartmentPayload {
  id:          string;
  name?:       string;
  managerId?:  string;
}

// ── Attendance history (employee self-service) ────────────────────────────────

export interface HistoryRecord {
  date:              string;   // YYYY-MM-DD
  checkIn:           string | null;
  checkOut:          string | null;
  hours:             number | null;
  status:            AttendanceStatus | null;
  checkInPhotoUrl:   string | null;
  checkOutPhotoUrl:  string | null;
}

// Legacy Payslip DTO REMOVED — ESS payslips use the canonical Finance
// Payslip DTO from @api/finance/payroll (rendered by MyPayslipsOverview).

// ── Manager dashboard ─────────────────────────────────────────────────────────

export interface DeptStats {
  total:   number;
  present: number;
  onLeave: number;
  late:    number;
}

export interface DeptEmployee {
  name:         string;
  position:     string;
  status:       TodayStatus;
  lastActivity: string | null;
  location:     string;
}

// ── Admin dashboard ───────────────────────────────────────────────────────────

export interface AdminStats {
  totalEmployees:  number;
  presentToday:    number;
  absentToday:     number;
  onLeaveToday:    number;
  lateToday:       number;
  activeLocations: number;
  // Legacy aliases (kept for backward compat)
  activeEmployees?: number;
  checkedIn?:       number;
  departments?:     number;
}

export interface RecentAttendanceRow {
  name:        string;
  department:  string;
  checkIn?:    string;
  checkOut?:   string;
  status?:     string;
  // Legacy aliases (kept for backward compat)
  username?:      string;
  fullName?:      string;
  action?:        string;
  time?:          string;
  profileImage?:  string;
}

// CompanyInfo / StatutoryRates REMOVED — they existed solely for the retired
// legacy payslip print view (company block + rate footnotes).
