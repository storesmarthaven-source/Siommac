import type { EmployeeSortCol } from '@api/hr/employees';
import {
  DEFAULT_EMPLOYEE_REGISTER_COLUMNS,
  sanitizeEmployeeRegisterColumns,
  type EmployeeRegisterColumnKey,
} from './employeeRegisterColumns';

export const EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY = 'hr.employee-register.views';

export interface EmployeeRegisterViewFilters {
  query: string;
  status: string[];
  department: string[];
  employmentType: string[];
  training: string[];
}

export interface EmployeeRegisterView {
  id: string;
  name: string;
  filters: EmployeeRegisterViewFilters;
  sortBy: EmployeeSortCol;
  sortDir: 'asc' | 'desc';
  pageSize: number;
  columns: EmployeeRegisterColumnKey[];
}

const SORT_COLUMNS = new Set<EmployeeSortCol>([
  'full_name', 'employee_number', 'status', 'employment_type', 'start_date', 'department_id',
]);

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.length <= 120))).slice(0, 50);
}

export function sanitizeEmployeeRegisterViews(value: unknown): EmployeeRegisterView[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const views: EmployeeRegisterView[] = [];
  for (const candidate of value.slice(0, 20)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.slice(0, 80) : '';
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, 48) : '';
    if (!id || !name || seen.has(id)) continue;
    const rawFilters = row.filters && typeof row.filters === 'object' ? row.filters as Record<string, unknown> : {};
    const sortBy = SORT_COLUMNS.has(row.sortBy as EmployeeSortCol) ? row.sortBy as EmployeeSortCol : 'full_name';
    const sortDir = row.sortDir === 'desc' ? 'desc' : 'asc';
    const pageSize = [25, 50, 100].includes(Number(row.pageSize)) ? Number(row.pageSize) : 25;
    seen.add(id);
    views.push({
      id,
      name,
      filters: {
        query: typeof rawFilters.query === 'string' ? rawFilters.query.slice(0, 200) : '',
        status: strings(rawFilters.status),
        department: strings(rawFilters.department),
        employmentType: strings(rawFilters.employmentType),
        training: strings(rawFilters.training),
      },
      sortBy,
      sortDir,
      pageSize,
      columns: sanitizeEmployeeRegisterColumns(row.columns ?? DEFAULT_EMPLOYEE_REGISTER_COLUMNS),
    });
  }
  return views;
}
