import type { Design, TableRow } from '@payslip/types';
import { TemplateBuilder, page } from './builder';

export interface DetailedPayslipOptions {
  logo: string;
  logoRect: { x: number; y: number; w: number; h: number };
  companyName: string;
  companyLines: string;
  /** 'band' = navy header bar (SIOMAC); 'plain' = white header + rule (PROLAS/ICT). */
  header: 'band' | 'plain';
  headerBg?: string;
  headerRules?: Array<{ x: number; w: number; color: string }>;
  companyNameColor: string;
  companyLineColor: string;
  /** Accent for section headings, table headers, and the totals-bar icons. */
  accent: string;
  sectionColor: string;
  headColor: string; // table header-row text
  totalColor: string; // table total-row text
  paySlipColor: string;
  paySlipRule: string;
  iconBg: string;
  iconColor: string;
  earnings: TableRow[];
  deductions: TableRow[];
  employerLines: string;
  footerContact: string;
}

const INK = '#243049';
const RULE = '#e6e9f1';

const EMPLOYEE_FIELDS: Array<[string, string]> = [
  ['Employee Name', 'employee.name'],
  ['Employee ID', 'employee.id'],
  ['National ID', 'employee.tin'],
  ['Job Title', 'employee.position'],
  ['Department', 'employee.department'],
  ['Pay Frequency', 'pay.frequency'],
];

const PAY_PERIOD_FIELDS: Array<[string, string]> = [
  ['Pay Period', 'pay.period'],
  ['Pay Date', 'pay.date'],
  ['Payment Method', 'pay.method'],
  ['Bank', 'employee.bank'],
  ['Account Number', 'employee.account'],
];

