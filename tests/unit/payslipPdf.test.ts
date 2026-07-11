// Unit test for the payslip PDF renderer — verifies pdfkit produces a valid PDF buffer
// in our Node runtime (no DB / no server). Guards the reconciliation invariant used by
// the renderer's inputs (gross - totalDeductions = net).
import { renderPayslipPdf, type PayslipSnapshot } from '../../netlify/functions/lib/finance/payslipPdf';

const snapshot: PayslipSnapshot = {
  payslipId: '00000000-0000-0000-0000-000000000001',
  payslipNo: 'PSL-0001',
  runId: '00000000-0000-0000-0000-0000000000aa',
  runNo: 'PAY-0007',
  periodLabel: 'July 2026',
  periodMonth: '2026-07-01',
  payFrequency: 'monthly',
  payDate: '2026-07-25',
  currency: 'TTD',
  employer: { name: 'Acme T&T Ltd.' },
  employee: {
    id: 'emp-1', name: 'Jane Doe', employeeNumber: 'E-1042',
    department: 'Operations', position: 'Analyst',
    nisNumberMasked: '***-1234', nisClassNo: 12,
  },
  bank: { bankName: 'Republic Bank', accountType: 'chequing', accountMasked: '****6789' },
  earnings: [
    { label: 'Basic Salary', amount: 9000 },
    { label: 'Housing Allowance', amount: 1000 },
    { label: 'Overtime', amount: 500 },
  ],
  deductions: [
    { label: 'PAYE (Income Tax)', amount: 1200.5 },
    { label: 'NIS (Employee)', amount: 414.6 },
    { label: 'Health Surcharge', amount: 35.75 },
    { label: 'Credit Union', amount: 250 },
  ],
  employerContributions: [{ label: 'NIS (Employer)', amount: 829.2 }],
  gross: 10500,
  totalDeductions: 1900.85,
  net: 8599.15,
  ytd: { gross: 73500, paye: 8403.5, nisEmployee: 2902.2, healthSurcharge: 250.25, net: 60193.05 },
  generatedAt: '2026-07-20T14:15:00.000Z',
};

describe('renderPayslipPdf', () => {
  it('renders a valid, non-trivial PDF buffer', async () => {
    const buf = await renderPayslipPdf(snapshot);
    expect(Buffer.isBuffer(buf)).toBe(true);
    // A real PDF starts with the %PDF- magic header and ends with %%EOF.
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.toString('latin1')).toContain('%%EOF');
  });

  it('reconciles: gross - totalDeductions = net', () => {
    expect(Math.round((snapshot.gross - snapshot.totalDeductions) * 100) / 100).toBe(snapshot.net);
  });

  it('handles a minimal snapshot (no bank, no items) without throwing', async () => {
    const minimal: PayslipSnapshot = {
      ...snapshot, bank: null, earnings: [{ label: 'Basic Salary', amount: 5000 }],
      deductions: [], employerContributions: [], gross: 5000, totalDeductions: 0, net: 5000,
    };
    const buf = await renderPayslipPdf(minimal);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
