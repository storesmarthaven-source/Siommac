/**
 * useEmployeeOptions — active users as { value, label } for assignee / reviewer /
 * owner pickers in the Inspections dialogs.
 */

import { useQuery } from '@tanstack/preact-query';
import { listActiveEmployees } from '@api/employees';

export interface UserOption { value: string; label: string }

interface EmployeeLite { id: string; full_name?: string | null; username?: string | null }

export function useEmployeeOptions(): UserOption[] {
  const { data } = useQuery({
    queryKey: ['hse-inspections', 'employee-options'],
    queryFn:  () => listActiveEmployees(),
    staleTime: 5 * 60_000,
  });
  const rows = (data ?? []) as unknown as EmployeeLite[];
  return rows.map(u => ({
    value: u.id,
    label: u.full_name || u.username || u.id,
  }));
}
