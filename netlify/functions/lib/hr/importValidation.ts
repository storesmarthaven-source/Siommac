// lib/hr/importValidation.ts — field-format and within-file validation for Employee
// Import (audit 2026-07-26, findings P1-5 and P1-6).
//
// The validator previously checked only required-ness, worker/employment type, department
// resolution and database duplicates. Everything else — malformed emails, impossible
// dates, bad NIS statuses, over-long values, and rows that collide with EACH OTHER inside
// the same file — survived validation and surfaced at commit as an opaque row failure,
// after the operator had already approved the batch.
//
// Pure functions: no DB, no I/O. Registry-backed checks (department, site, supervisor)
// stay in the route where the lookups live.

import { NIS_STATUSES } from './employeeCore';

export interface FieldError {
  fieldKey: string | null;
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  resolutionRequired: boolean;
}

const err = (fieldKey: string, code: string, message: string): FieldError =>
  ({ fieldKey, code, severity: 'error', message, resolutionRequired: true });

/** Column length ceilings. Values beyond these are refused rather than silently
 *  truncated by the database — a truncated employee number or email is corrupt data. */
export const FIELD_MAX_LENGTH: Record<string, number> = {
  firstName: 80, lastName: 80, fullName: 160, username: 60,
  employeeNumber: 32, email: 160, phone: 40, position: 120,
  nationality: 60, nisNumber: 40, birFileNumber: 40,
};

const EMPLOYEE_NUMBER_RE = /^EMP-\d{4,}$/i;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,59}$/i;
// Deliberately permissive but structural: local@domain.tld with no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar-real ISO date (rejects 2026-02-31, which Date() would roll over). */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Format and range validation for one mapped row.
 * Required-ness, registry resolution and duplicate handling stay with the caller.
 */
export function validateFieldFormats(
  m: Record<string, string>,
  today: string = new Date().toISOString().slice(0, 10),
): FieldError[] {
  const out: FieldError[] = [];
  const v = (k: string): string => (m[k] ?? '').trim();

  for (const [field, max] of Object.entries(FIELD_MAX_LENGTH)) {
    const value = v(field);
    if (value.length > max) {
      out.push(err(field, 'value_too_long', `${field} is longer than ${max} characters`));
    }
  }

  const empNo = v('employeeNumber');
  if (empNo && !EMPLOYEE_NUMBER_RE.test(empNo)) {
    out.push(err('employeeNumber', 'invalid_employee_number', `employee number "${empNo}" must look like EMP-0001`));
  }

  const username = v('username');
  if (username && !USERNAME_RE.test(username)) {
    out.push(err('username', 'invalid_username',
      'username must be 3-60 characters of letters, numbers, dot, underscore or hyphen, starting alphanumeric'));
  }

  const email = v('email');
  if (email && !EMAIL_RE.test(email)) {
    out.push(err('email', 'invalid_email', `"${email}" is not a valid email address`));
  }

  const nisStatus = v('nisStatus');
  if (nisStatus && !(NIS_STATUSES as readonly string[]).includes(nisStatus)) {
    out.push(err('nisStatus', 'invalid_nis_status',
      `NIS status must be one of ${NIS_STATUSES.join(', ')}`));
  }

  // Dates: format, calendar reality, then relationships.
  const dob = v('dateOfBirth');
  const start = v('startDate');
  for (const [field, value] of [['dateOfBirth', dob], ['startDate', start]] as const) {
    if (value && !isRealIsoDate(value)) {
      out.push(err(field, 'invalid_date', `${field} must be a real date in YYYY-MM-DD format`));
    }
  }
  if (dob && isRealIsoDate(dob)) {
    if (dob >= today) out.push(err('dateOfBirth', 'dob_not_past', 'date of birth must be in the past'));
    else {
      // Guards against a mistyped century as much as against child labour.
      const age = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
      if (age > 100) out.push(err('dateOfBirth', 'dob_implausible', 'date of birth is more than 100 years ago'));
      if (age < 14) out.push(err('dateOfBirth', 'dob_underage', 'employee would be under 14 years old'));
    }
  }
  if (dob && start && isRealIsoDate(dob) && isRealIsoDate(start) && start <= dob) {
    out.push(err('startDate', 'start_before_birth', 'start date must be after the date of birth'));
  }

  return out;
}

/**
 * Detects rows that collide with EACH OTHER inside one file.
 *
 * Database duplicates were checked; two rows in the same CSV claiming the same employee
 * number, username or email were not — so the first created the record and the second
 * failed opaquely at commit, or worse, both were created under different numbers.
 *
 * Call `check` once per row, in row order. The FIRST row to claim a value is clean; every
 * later claimant is reported against the row that took it.
 */
export class WithinFileDuplicates {
  private readonly seen: Record<'employeeNumber' | 'username' | 'email', Map<string, number>> = {
    employeeNumber: new Map(), username: new Map(), email: new Map(),
  };

  check(rowNo: number, values: { employeeNumber?: string; username?: string; email?: string }): FieldError[] {
    const out: FieldError[] = [];
    const fields = [
      ['employeeNumber', values.employeeNumber?.trim().toUpperCase()],
      ['username', values.username?.trim().toLowerCase()],
      ['email', values.email?.trim().toLowerCase()],
    ] as const;

    for (const [field, value] of fields) {
      if (!value) continue;
      const first = this.seen[field].get(value);
      if (first !== undefined) {
        out.push(err(field, 'duplicate_within_file',
          `${field} "${value}" is already used by row ${first} in this file`));
      } else {
        this.seen[field].set(value, rowNo);
      }
    }
    return out;
  }
}
