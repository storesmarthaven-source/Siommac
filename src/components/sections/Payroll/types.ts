/**
 * src/components/sections/Payroll/types.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

export type PayCycle = 'daily' | 'weekly' | 'fortnightly' | 'monthly';
export type PayBasis = 'hourly' | 'salary';

export interface PayrollRow {
  userId:          string;
  username:        string;
  name:            string;
  department:      string;
  departmentId:    string;
  position:        string;
  payCycle:        PayCycle;
  payBasis:        PayBasis;
  hourlyRate:      number;
  monthlySalary:   number;
  stdHours:        number;
  hoursWorked:     number;
  daysWorked:      number;
  grossPay:        number;
  nis:             number;
  healthSurcharge: number;
  paye:            number;
  totalDeductions: number;
  netPay:          number;
  nisApplicable:   boolean;
  hsApplicable:    boolean;
  taxResident:     boolean;
  overridden:      boolean;
  profileImage:    string | null;
  photoUrl:        string | null;
}

export interface PayrollRunData {
  dateFrom: string;
  dateTo:   string;
  rows:     PayrollRow[];
  totals:   PayrollTotals;
}

export interface PayrollTotals {
  grossPay:        number;
  netPay:          number;
  paye:            number;
  nis:             number;
  healthSurcharge: number;
  totalDeductions: number;
}

export interface Department {
  id:   string | number;
  name: string;
}

export interface EmployeeListItem {
  id:             string;
  username:       string;
  fullName:       string;
  firstName?:     string;
  lastName?:      string;
  departmentId:   string;
  departmentName: string;
  department?:    string;
  payCycle:       PayCycle;
  profileImage?:  string | null;
  photoUrl?:      string | null;
}

/** T&T Payroll statutory constants. */
export interface PayrollConstants {
  nisRate:             number;   // e.g. 6 (percent)
  nisMonthlyCap:       number;   // 13600
  hsThreshold:         number;   // 469.99 (weekly gross)
  hsHighDaily:         number;
  hsHighWeekly:        number;
  hsHighFortnightly:   number;
  hsHighMonthly:       number;
  hsLowDaily:          number;
  hsLowWeekly:         number;
  hsLowFortnightly:    number;
  hsLowMonthly:        number;
  allowanceAnnual:     number;   // 90000
  payeRateLow:         number;   // 25 (percent)
  payeRateHigh:        number;   // 30 (percent)
  payeHighThreshold:   number;   // 1000000
}

export const DEFAULT_CONSTANTS: PayrollConstants = {
  nisRate:           6,
  nisMonthlyCap:     13_600,
  hsThreshold:       469.99,
  hsHighDaily:       1.65,
  hsHighWeekly:      8.25,
  hsHighFortnightly: 16.50,
  hsHighMonthly:     33.00,
  hsLowDaily:        0.30,
  hsLowWeekly:       1.50,
  hsLowFortnightly:  3.00,
  hsLowMonthly:      6.00,
  allowanceAnnual:   90_000,
  payeRateLow:       25,
  payeRateHigh:      30,
  payeHighThreshold: 1_000_000,
};
