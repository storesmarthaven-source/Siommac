/**
 * src/api/employees.ts
 *
 * Typed client for the Employee and Department domains.
 *
 * ENTERPRISE DATA-ACCESS RULE (spec §2): protected ERP data is read ONLY through
 * the authenticated Netlify JWT API — never via a direct browser Supabase read.
 * The browser Supabase client is not authenticated as the app user (this app
 * uses Netlify-issued JWTs, not Supabase Auth), so direct reads are both a
 * security violation and broken at runtime. Every function below therefore goes
 * through apiPost → the protected `employeesRouter` routes.
 *
 * @see netlify/functions/routes/employees.ts
 * @see docs/ARCHITECTURE.md §API-Layer
 */

import { apiPost } from '@lib/api';
import type { ApiResponse } from '../../types/api';
import type { AddEmployeePayload, UpdateEmployeePayload } from './schemas/employee';
import type { AddDepartmentPayload, UpdateDepartmentPayload } from './schemas/employee';

type SignalOpt = AbortSignal | undefined;
const opt = (signal: SignalOpt) => (signal ? { signal } : undefined);

function unwrap<T>(res: ApiResponse & { data?: T }, fallback: T, what: string): T {
  if (!res.success) throw new Error(res.message ?? `Failed to ${what}.`);
  return (res.data ?? fallback);
}

// ── User directory (pickers / dropdowns) ──────────────────────────────────────

/**
 * Lightweight active-user option, used by every assignee / reviewer / owner /
 * worker picker. Backed by /listUserOptions (any authenticated user; no
 * sensitive fields). This is the canonical "pick a person" source.
 */
export interface UserOption {
  id: string;
  full_name: string | null;
  username: string;
  role: string | null;
  departmentId: string | null;
}

/** Active users (excluding superadmin) for assignment pickers. */
export async function listActiveEmployees(signal?: SignalOpt): Promise<UserOption[]> {
  const res = await apiPost<ApiResponse & { data?: UserOption[] }>('listUserOptions', {}, opt(signal));
  return unwrap(res, [], 'load users');
}

// ── Employees (full records — admin / manager) ────────────────────────────────

/** Full employee list (rich record incl. department, attendance status). */
export async function listEmployees<T = unknown>(signal?: SignalOpt): Promise<T[]> {
  const res = await apiPost<ApiResponse & { data?: T[] }>('listEmployees', {}, opt(signal));
  return unwrap(res, [], 'load employees');
}

/** Single employee by username. */
export async function getEmployee<T = unknown>(username: string, signal?: SignalOpt): Promise<T> {
  const res = await apiPost<ApiResponse & { data?: T }>('getEmployeeByUsername', { username }, opt(signal));
  if (!res.success) throw new Error(res.message ?? 'Failed to load employee.');
  return res.data as T;
}

export async function addEmployee(payload: AddEmployeePayload): Promise<void> {
  const res = await apiPost<ApiResponse>('addEmployee', payload as unknown as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? 'Failed to add employee.');
}

export async function updateEmployee(payload: UpdateEmployeePayload): Promise<void> {
  const res = await apiPost<ApiResponse>('updateEmployee', payload as unknown as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? 'Failed to update employee.');
}

export async function deleteEmployee(username: string): Promise<void> {
  const res = await apiPost<ApiResponse>('deleteEmployee', { username });
  if (!res.success) throw new Error(res.message ?? 'Failed to delete employee.');
}

// ── Departments ───────────────────────────────────────────────────────────────

export async function listDepartments<T = unknown>(signal?: SignalOpt): Promise<T[]> {
  const res = await apiPost<ApiResponse & { data?: T[] }>('listDepartments', {}, opt(signal));
  return unwrap(res, [], 'load departments');
}

/** Active managers / admins eligible to lead a department. */
export async function listManagers<T = unknown>(signal?: SignalOpt): Promise<T[]> {
  const res = await apiPost<ApiResponse & { data?: T[] }>('listManagers', {}, opt(signal));
  return unwrap(res, [], 'load managers');
}

export async function addDepartment(payload: AddDepartmentPayload): Promise<void> {
  const res = await apiPost<ApiResponse>('addDepartment', payload as unknown as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? 'Failed to add department.');
}

export async function updateDepartment(payload: UpdateDepartmentPayload): Promise<void> {
  const res = await apiPost<ApiResponse>('updateDepartment', payload as unknown as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? 'Failed to update department.');
}

export async function deleteDepartment(id: string): Promise<void> {
  const res = await apiPost<ApiResponse>('deleteDepartment', { id });
  if (!res.success) throw new Error(res.message ?? 'Failed to delete department.');
}
