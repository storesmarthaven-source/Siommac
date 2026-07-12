// Unit tests for payslipTokens.ts (Phase 2)
// Pure module — no DB, no supabase, importable in ts-jest without stubs.
// Covers: all 22 token keys, money formatting, address construction,
// company.reg precedence (BIR > NIS ER), and resolveTokenText.

import { buildTokenMap, resolveTokenText, type PayslipTokenSource, type PayslipEmployerSource } from
  '../../netlify/functions/lib/finance/payslipTokens';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const snapshot: PayslipTokenSource = {
  payslipNo:       'PSL-2026-0042',
  periodLabel:     'July 2026',
  payFrequency:    'monthly',
  payDate:         '2026-07-25',
  currency:        'TTD',
  employer:        { name: 'Fallback Employer Name' },
  employee: {
    name:              'Jane Doe',
    employeeNumber:    'E-1042',
    department:        'Operations',
    position:          'Senior Analyst',
    nisNumberMasked:   '***-9001',
  },
  bank: { bankName: 'Republic Bank', accountType: 'chequing', accountMasked: '****6789' },
  gross:           10500,
  totalDeductions: 1900.85,
  net:             8599.15,
  ytd:             { gross: 73500, net: 60193.05 },
};

const employer: PayslipEmployerSource = {
  legalName:         'Acme T&T Limited',
  tradingName:       'Acme T&T',
  birFileNumber:     '12345678',
  nisEmployerNumber: 'ER-99999',
  addressLine1:      '10 Main Street',
  addressLine2:      'Suite 5',
  city:              'Port of Spain',
  country:           'Trinidad and Tobago',
  phone:             null,
  email:             null,
};

// ── buildTokenMap: company block ──────────────────────────────────────────────

describe('buildTokenMap — company block', () => {
  test('company.name uses legalName', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['company.name']).toBe('Acme T&T Limited');
  });

  test('company.name falls back to snapshot.employer.name when legalName is blank', () => {
    const m = buildTokenMap(snapshot, { ...employer, legalName: '' });
    expect(m['company.name']).toBe('Fallback Employer Name');
  });

  test('company.address joins non-empty parts with comma and space', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['company.address']).toBe('10 Main Street, Suite 5, Port of Spain');
  });

  test('company.address omits default country (Trinidad and Tobago)', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['company.address']).not.toContain('Trinidad and Tobago');
  });

  test('company.address includes country when it differs from the default', () => {
    const m = buildTokenMap(snapshot, { ...employer, country: 'Barbados', city: 'Bridgetown' });
    expect(m['company.address']).toContain('Barbados');
  });

  test('company.address falls back to "Trinidad and Tobago" when all parts blank', () => {
    const m = buildTokenMap(snapshot, {
      ...employer, addressLine1: null, addressLine2: null, city: null,
    });
    expect(m['company.address']).toBe('Trinidad and Tobago');
  });

  test('company.reg uses BIR file number with BIR# prefix', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['company.reg']).toBe('BIR# 12345678');
  });

  test('company.reg falls back to NIS ER# when no BIR file number', () => {
    const m = buildTokenMap(snapshot, { ...employer, birFileNumber: null });
    expect(m['company.reg']).toBe('NIS ER# ER-99999');
  });

  test('company.reg is empty when both BIR and NIS employer numbers absent', () => {
    const m = buildTokenMap(snapshot, { ...employer, birFileNumber: null, nisEmployerNumber: null });
    expect(m['company.reg']).toBe('');
  });
});

// ── buildTokenMap: employee block ─────────────────────────────────────────────

