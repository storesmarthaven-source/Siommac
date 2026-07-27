import { describe, expect, it } from 'vitest';
import { DEFAULT_EMPLOYEE_REGISTER_COLUMNS } from './employeeRegisterColumns';
import { sanitizeEmployeeRegisterViews } from './employeeRegisterViews';

describe('Employee register saved views', () => {
  it('round-trips every part of a view: filters, sorting, page size, and visible columns', () => {
    const [view] = sanitizeEmployeeRegisterViews([{
      id: 'view-1',
      name: 'Ops contractors',
      filters: { query: 'ari', status: ['active'], department: ['dept-1'], employmentType: ['contract'], training: ['expired'] },
      sortBy: 'employee_number',
      sortDir: 'desc',
      pageSize: 50,
      columns: ['employee', 'department', 'employmentType', 'actions'],
    }]);

    expect(view?.filters).toEqual({
      query: 'ari', status: ['active'], department: ['dept-1'], employmentType: ['contract'], training: ['expired'],
    });
    expect(view?.sortBy).toBe('employee_number');
    expect(view?.sortDir).toBe('desc');
    expect(view?.pageSize).toBe(50);
    expect(view?.columns).toEqual(['employee', 'department', 'employmentType', 'actions']);
  });

  it('falls back to the default columns when a view predates the column contract', () => {
    const [view] = sanitizeEmployeeRegisterViews([{ id: 'legacy', name: 'Legacy' }]);
    expect(view?.columns).toEqual([...DEFAULT_EMPLOYEE_REGISTER_COLUMNS]);
  });

  it('sanitizes persisted views and restores safe table defaults', () => {
    expect(sanitizeEmployeeRegisterViews([{ id: 'ops', name: ' Operations ', filters: { status: ['active', 'active'] }, sortBy: 'unknown', pageSize: 999 }]))
      .toEqual([expect.objectContaining({
        id: 'ops', name: 'Operations', sortBy: 'full_name', sortDir: 'asc', pageSize: 25,
        filters: expect.objectContaining({ status: ['active'] }) as unknown,
      })]);
  });

  it('drops malformed and duplicate records', () => {
    expect(sanitizeEmployeeRegisterViews([null, { id: 'a', name: 'One' }, { id: 'a', name: 'Two' }, { id: '', name: 'Bad' }]))
      .toHaveLength(1);
  });
});
