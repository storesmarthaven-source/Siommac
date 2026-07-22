export const EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY = 'hr.employee-register.columns';
export const EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_VERSION = 1;

export const EMPLOYEE_REGISTER_COLUMN_KEYS = [
  'employee',
  'employeeNumber',
  'position',
  'department',
  'site',
  'supervisor',
  'employmentType',
  'status',
  'trainingStatus',
  'actions',
] as const;

export type EmployeeRegisterColumnKey = typeof EMPLOYEE_REGISTER_COLUMN_KEYS[number];

export const REQUIRED_EMPLOYEE_REGISTER_COLUMN_KEYS: readonly EmployeeRegisterColumnKey[] = [
  'employee',
  'actions',
];

export function sanitizeEmployeeRegisterColumnKeys(value: unknown): EmployeeRegisterColumnKey[] | null {
  if (!Array.isArray(value)) return null;
  const validKeys = new Set<string>(EMPLOYEE_REGISTER_COLUMN_KEYS);
  const requested = new Set(value.filter((key): key is string => typeof key === 'string' && validKeys.has(key)));
  for (const key of REQUIRED_EMPLOYEE_REGISTER_COLUMN_KEYS) requested.add(key);
  return EMPLOYEE_REGISTER_COLUMN_KEYS.filter(key => requested.has(key));
}
