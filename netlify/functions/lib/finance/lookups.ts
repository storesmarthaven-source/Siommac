/**
 * Shared lookup helpers for payroll, remittance, disbursement, and expense
 * workflows. Results are bounded for picker and display use.
 * app_users.id remains TEXT throughout.
 */

import { sb } from '../db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmployeeResolved {
  /** TEXT (app_users.id) */
  id: string;
  fullName: string;
  employeeNo: string | null;
  /** Human-readable department name (joined from departments table). */
  department: string | null;
  position: string | null;
  /** Public avatar URL, or null → the cell renders initials. */
  imageUrl: string | null;
}

export interface EmployeePickerOption {
  /** TEXT (app_users.id) */
  id: string;
  fullName: string;
  employeeNo: string | null;
  position: string | null;
  status: string;
}

export interface PayrollRunPickerOption {
  /** UUID stored as text */
  id: string;
  runNo: string;
  periodMonth: string; // YYYY-MM-DD
  payFrequency: string;
  status: string;
  employeeCount: number;
  netTotal: number;
}

export type RemittanceAuthority = 'paye_bir' | 'nis_nibtt' | 'health_surcharge';

export interface AuthorityOption {
  value: RemittanceAuthority;
  label: string;
  description: string;
}

// ── Internal DB row shapes ────────────────────────────────────────────────────

interface DbUserRow {
  id: string;
  full_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  employee_number: string | null;
  department_id: string | null;
  position: string | null;
  status: string;
  profile_image_url: string | null;
}

/** Best human-readable name for a user row — NEVER the raw id. full_name → "First Last" →
 *  email local-part → "Unknown". Used so no table/drawer anywhere renders a UUID as a name. */
function userDisplayName(r: DbUserRow): string {
  const full = r.full_name?.trim();
  if (full) return full;
  const composed = [r.first_name, r.last_name].map(s => s?.trim()).filter(Boolean).join(' ').trim();
  if (composed) return composed;
  const email = r.email?.trim();
  if (email) return email.split('@')[0] || email;
  return 'Unknown';
}

interface DbDeptRow {
  id: string;
  name: string;
}

interface DbRunRow {
  id: string;
  run_no: string;
  period_month: string;
  pay_frequency: string;
  status: string;
  employee_count: number;
  net_total: string | number;
}

// ── Resolve employees by ID ───────────────────────────────────────────────────

/**
 * Bulk-resolve employee IDs (TEXT, app_users.id) to display information.
 *
 * Used by tables and drawers that hold raw IDs (payroll lines, warnings, payslips,
 * bank-account rows, expense allocations). Callers receive a Map<id, EmployeeResolved>
 * for O(1) lookup per displayed row. Department names are joined from the `departments`
 * table in a second query to avoid PostgREST embed ambiguity.
 *
 * Returns an empty Map when ids is empty (no network round-trip).
 */
export async function resolveEmployees(ids: string[]): Promise<Map<string, EmployeeResolved>> {
  if (ids.length === 0) return new Map();

  // Deduplicate before querying
  const unique = [...new Set(ids)];

  const { data: users, error: usrErr } = await sb
    .from('app_users')
    .select('id, full_name, first_name, last_name, email, employee_number, department_id, position, status, profile_image_url')
    .in('id', unique);
  if (usrErr) throw Object.assign(new Error('resolveEmployees/users: ' + usrErr.message), { status: 500 });

  const rows = (users ?? []) as DbUserRow[];

  // Fetch department names for all encountered department IDs
  const deptIds = [...new Set(rows.map(r => r.department_id).filter((d): d is string => !!d))];
  const deptMap = new Map<string, string>();
  if (deptIds.length > 0) {
    const { data: depts, error: deptErr } = await sb
      .from('departments')
      .select('id, name')
      .in('id', deptIds);
    if (deptErr) {
      // Non-fatal: department names are cosmetic — log and continue
      console.warn('[finance/lookups] resolveEmployees/depts:', deptErr.message);
    } else {
      for (const d of (depts ?? []) as DbDeptRow[]) {
        deptMap.set(d.id, d.name);
      }
    }
  }

  const result = new Map<string, EmployeeResolved>();
  for (const r of rows) {
    result.set(r.id, {
      id:          r.id,
      fullName:    userDisplayName(r),
      employeeNo:  r.employee_number ?? null,
      department:  r.department_id ? (deptMap.get(r.department_id) ?? null) : null,
      position:    r.position ?? null,
      imageUrl:    r.profile_image_url ?? null,
    });
  }
  return result;
}