describe('buildTokenMap — employee block', () => {
  test('employee.name is set', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['employee.name']).toBe('Jane Doe');
  });

  test('employee.id maps to employeeNumber', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['employee.id']).toBe('E-1042');
  });

  test('employee.id is empty string when employeeNumber is null', () => {
    const m = buildTokenMap({ ...snapshot, employee: { ...snapshot.employee, employeeNumber: null } }, employer);
    expect(m['employee.id']).toBe('');
  });

  test('employee.position is set', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['employee.position']).toBe('Senior Analyst');
  });

  test('employee.department is set', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['employee.department']).toBe('Operations');
  });

  test('employee.nis maps to nisNumberMasked', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['employee.nis']).toBe('***-9001');
  });

  test('employee.tin is empty (not tracked separately yet)', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['employee.tin']).toBe('');
  });

  test('employee.bank maps to bank name', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['employee.bank']).toBe('Republic Bank');
  });

  test('employee.account maps to masked account', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['employee.account']).toBe('****6789');
  });

  test('employee.bank and employee.account are empty when bank is null', () => {
    const m = buildTokenMap({ ...snapshot, bank: null }, employer);
    expect(m['employee.bank']).toBe('');
    expect(m['employee.account']).toBe('');
  });
});

// ── buildTokenMap: pay run block ──────────────────────────────────────────────

describe('buildTokenMap — pay run block', () => {
  test('pay.period maps to periodLabel', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['pay.period']).toBe('July 2026');
  });

  test('pay.date formats ISO date in dd MMM yyyy', () => {
    const m = buildTokenMap(snapshot, employer);
    // 2026-07-25 → "25 Jul 2026" in en-GB locale
    expect(m['pay.date']).toMatch(/25.*Jul.*2026/i);
  });

  test('pay.date is empty string when payDate is null', () => {
    const m = buildTokenMap({ ...snapshot, payDate: null }, employer);
    expect(m['pay.date']).toBe('');
  });

  test('pay.frequency is capitalised', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['pay.frequency']).toBe('Monthly');
  });

  test('pay.method is "Direct Deposit" when bank is set', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['pay.method']).toBe('Direct Deposit');
  });

  test('pay.method is "Cash" when bank is null', () => {
    const m = buildTokenMap({ ...snapshot, bank: null }, employer);
    expect(m['pay.method']).toBe('Cash');
  });

  test('pay.currency is set', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['pay.currency']).toBe('TTD');
  });

  test('pay.ref maps to payslipNo', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['pay.ref']).toBe('PSL-2026-0042');
  });
});

// ── buildTokenMap: totals block ────────────────────────────────────────────────

describe('buildTokenMap — totals block', () => {
  test('pay.gross is formatted as $TT money', () => {
    const m = buildTokenMap(snapshot, employer);
    // "$10,500.00" (en-TT locale)
    expect(m['pay.gross']).toMatch(/\$10[,.]?500\.00/);
  });

  test('pay.deductions is formatted', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['pay.deductions']).toMatch(/\$1[,.]?900\.85/);
  });

  test('pay.net is formatted', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['pay.net']).toMatch(/\$8[,.]?599\.15/);
  });

  test('pay.ytd.gross is formatted', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['pay.ytd.gross']).toMatch(/\$73[,.]?500\.00/);
  });

  test('pay.ytd.net is formatted', () => {
    const m = buildTokenMap(snapshot, employer);
    expect(m['pay.ytd.net']).toMatch(/\$60[,.]?193\.05/);
  });
});

// ── resolveTokenText ──────────────────────────────────────────────────────────

describe('resolveTokenText', () => {
  const map = buildTokenMap(snapshot, employer);

  test('replaces a known token', () => {
    expect(resolveTokenText('Hello {{employee.name}}!', map)).toBe('Hello Jane Doe!');
  });

  test('replaces multiple tokens in one string', () => {
    const result = resolveTokenText('{{company.name}} | {{pay.period}}', map);
    expect(result).toBe('Acme T&T Limited | July 2026');
  });

  test('leaves unknown tokens verbatim (raw key visible)', () => {
    const result = resolveTokenText('ID: {{employee.unknown_field}}', map);
    expect(result).toBe('ID: {{employee.unknown_field}}');
  });

  test('handles tokens with extra whitespace inside braces', () => {
    const result = resolveTokenText('{{  employee.name  }}', map);
    expect(result).toBe('Jane Doe');
  });

  test('is a no-op on strings with no tokens', () => {
    const text = 'No tokens here.';
    expect(resolveTokenText(text, map)).toBe(text);
  });

  test('returns empty string input unchanged', () => {
    expect(resolveTokenText('', map)).toBe('');
  });
});
