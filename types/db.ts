// ── Siomac Database Types ────────────────────────────────────────────────────
// Row types mirror the Supabase schema exactly (snake_case column names).
// These are used by netlify/functions lib + routes and can be re-exported to
// a future React frontend via a shared package.

export type UserRole   = 'admin' | 'manager' | 'employee';
export type UserStatus = 'active' | 'inactive';
export type PayCycle   = 'daily' | 'weekly' | 'fortnightly' | 'monthly';
export type PayBasis   = 'salary' | 'hourly';

export interface AppUser {
  id:                          string;
  username:                    string;
  password_hash:               string;
  full_name:                   string;
  role:                        UserRole;
  status:                      UserStatus;
  department_id:               string | null;
  position:                    string | null;
  email:                       string | null;
  phone:                       string | null;
  employee_number:             string | null;
  profile_image:               string | null;
  signed_url:                  string | null;
  signed_url_expires_at:       string | null;
  color_scheme:                string | null;
  layout_mode:                 string | null;
  totp_secret:                 string | null;   // AES-256-GCM encrypted
  totp_enabled:                boolean;
  totp_enrolled_at:            string | null;
  backup_codes:                string[] | null;  // bcrypt-hashed, single-use
  pay_cycle:                   PayCycle | null;
  pay_basis:                   PayBasis | null;
  hourly_rate:                 number | null;
  monthly_salary:              number | null;
  standard_hours_per_day:      number | null;
  nis_applicable:              boolean | null;
  health_surcharge_applicable: boolean | null;
  tax_resident:                boolean | null;
  created_at:                  string | null;
  updated_at:                  string | null;
}

export type AttendanceStatus = 'present' | 'late' | 'absent';

export interface Attendance {
  id:                    string;
  user_id:               string;
  username:              string;
  work_date:             string;          // ISO date 'YYYY-MM-DD'
  check_in_time:         string | null;   // ISO timestamp
  check_out_time:        string | null;
  total_hours:           number | null;
  status:                AttendanceStatus | null;
  check_in_lat:          number | null;
  check_in_lng:          number | null;
  check_in_accuracy:     number | null;
  check_in_photo_url:    string | null;
  check_in_site_id:      string | null;
  check_in_distance_m:   number | null;
  check_out_lat:         number | null;
  check_out_lng:         number | null;
  check_out_accuracy:    number | null;
  check_out_photo_url:   string | null;
  check_out_site_id:     string | null;
  check_out_distance_m:  number | null;
  notes:                 string | null;
  updated_at:            string | null;
}

export interface Department {
  id:         string;
  name:       string;
  manager_id: string | null;
  created_at: string | null;
}

export type SiteStatus = 'active' | 'inactive' | 'completed';

export interface ProjectSite {
  id:          string;
  name:        string;
  address:     string | null;
  latitude:    number | string;   // Supabase numeric may come back as string
  longitude:   number | string;
  radius:      number | null;
  status:      SiteStatus | null;
  created_at:  string | null;
  updated_at:  string | null;
}

export interface ProjectSiteEmployee {
  site_id:    string;
  user_id:    string;
  assigned_at: string | null;
  // joined relation
  project_sites?: Pick<ProjectSite, 'name'>;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export type LeaveType   = 'sick' | 'casual' | 'annual' | 'medical' | string;

export interface LeaveRequest {
  id:             string;
  user_id:        string;
  username:       string;
  department_id:  string | null;
  type:           LeaveType;
  from_date:      string;
  to_date:        string;
  reason:         string | null;
  status:         LeaveStatus;
  reviewed_by:    string | null;
  reviewed_at:    string | null;
  created_at:     string | null;
  updated_at:     string | null;
}

export type PayrollStatus = 'draft' | 'pending' | 'approved' | 'paid';

export interface PayrollRun {
  id:           string;
  period_start: string;
  period_end:   string;
  status:       PayrollStatus;
  created_by:   string | null;
  approved_by:  string | null;
  approved_at:  string | null;
  created_at:   string | null;
  updated_at:   string | null;
}

export interface PayrollEntry {
  id:               string;
  payroll_run_id:   string;
  user_id:          string;
  username:         string;
  gross_pay:        number;
  paye:             number;
  nis:              number;
  health_surcharge: number;
  total_deductions: number;
  net_pay:          number;
  hours_worked:     number | null;
  pay_cycle:        PayCycle | null;
  pay_basis:        PayBasis | null;
  created_at:       string | null;
}

export interface HourlyRate {
  id:         string;
  user_id:    string;
  username:   string;
  rate:       number;
  effective_date: string;
  created_at: string | null;
}

export interface Setting {
  key:   string;
  value: string;
}

export interface ActivityLog {
  id:         string;
  user_id:    string;
  username:   string;
  action:     string;
  entity:     string;
  entity_id:  string;
  details:    string;
  created_at: string | null;
}

export interface Message {
  id:           string;
  from_user_id: string;
  from_username: string;
  to_user_id:   string | null;
  to_username:  string | null;
  subject:      string | null;
  body:         string;
  is_read:      boolean;
  created_at:   string | null;
}

export interface Ticket {
  id:          string;
  user_id:     string;
  username:    string;
  subject:     string;
  body:        string;
  status:      'open' | 'in_progress' | 'closed';
  priority:    'low' | 'medium' | 'high';
  created_at:  string | null;
  updated_at:  string | null;
}

export interface Notification {
  id:          string;
  user_id:     string;
  title:       string;
  body:        string;
  is_read:     boolean;
  link:        string | null;
  created_at:  string | null;
}
