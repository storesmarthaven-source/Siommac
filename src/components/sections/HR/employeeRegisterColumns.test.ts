import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_EMPLOYEE_REGISTER_COLUMNS,
  employeeRegisterColumnStorageKey,
  employeeRegisterTableMinWidth,
  readEmployeeRegisterColumns,
  sanitizeEmployeeRegisterColumns,
  writeEmployeeRegisterColumns,
} from './employeeRegisterColumns';

describe('Employee register column preferences', () => {
  beforeEach(() => localStorage.clear());

  it('drops unknown and duplicate keys, restores required columns, and preserves canonical order', () => {
    expect(sanitizeEmployeeRegisterColumns(['status', 'unknown', 'status', 'department'])).toEqual([
      'employee', 'department', 'status', 'actions',
    ]);
  });

  it('falls back to all production columns when the stored value is corrupt', () => {
    expect(sanitizeEmployeeRegisterColumns(null)).toEqual(DEFAULT_EMPLOYEE_REGISTER_COLUMNS);
    localStorage.setItem(employeeRegisterColumnStorageKey('USR-1'), '{not-json');
    expect(readEmployeeRegisterColumns('USR-1')).toEqual(DEFAULT_EMPLOYEE_REGISTER_COLUMNS);
  });

  it('isolates preferences by user and never stores anonymous preferences', () => {
    writeEmployeeRegisterColumns('USR-1', ['employee', 'department', 'actions']);
    writeEmployeeRegisterColumns(null, ['employee', 'status', 'actions']);

    expect(readEmployeeRegisterColumns('USR-1')).toEqual(['employee', 'department', 'actions']);
    expect(readEmployeeRegisterColumns('USR-2')).toEqual(DEFAULT_EMPLOYEE_REGISTER_COLUMNS);
  });

  it('reduces the table minimum width as optional columns are hidden', () => {
    expect(employeeRegisterTableMinWidth(['employee', 'status', 'actions']))
      .toBeLessThan(employeeRegisterTableMinWidth(DEFAULT_EMPLOYEE_REGISTER_COLUMNS));
    expect(employeeRegisterTableMinWidth(['employee', 'actions'])).toBe(620);
  });
});
