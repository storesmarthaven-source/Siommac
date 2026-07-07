/**
 * netlify/functions/lib/finance/lookups.ts
 *
 * Wave 2B Phase 0 — shared lookup helpers consumed by all six 2B Finance pages.
 *
 * Functions exported:
 *   resolveEmployees(ids)         — bulk-resolve app_users IDs → name/no/dept
 *   listEmployeesForPicker(s)     — employee autocomplete options (active + inactive)
 *   listApprovedPayrollRuns(s)    — approved/locked/exported runs for the run picker
 *   listAuthorities()             — static remittance authority list
 *   listBudgetCategories(s)       — distinct categories from finance_budget_lines
 *
 * All list functions return lightweight DTOs sized for autocomplete use (≤ 50 rows).
 * `app_users.id` is TEXT throughout (not UUID).
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

export interface BudgetCategoryOption {
  value: string;
  label: string;
}

// ── Internal DB row shapes ────────────────────────────────────────────────────

interface DbUserRow {
  id: string;
  full_name: string | null;
  employee_number: string | null;
  department_id: string | null;
  position: string | null;
  status: string;
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
    .select('id, full_name, employee_number, department_id, position, status')
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
      fullName:    r.full_name ?? r.id,
      employeeNo:  r.employee_number ?? null,
      department:  r.department_id ? (deptMap.get(r.department_id) ?? null) : null,
      position:    r.position ?? null,
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

// ── Budget categories ─────────────────────────────────────────────────────────

/**
 * Built-in fallback budget categories displayed when the live DB has no rows yet.
 * Label is title-cased for display; value is the DB storage key.
 */
const FALLBACK_CATEGORIES: BudgetCategoryOption[] = [
  { value: 'salaries',          label: 'Salaries & Wages' },
  { value: 'benefits',          label: 'Employee Benefits' },
  { value: 'travel',            label: 'Travel & Transport' },
  { value: 'office',            label: 'Office & Supplies' },
  { value: 'professional_fees', label: 'Professional Fees' },
  { value: 'utilities',         label: 'Utilities' },
  { value: 'marketing',         label: 'Marketing & Advertising' },
  { value: 'repairs',           label: 'Repairs & Maintenance' },
  { value: 'equipment',         label: 'Equipment & Machinery' },
  { value: 'it',                label: 'IT & Technology' },
  { value: 'training',          label: 'Training & Development' },
  { value: 'other',             label: 'Other' },
];

/**
 * Return distinct budget category options.
 * Live categories (from finance_budget_lines) are shown first so existing values
 * always appear even if they aren't in the fallback list.
 * Falls back to the built-in list when the DB is empty.
 */
export async function listBudgetCategories(search?: string): Promise<BudgetCategoryOption[]> {
  // Fetch distinct categories from live data (no error throw — cosmetic)
  const { data } = await sb
    .from('finance_budget_lines')
    .select('category')
    .order('category', { ascending: true });

  const seen = new Set<string>();
  const live: BudgetCategoryOption[] = [];
  for (const r of (data ?? []) as Array<{ category: string }>) {
    if (!seen.has(r.category)) {
      seen.add(r.category);
      // Humanise the stored key: underscores → spaces, title-case each word
      const label = r.category
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      live.push({ value: r.category, label });
    }
  }

  // Merge live (keeps DB values first) then fallbacks not already present
  const merged = [
    ...live,
    ...FALLBACK_CATEGORIES.filter(f => !seen.has(f.value)),
  ];

  const filtered = search
    ? merged.filter(
        c =>
          c.label.toLowerCase().includes(search.toLowerCase()) ||
          c.value.toLowerCase().includes(search.toLowerCase()),
      )
    : merged;

  return filtered.slice(0, 50);
}
