/**
 * src/components/sections/Payroll/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost }           from '@lib/api';
import type {
  PayrollRunData,
  Department,
  EmployeeListItem,
  PayCycle,
} from './types';

interface ApiResponse { success: boolean; message?: string; }

// ── Payroll run ───────────────────────────────────────────────────────────────

interface RunPayrollResponse extends ApiResponse {
  data?: PayrollRunData;
}

export async function listPayrollRun(params: {
  dateFrom:    string;
  dateTo:      string;
  cycle:       string;
  overrides?:  Record<string, unknown>;
  department?: string | null;
  employeeIds?: string[] | null;
}, signal?: AbortSignal): Promise<PayrollRunData> {
  const res = await apiPost<RunPayrollResponse>('listPayrollRun', params, signal ? { signal } : undefined);
  if (!res.success || !res.data) throw new Error(res.message ?? 'Payroll run failed');
  return res.data;
}

// ── Departments ───────────────────────────────────────────────────────────────

interface DeptResponse extends ApiResponse { data?: Department[]; }

export async function listDepartments(signal?: AbortSignal): Promise<Department[]> {
  const res = await apiPost<DeptResponse>('listDepartments', {}, signal ? { signal } : undefined);
  return (res.success && res.data) ? res.data : [];
}

// ── Employees ─────────────────────────────────────────────────────────────────

interface EmpResponse extends ApiResponse { data?: EmployeeListItem[]; }

export async function listEmployees(signal?: AbortSignal): Promise<EmployeeListItem[]> {
  const res = await apiPost<EmpResponse>('listEmployees', {}, signal ? { signal } : undefined);
  return (res.success && res.data) ? res.data : [];
}

// ── Employee payroll settings ─────────────────────────────────────────────────

export async function updateEmployeePayroll(params: {
  userId:                    string;
  payCycle:                  PayCycle;
  payBasis:                  string;
  hourlyRate:                string | number;
  monthlySalary:             string | number;
  standardHoursPerDay:       string | number;
  nisApplicable:             boolean;
  healthSurchargeApplicable: boolean;
  taxResident:               boolean;
}, signal?: AbortSignal): Promise<{ success: boolean; message?: string }> {
  return apiPost<ApiResponse>('updateEmployeePayroll', params, signal ? { signal } : undefined);
}

// ── Payroll approval ──────────────────────────────────────────────────────────

export async function approvePayroll(params: {
  rows:        unknown[];
  dateFrom:    string;
  dateTo:      string;
  cycleFilter: string;
  approvedBy:  string;
}, signal?: AbortSignal): Promise<{ success: boolean; message?: string }> {
  return apiPost<ApiResponse>('approvePayroll', params, signal ? { signal } : undefined);
}

// ── Payroll constants ─────────────────────────────────────────────────────────

interface ConstantsResponse extends ApiResponse { data?: Record<string, number>; }

export async function verifyPassword(password: string, signal?: AbortSignal): Promise<{ success: boolean; message?: string }> {
  return apiPost<ApiResponse>('verifyPassword', { password }, signal ? { signal } : undefined);
}

export async function getPayrollConstants(signal?: AbortSignal): Promise<Record<string, number>> {
  const res = await apiPost<ConstantsResponse>('getPayrollConstants', {}, signal ? { signal } : undefined);
  return (res.success && res.data) ? res.data : {};
}

export async function savePayrollConstants(constants: Record<string, number>, signal?: AbortSignal): Promise<{ success: boolean; message?: string }> {
  return apiPost<ApiResponse>('savePayrollConstants', { constants }, signal ? { signal } : undefined);
}

// ── Statutory estimate helper ─────────────────────────────────────────────────

/** Replicate the T&T statutory math from payroll.js. */
export function calcStatutoryEstimate(params: {
  cycle:       string;
  basis:       string;
  salary:      number;
  rate:        number;
  stdHrs:      number;
  nisOn:       boolean;
  hsOn:        boolean;
  taxOn:       boolean;
}): { gross: number; nis: number; hs: number; paye: number; net: number } {
  const { cycle, basis, salary, rate, stdHrs, nisOn, hsOn, taxOn } = params;
  const WORK_DAYS: Record<string, number> = { daily: 1, weekly: 5, fortnightly: 10, monthly: 22 };
  const workDays   = WORK_DAYS[cycle] ?? 22;
  const hoursWorked = workDays * stdHrs;
  const gross      = basis === 'hourly' ? rate * hoursWorked : salary;

  const nisCaps: Record<string, number> = { daily: 626.15, weekly: 3138.46, fortnightly: 6276.92, monthly: 13600 };
  const nisCap  = nisCaps[cycle] ?? 13600;
  const nis     = nisOn ? Math.min(gross * 0.06, nisCap) : 0;

  const weeklyGross = cycle === 'weekly' ? gross
    : cycle === 'daily'        ? gross * 5
    : cycle === 'fortnightly'  ? gross / 2
    : gross / (52 / 12);
  const hsHigh: Record<string, number> = { daily: 1.65, weekly: 8.25, fortnightly: 16.50, monthly: 33.00 };
  const hsLow:  Record<string, number> = { daily: 0.30, weekly: 1.50, fortnightly:  3.00, monthly:  6.00 };
  const hs = hsOn ? (weeklyGross > 469.99 ? (hsHigh[cycle] ?? 33) : (hsLow[cycle] ?? 6)) : 0;

  const annualMult: Record<string, number> = { daily: 260, weekly: 52, fortnightly: 26, monthly: 12 };
  const annualGross = gross * (annualMult[cycle] ?? 12);
  const allowance   = taxOn ? 90_000 : 0;
  const taxable     = Math.max(0, annualGross - allowance);
  const annualPaye  = taxable <= 1_000_000
    ? taxable * 0.25
    : 1_000_000 * 0.25 + (taxable - 1_000_000) * 0.30;
  const paye = taxOn ? annualPaye / (annualMult[cycle] ?? 12) : 0;

  return { gross, nis, hs, paye, net: gross - nis - hs - paye };
}
