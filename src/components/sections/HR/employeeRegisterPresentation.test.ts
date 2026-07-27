import { describe, expect, it } from 'vitest';
import { employeeRegisterEmptyCopy, employeeRegisterSummary } from './employeeRegisterPresentation';

describe('Employee register presentation state', () => {
  it('distinguishes initial loading and fail-closed API states from an empty register', () => {
    expect(employeeRegisterSummary({ total: 0, activeFilterCount: 0, isInitialLoading: true, isInitialError: false }))
      .toBe('Loading employee records…');
    expect(employeeRegisterSummary({ total: 0, activeFilterCount: 0, isInitialLoading: false, isInitialError: true }))
      .toBe('Employee records are currently unavailable');
  });

  it('reports real result and active-filter counts with correct singular labels', () => {
    expect(employeeRegisterSummary({ total: 1, activeFilterCount: 1, isInitialLoading: false, isInitialError: false }))
      .toBe('1 employee · 1 filter active');
    expect(employeeRegisterSummary({ total: 23, activeFilterCount: 2, isInitialLoading: false, isInitialError: false }))
      .toBe('23 employees · 2 filters active');
  });

  it('guides filtered and genuinely empty registers differently', () => {
    expect(employeeRegisterEmptyCopy(true)).toEqual({
      title: 'No employees found',
      text: 'Try changing or clearing the current search and filters.',
    });
    expect(employeeRegisterEmptyCopy(false)).toEqual({
      title: 'No employees in this register',
      text: 'Employee records will appear here when they are available.',
    });
  });
});