export function buildDetailedPayslip(o: DetailedPayslipOptions): Design {
  const b = new TemplateBuilder(page({ size: 'a4', orient: 'landscape' })); // 1123 × 794

  /* ---- header ---- */
  if (o.header === 'band') {
    b.add({ type: 'box', x: 0, y: 0, w: 1123, h: 140, bg: o.headerBg ?? '#1e2a52', radius: 0, padding: 0 });
  }
  b.add({ type: 'image', ...o.logoRect, src: o.logo, fit: 'contain' });
  b.add({ type: 'heading', x: 700, y: o.header === 'band' ? 32 : 26, w: 383, h: 24, text: o.companyName, fontSize: 18, bold: true, color: o.companyNameColor, align: 'right' });
  b.add({ type: 'text', x: 700, y: o.header === 'band' ? 58 : 52, w: 383, h: 74, align: 'right', color: o.companyLineColor, fontSize: 11, lineHeight: 1.55, text: o.companyLines });
  (o.headerRules ?? [{ x: 0, w: 1123, color: '#1a1a1a' }]).forEach((r) =>
    b.add({ type: 'divider', x: r.x, y: o.header === 'band' ? 130 : 148, w: r.w, h: o.header === 'band' ? 4 : 2, color: r.color, thickness: o.header === 'band' ? 4 : 2 }),
  );

  /* ---- left column ---- */
  b.add({ type: 'heading', x: 24, y: 156, w: 290, h: 34, text: 'PAYSLIP', fontSize: 26, bold: true, color: o.paySlipColor });
  b.add({ type: 'divider', x: 24, y: 196, w: 290, h: 2, color: o.paySlipRule, thickness: 2 });

  b.add({ type: 'text', x: 24, y: 218, w: 290, h: 18, text: '👤  EMPLOYEE DETAILS', fontSize: 12.5, bold: true, color: o.sectionColor });
  EMPLOYEE_FIELDS.forEach(([label, token], i) => {
    const y = 244 + i * 30;
    b.add({ type: 'field', x: 24, y, w: 290, h: 22, label, token, labelWidth: 116, fontSize: 11, color: INK });
    b.add({ type: 'divider', x: 24, y: y + 25, w: 290, h: 1, color: RULE, thickness: 1 });
  });

  b.add({ type: 'text', x: 24, y: 430, w: 290, h: 18, text: '📅  PAY PERIOD', fontSize: 12.5, bold: true, color: o.sectionColor });
  PAY_PERIOD_FIELDS.forEach(([label, token], i) => {
    const y = 456 + i * 30;
    b.add({ type: 'field', x: 24, y, w: 290, h: 22, label, token, labelWidth: 116, fontSize: 11, color: INK });
    b.add({ type: 'divider', x: 24, y: y + 25, w: 290, h: 1, color: RULE, thickness: 1 });
  });

  b.add({ type: 'divider', x: 332, y: 150, w: 1, h: 450, color: '#e2e6ee', thickness: 1 });

  /* ---- earnings + deductions ---- */
  b.add({ type: 'text', x: 620, y: 158, w: 480, h: 18, text: 'Currency: Trinidad and Tobago Dollars (TTD)', fontSize: 12, color: '#6a7290', align: 'right' });

  b.add({ type: 'heading', x: 352, y: 208, w: 300, h: 24, text: 'EARNINGS', fontSize: 15, bold: true, color: o.sectionColor });
  b.add({
    type: 'table', x: 352, y: 238, w: 404, h: 344, title: '', accent: o.accent, headColor: o.headColor, totalColor: o.totalColor,
    fontSize: 11, color: INK, padding: 0, bg: '#ffffff', borderW: 1, borderColor: '#d7dce8', radius: 6,
    labelCol: 'DESCRIPTION', amtCol: 'AMOUNT (TTD)', totalLabel: 'TOTAL EARNINGS',
    showHead: true, showTotal: true, showHoursRate: true, hoursCol: 'HOURS / UNITS', rateCol: 'RATE (TTD)',
    rows: o.earnings,
  });

  b.add({ type: 'heading', x: 772, y: 208, w: 300, h: 24, text: 'DEDUCTIONS', fontSize: 15, bold: true, color: o.sectionColor });
  b.add({
    type: 'table', x: 772, y: 238, w: 328, h: 344, title: '', accent: o.accent, headColor: o.headColor, totalColor: o.totalColor,
    fontSize: 11, color: INK, padding: 0, bg: '#ffffff', borderW: 1, borderColor: '#d7dce8', radius: 6,
    labelCol: 'DESCRIPTION', amtCol: 'AMOUNT (TTD)', totalLabel: 'TOTAL DEDUCTIONS',
    showHead: true, showTotal: true, showHoursRate: false,
    rows: o.deductions,
  });

  /* ---- totals bar (values computed from the rows) ---- */
  const sum = (rows: TableRow[]): number =>
    rows.reduce((t, r) => t + (parseFloat(String(r.amount).replace(/[^0-9.-]/g, '')) || 0), 0);
  const fmt = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gross = sum(o.earnings);
  const deductions = sum(o.deductions);

  b.add({ type: 'box', x: 24, y: 612, w: 1075, h: 112, bg: '#ffffff', borderW: 2, borderColor: '#1a1a1a', radius: 8, padding: 0 });
  const totals: Array<[string, string, string, number]> = [
    ['$', 'GROSS PAY', fmt(gross), 48],
    ['−', 'TOTAL DEDUCTIONS', fmt(deductions), 352],
    ['=', 'NET PAY', fmt(gross - deductions), 656],
  ];
  totals.forEach(([symbol, label, value, x]) => {
    b.add({ type: 'box', x, y: 640, w: 54, h: 54, bg: o.iconBg, radius: 27, padding: 0 });
    b.add({ type: 'heading', x, y: 640, w: 54, h: 54, text: symbol, fontSize: 22, bold: true, color: o.iconColor, align: 'center', valign: 'middle' });
    b.add({ type: 'summary', x: x + 66, y: 634, w: 210, h: 62, label, token: 'pay.net', value: `${value} TTD`, sub: '', bg: 'transparent', color: INK, accent: INK, radius: 0, fontSize: 16, bold: true });
  });
  b.add({ type: 'divider', x: 908, y: 634, w: 1, h: 68, color: '#e2e6ee', thickness: 1 });
  b.add({ type: 'text', x: 926, y: 632, w: 168, h: 16, text: 'EMPLOYER CONTRIBUTIONS (NON-DEDUCTIBLE)', fontSize: 8.5, bold: true, color: o.sectionColor, lineHeight: 1.25 });
  b.add({ type: 'text', x: 926, y: 656, w: 168, h: 60, fontSize: 9, color: '#6a7290', lineHeight: 1.5, text: o.employerLines });

  /* ---- footer ---- */
  b.add({ type: 'text', x: 40, y: 744, w: 360, h: 16, text: 'This is a computer generated payslip and does not require a signature.', fontSize: 10, color: '#8a93ab' });
  b.add({ type: 'text', x: 410, y: 744, w: 320, h: 16, text: 'Please retain this payslip for your records.', fontSize: 10, color: '#8a93ab', align: 'center' });
  b.add({ type: 'text', x: 740, y: 744, w: 359, h: 16, text: o.footerContact, fontSize: 10, color: '#8a93ab', align: 'right' });

  return b.build();
}
