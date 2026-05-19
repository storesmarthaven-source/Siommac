/**
 * src/api/employees.ts
 *
 * Typed Supabase API functions for the Employee and Department domains.
 *
 * DESIGN:
 *   - Each function maps to one logical operation (list, get, add, update, delete)
 *   - Supabase query builder is used directly — no raw SQL
 *   - Sensitive fields (password_hash, totp_secret, backup_codes) are excluded
 *     from all SELECT queries so they never reach the frontend bundle
 *   - All functions accept an AbortSignal for TanStack Query cancellation support
 *   - Errors surface as thrown Error instances (TanStack Query catches these)
 *
 * @see docs/ARCHITECTURE.md §API-Layer
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { supabase }           from '@lib/supabase';
import { logger }             from '@lib/logger';
import type { AddEmployeePayload, UpdateEmployeePayload } from './schemas/employee';
import type { AddDepartmentPayload, UpdateDepartmentPayload } from './schemas/employee';

// ── Safe column list (never expose secrets) ───────────────────────────────────

const SAFE_USER_COLS = [
  'id', 'username', 'full_name', 'role', 'status',
  'department_id', 'position', 'email', 'phone', 'employee_number',
  'profile_image', 'signed_url', 'signed_url_expires_at',
  'color_scheme', 'layout_mode',
  'totp_enabled', 'totp_enrolled_at',
  'pay_cycle', 'pay_basis', 'hourly_rate', 'monthly_salary',
  'standard_hours_per_day',
  'nis_applicable', 'health_surcharge_applicable', 'tax_resident',
  'created_at', 'updated_at',
].join(', ');

// ── Employees ─────────────────────────────────────────────────────────────────

/**
 * List all employees (safe columns only).
 * Ordered by full_name for deterministic display.
 */
export async function listEmployees(signal?: AbortSignal) {
  const query = supabase
    .from('users')
    .select(SAFE_USER_COLS)
    .order('full_name', { ascending: true });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/employees] listEmployees failed', { error });
    throw new Error(error.message);
  }

  return data ?? [];
}

/**
 * List only active employees — used in dropdowns and assignment pickers.
 */
export async function listActiveEmployees(signal?: AbortSignal) {
  const query = supabase
    .from('users')
    .select(SAFE_USER_COLS)
    .eq('status', 'active')
    .order('full_name', { ascending: true });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/employees] listActiveEmployees failed', { error });
    throw new Error(error.message);
  }

  return data ?? [];
}

/**
 * Get a single employee by username.
 */
export async function getEmployee(username: string, signal?: AbortSignal) {
  let filterQuery = supabase
    .from('users')
    .select(SAFE_USER_COLS)
    .eq('username', username);

  if (signal) filterQuery = filterQuery.abortSignal(signal);

  const { data, error } = await filterQuery.single();

  if (error) {
    logger.error('[api/employees] getEmployee failed', { username, error });
    throw new Error(error.message);
  }

  return data;
}

/**
 * Add a new employee. Password hashing is handled server-side via a Netlify
 * function — this function calls the backend action endpoint rather than
 * inserting directly into Supabase (password must be hashed server-side).
 *
 * Delegates to the existing apiPost action for now; will be replaced with
 * a Supabase Edge Function call in Phase 2b.
 */
export async function addEmployee(payload: AddEmployeePayload): Promise<void> {
  // Temporarily delegates to the legacy apiPost pattern until Edge Functions
  // are in place for server-side password hashing.
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'addEmployee',
    payload as unknown as Record<string, unknown>,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to add employee.');
}

/**
 * Update an existing employee.
 * Note: password changes require a separate dedicated function (server-side hash).
 */
export async function updateEmployee(payload: UpdateEmployeePayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'updateEmployee',
    payload as unknown as Record<string, unknown>,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to update employee.');
}

/**
 * Soft-delete (deactivate) an employee by username.
 */
export async function deleteEmployee(username: string): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'deleteEmployee',
    { username },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to delete employee.');
}

// ── Departments ───────────────────────────────────────────────────────────────

/**
 * List all departments with their manager's name joined.
 */
export async function listDepartments(signal?: AbortSignal) {
  const query = supabase
    .from('departments')
    .select('id, name, manager_id, created_at')
    .order('name', { ascending: true });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/employees] listDepartments failed', { error });
    throw new Error(error.message);
  }

  return data ?? [];
}

/**
 * List employees eligible to be department managers (active, role manager or admin).
 */
export async function listManagers(signal?: AbortSignal) {
  const query = supabase
    .from('users')
    .select('id, username, full_name, role')
    .in('role', ['manager', 'admin'])
    .eq('status', 'active')
    .order('full_name', { ascending: true });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/employees] listManagers failed', { error });
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function addDepartment(payload: AddDepartmentPayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'addDepartment',
    payload as unknown as Record<string, unknown>,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to add department.');
}

export async function updateDepartment(payload: UpdateDepartmentPayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'updateDepartment',
    payload as unknown as Record<string, unknown>,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to update department.');
}

export async function deleteDepartment(id: string): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'deleteDepartment',
    { id },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to delete department.');
}
