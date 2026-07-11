/** Merge-field catalogue and the sample data used in Preview mode. */

export const SAMPLE_DATA: Record<string, string> = {
  'company.name': 'Siomac Manufacturing Ltd.',
  'company.address': '12 Industrial Ave, Port of Spain, Trinidad & Tobago',
  'company.reg': 'BIR# 100234567',
  'employee.name': 'Alexandra Boodram',
  'employee.id': 'EMP-004512',
  'employee.position': 'Senior Process Engineer',
  'employee.department': 'Operations',
  'employee.nis': 'NI-7789341',
  'employee.tin': 'TIN-556120',
  'employee.bank': 'Republic Bank (Trinidad)',
  'employee.account': 'XXXXXX1234',
  'pay.period': '01–15 July 2026',
  'pay.date': '18 July 2026',
  'pay.frequency': 'Semi-monthly',
  'pay.method': 'Direct Deposit',
  'pay.ref': 'PS-2026-0048',
  'pay.gross': '$9,450.00',
  'pay.deductions': '$2,113.40',
  'pay.net': '$7,336.60',
  'pay.ytd.gross': '$118,900.00',
  'pay.ytd.net': '$92,410.00',
  'pay.currency': 'TTD',
};

export interface TokenGroup {
  label: string;
  keys: string[];
}

export const TOKEN_GROUPS: readonly TokenGroup[] = [
  { label: 'Company', keys: ['company.name', 'company.address', 'company.reg'] },
  {
    label: 'Employee',
    keys: [
      'employee.name',
      'employee.id',
      'employee.position',
      'employee.department',
      'employee.nis',
      'employee.tin',
      'employee.bank',
      'employee.account',
    ],
  },
  {
    label: 'Pay run',
    keys: ['pay.period', 'pay.date', 'pay.frequency', 'pay.method', 'pay.currency', 'pay.ref'],
  },
  {
    label: 'Totals',
    keys: ['pay.gross', 'pay.deductions', 'pay.net', 'pay.ytd.gross', 'pay.ytd.net'],
  },
];

const ACRONYMS: Record<string, string> = { id: 'ID', nis: 'NIS', tin: 'TIN', ytd: 'YTD', reg: 'Reg' };

/** "employee.name" -> "Employee Name", "pay.ytd.net" -> "Pay YTD Net" */
export function tokenLabel(key: string): string {
  return key
    .split('.')
    .map((w) => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
