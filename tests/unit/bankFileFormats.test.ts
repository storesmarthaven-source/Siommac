// Unit tests for the pure per-bank direct-credit file formatter (no DB).
import {
  resolveBankCode,
  bankNameForCode,
  accountTypeCode,
  buildDirectCreditFile,
  type DirectCreditLine,
} from '../../netlify/functions/lib/finance/bankFileFormats';

describe('resolveBankCode', () => {
  it('matches known banks by free-text name variants', () => {
    expect(resolveBankCode('Republic Bank')).toBe('RBL');
    expect(resolveBankCode('Republic Bank Limited')).toBe('RBL');
    expect(resolveBankCode('First Citizens Bank')).toBe('FCB');
    expect(resolveBankCode('Scotiabank T&T')).toBe('SCOTIA');
    expect(resolveBankCode('RBC Royal Bank')).toBe('RBC');
    expect(resolveBankCode('Royal Bank of Canada')).toBe('RBC');
  });

  it('is case-insensitive and tolerant of whitespace', () => {
    expect(resolveBankCode('  scOTIAbank  ')).toBe('SCOTIA');
  });

  it('falls back to OTHER for unknown or empty names', () => {
    expect(resolveBankCode('Some Credit Union')).toBe('OTHER');
    expect(resolveBankCode('')).toBe('OTHER');
    expect(resolveBankCode(null)).toBe('OTHER');
    expect(resolveBankCode(undefined)).toBe('OTHER');
  });
});

describe('bankNameForCode', () => {
  it('returns the canonical name for a known code', () => {
    expect(bankNameForCode('RBL')).toBe('Republic Bank');
    expect(bankNameForCode('SCOTIA')).toBe('Scotiabank');
  });
  it('returns the code itself when unknown', () => {
    expect(bankNameForCode('OTHER')).toBe('OTHER');
  });
});

describe('accountTypeCode', () => {
  it('maps savings/chequing/current to 2-letter codes', () => {
    expect(accountTypeCode('savings')).toBe('SA');
    expect(accountTypeCode('chequing')).toBe('CH');
    expect(accountTypeCode('cheque')).toBe('CH');
    expect(accountTypeCode('current')).toBe('CH');
    expect(accountTypeCode('something-else')).toBe('OT');
    expect(accountTypeCode(null)).toBe('OT');
  });
});

describe('buildDirectCreditFile', () => {
  const lines: DirectCreditLine[] = [
    { transitNumber: '01', accountNumber: '1234567890', accountType: 'savings',  amount: 4500.00, employeeRef: 'emp-1' },
    { transitNumber: '02', accountNumber: '2233445566', accountType: 'chequing', amount: 3200.50, employeeRef: 'emp-2' },
  ];

  it('emits a header, one detail per line, and a trailer', () => {
    const { content } = buildDirectCreditFile({
      bankName: 'Republic Bank', bankCode: 'RBL', companyName: 'Siomac Ltd',
      currency: 'TTD', fileDate: '2026-07-11', disbursementNo: 'DSB-0001', lines,
    });
    const rows = content.split('\n');
    expect(rows.length).toBe(4); // H + 2 D + T
    expect(rows[0]!.startsWith('H,RBL,Republic Bank,Siomac Ltd,DSB-0001,2026-07-11,TTD,2,7700.50')).toBe(true);
    expect(rows[1]).toBe('D,01,1234567890,SA,4500.00,emp-1');
    expect(rows[2]).toBe('D,02,2233445566,CH,3200.50,emp-2');
    expect(rows[3]).toBe('T,2,7700.50');
  });

  it('produces a BALANCED control total (header total == trailer total == sum of details)', () => {
    const { content, totalAmount, employeeCount } = buildDirectCreditFile({
      bankName: 'Scotiabank', bankCode: 'SCOTIA', companyName: 'Siomac',
      currency: 'TTD', fileDate: '2026-07-11', disbursementNo: 'DSB-0002', lines,
    });
    expect(totalAmount).toBeCloseTo(7700.50, 2);
    expect(employeeCount).toBe(2);
    const rows = content.split('\n');
    const headerTotal = rows[0]!.split(',').at(-1);
    const trailerTotal = rows.at(-1)!.split(',').at(-1);
    const detailSum = rows.slice(1, -1)
      .reduce((s, r) => s + Number(r.split(',')[4]), 0);
    expect(headerTotal).toBe('7700.50');
    expect(trailerTotal).toBe('7700.50');
    expect(detailSum).toBeCloseTo(7700.50, 2);
  });

  it('escapes fields that contain commas', () => {
    const { content } = buildDirectCreditFile({
      bankName: 'Bank, Inc.', bankCode: 'OTHER', companyName: 'Acme, Ltd',
      currency: 'TTD', fileDate: '2026-07-11', disbursementNo: 'DSB-0003',
      lines: [{ transitNumber: null, accountNumber: '999', accountType: 'savings', amount: 10, employeeRef: 'emp-x' }],
    });
    const header = content.split('\n')[0]!;
    expect(header).toContain('"Bank, Inc."');
    expect(header).toContain('"Acme, Ltd"');
    // empty transit renders as an empty field
    expect(content.split('\n')[1]).toBe('D,,999,SA,10.00,emp-x');
  });

  it('handles an empty line set (zero control total)', () => {
    const { content, employeeCount, totalAmount } = buildDirectCreditFile({
      bankName: 'Republic Bank', bankCode: 'RBL', companyName: 'Siomac',
      currency: 'TTD', fileDate: '2026-07-11', disbursementNo: 'DSB-0004', lines: [],
    });
    expect(employeeCount).toBe(0);
    expect(totalAmount).toBe(0);
    expect(content.split('\n')).toEqual([
      'H,RBL,Republic Bank,Siomac,DSB-0004,2026-07-11,TTD,0,0.00',
      'T,0,0.00',
    ]);
  });
});
