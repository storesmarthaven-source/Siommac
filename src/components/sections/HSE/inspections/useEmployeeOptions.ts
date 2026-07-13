/**
 * useEmployeeOptions — active employees as { value, label } for assignee / reviewer /
 * owner pickers in the Inspections dialogs. Sourced from the active HR employee master
 * (`@api/hr/employees`), NOT the legacy Employees module.
 */

import { useHrEmployees, type HrEmployeeRow } from '@api/hr/employees';

export interface UserOption { value: string; label: string }

const empLabel = (e: HrEmployeeRow): string =>
  (e.display_name ?? e.full_name ?? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()) || e.username || e.id;

export function useEmployeeOptions(): UserOption[] {
  const { data } = useHrEmployees({ limit: 500 });
  return (data ?? []).map(e => ({ value: e.id, label: empLabel(e) }));
}
