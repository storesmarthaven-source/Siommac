export interface EmployeeRegisterSummaryInput {
  total: number;
  activeFilterCount: number;
  isInitialLoading: boolean;
  isInitialError: boolean;
}

export function employeeRegisterSummary({
  total,
  activeFilterCount,
  isInitialLoading,
  isInitialError,
}: EmployeeRegisterSummaryInput): string {
  if (isInitialLoading) return 'Loading employee records…';
  if (isInitialError) return 'Employee records are currently unavailable';

  const employeeCount = `${total.toLocaleString()} employee${total === 1 ? '' : 's'}`;
  if (!activeFilterCount) return employeeCount;
  return `${employeeCount} · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`;
}

export interface EmployeeRegisterEmptyCopy {
  title: string;
  text: string;
}

export function employeeRegisterEmptyCopy(hasActiveFilters: boolean): EmployeeRegisterEmptyCopy {
  if (hasActiveFilters) {
    return {
      title: 'No employees found',
      text: 'Try changing or clearing the current search and filters.',
    };
  }
  return {
    title: 'No employees in this register',
    text: 'Employee records will appear here when they are available.',
  };
}