// ── Employee picker list ──────────────────────────────────────────────────────

/**
 * Lightweight employee list for picker comboboxes (employee selectors in
 * Disbursements bank-account forms, Expenses allocations, etc.).
 *
 * Returns active + inactive employees (not superadmins).
 * Searchable by full_name, employee_number, or position.
 */
export async function listEmployeesForPicker(search?: string): Promise<EmployeePickerOption[]> {
  let q = sb
    .from('app_users')
    .select('id, full_name, employee_number, position, status')
    .neq('role', 'superadmin')
    .in('status', ['active', 'inactive'])
    .order('full_name', { ascending: true });

  if (search) {
    const esc = search.replace(/[%_]/g, ch => '\\' + ch);
    q = q.or(`full_name.ilike.%${esc}%,employee_number.ilike.%${esc}%,position.ilike.%${esc}%`);
  }

  const { data, error } = await q.limit(50);
  if (error) throw Object.assign(new Error('listEmployeesForPicker: ' + error.message), { status: 500 });

  return (data ?? []).map(r => {
    const u = r as DbUserRow;
    return {
      id:          u.id,
      fullName:    u.full_name ?? u.id,
      employeeNo:  u.employee_number ?? null,
      position:    u.position ?? null,
      status:      u.status,
    };
  });
}

// ── Approved payroll runs ─────────────────────────────────────────────────────

const APPROVED_RUN_STATUSES = ['approved', 'locked', 'exported'] as const;

/**
 * List payroll runs in an immutable state (approved / locked / exported).
 * Used by the "run picker" in Remittances and Disbursements create flows,
 * replacing the old free-text run UUID input.
 */
export async function listApprovedPayrollRuns(search?: string): Promise<PayrollRunPickerOption[]> {
  let q = sb
    .from('finance_payroll_runs')
    .select('id, run_no, period_month, pay_frequency, status, employee_count, net_total')
    .in('status', [...APPROVED_RUN_STATUSES])
    .order('period_month', { ascending: false });

  if (search) {
    const esc = search.replace(/[%_]/g, ch => '\\' + ch);
    // period_month is a date column — cast to text for ILIKE search
    q = q.or(`run_no.ilike.%${esc}%`);
  }

  const { data, error } = await q.limit(50);
  if (error) throw Object.assign(new Error('listApprovedPayrollRuns: ' + error.message), { status: 500 });

  return (data ?? []).map(r => {
    const u = r as DbRunRow;
    return {
      id:            u.id,
      runNo:         u.run_no,
      periodMonth:   u.period_month,
      payFrequency:  u.pay_frequency,
      status:        u.status,
      employeeCount: u.employee_count,
      netTotal:      Number(u.net_total),
    };
  });
}

// ── Remittance authorities (static) ──────────────────────────────────────────

/**
 * Static list of statutory remittance authorities for Trinidad & Tobago.
 * Not backed by a DB config table — these are fixed by law.
 * Mirrors the `authority` check constraint on finance_remittances.
 */
export function listAuthorities(): AuthorityOption[] {
  return [
    {
      value:       'paye_bir',
      label:       'PAYE — Board of Inland Revenue',
      description: 'Monthly employee PAYE income-tax remittance to BIR',
    },
    {
      value:       'nis_nibtt',
      label:       'NIS — NIBTT',
      description: 'Employee + employer National Insurance contributions to NIBTT',
    },
    {
      value:       'health_surcharge',
      label:       'Health Surcharge',
      description: 'Monthly Health Surcharge deductions (employee only)',
    },
  ];
}
