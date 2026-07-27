import type { EmployeeSortCol } from '@api/hr/employees';
import {
  EMPLOYEE_REGISTER_COLUMN_KEYS,
  sanitizeEmployeeRegisterColumnKeys,
  type EmployeeRegisterColumnKey,
} from '../../../../types/uiPreferences';

export type { EmployeeRegisterColumnKey } from '../../../../types/uiPreferences';

export interface EmployeeRegisterColumn {
  key: EmployeeRegisterColumnKey;
  label: string;
  sortKey?: EmployeeSortCol;
  required?: boolean;
  minWidth: number;
}

export const EMPLOYEE_REGISTER_COLUMNS: readonly EmployeeRegisterColumn[] = [
  { key: 'employee', label: 'Employee', sortKey: 'full_name', required: true, minWidth: 250 },
  { key: 'employeeNumber', label: 'Employee No.', sortKey: 'employee_number', minWidth: 125 },
  { key: 'position', label: 'Position', minWidth: 160 },
  { key: 'department', label: 'Department', sortKey: 'department_id', minWidth: 145 },
  { key: 'site', label: 'Site', minWidth: 135 },
  { key: 'supervisor', label: 'Supervisor', minWidth: 170 },
  { key: 'employmentType', label: 'Employment Type', sortKey: 'employment_type', minWidth: 145 },
  { key: 'status', label: 'Status', sortKey: 'status', minWidth: 115 },
  { key: 'readiness', label: 'Readiness', minWidth: 155 },
  { key: 'trainingStatus', label: 'Training Status', minWidth: 135 },
  { key: 'actions', label: 'Actions', required: true, minWidth: 72 },
] as const;

/** The recommended default set. A user's PERSISTED choice always wins — sanitize() only falls
 *  back to this when there is no saved preference — so changing it never overwrites anyone. */
export const DEFAULT_EMPLOYEE_REGISTER_COLUMNS: readonly EmployeeRegisterColumnKey[] = [
  'employee',
  'employeeNumber',
  'position',
  'department',
  'site',
  'supervisor',
  'status',
  'readiness',
  'actions',
];

/** Reconcile a persisted preference with the current, ordered column contract. */
export function sanitizeEmployeeRegisterColumns(value: unknown): EmployeeRegisterColumnKey[] {
  return sanitizeEmployeeRegisterColumnKeys(value) ?? [...DEFAULT_EMPLOYEE_REGISTER_COLUMNS];
}

export function employeeRegisterTableMinWidth(columns: readonly EmployeeRegisterColumnKey[]): number {
  const visible = new Set(sanitizeEmployeeRegisterColumns(columns));
  return Math.max(620, EMPLOYEE_REGISTER_COLUMNS.reduce(
    (width, column) => width + (visible.has(column.key) ? column.minWidth : 0),
    0,
  ));
}

const STORAGE_VERSION = 1;

export function employeeRegisterColumnStorageKey(userId: string): string {
  return `siomac.table-columns.v${STORAGE_VERSION}.${userId}.hr.employee-register`;
}

export function readEmployeeRegisterColumns(userId: string | null): EmployeeRegisterColumnKey[] {
  if (!userId || typeof localStorage === 'undefined') return [...DEFAULT_EMPLOYEE_REGISTER_COLUMNS];
  try {
    const raw = localStorage.getItem(employeeRegisterColumnStorageKey(userId));
    return raw == null ? [...DEFAULT_EMPLOYEE_REGISTER_COLUMNS] : sanitizeEmployeeRegisterColumns(JSON.parse(raw));
  } catch {
    return [...DEFAULT_EMPLOYEE_REGISTER_COLUMNS];
  }
}

export function writeEmployeeRegisterColumns(userId: string | null, columns: readonly EmployeeRegisterColumnKey[]): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(employeeRegisterColumnStorageKey(userId), JSON.stringify(sanitizeEmployeeRegisterColumns(columns)));
  } catch (error) {
    console.warn('[ui-preferences] Could not cache employee register columns:', error);
  }
}
