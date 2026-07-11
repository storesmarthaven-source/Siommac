import type { Design, TableRow } from '@/types';
import { LOGOS } from '@/constants/logos';
import { buildDetailedPayslip } from './detailedPayslip';

const EARNINGS: TableRow[] = [
  { label: 'Basic Pay', hours: '80.00', rate: '500.00', amount: '40,000.00' },
  { label: 'Overtime (1.5x)', hours: '6.00', rate: '600.00', amount: '3,600.00' },
  { label: 'Transport Allowance', hours: '—', rate: '—', amount: '1,800.00' },
  { label: 'Meal Allowance', hours: '—', rate: '—', amount: '1,000.00' },
];

const DEDUCTIONS: TableRow[] = [
  { label: 'NIS (Employee)', amount: '3,149.80' },
  { label: 'PAYE', amount: '7,856.70' },
  { label: 'Health Surcharge', amount: '533.60' },
  { label: 'Other Deduction (Loan)', amount: '1,200.00' },
];

/** PROLAS Homes Ltd. — white header, green accent. */
export function prolasTemplate(): Design {
  const GREEN = '#1a8f3c';
  return buildDetailedPayslip({
    logo: LOGOS.prolas,
    logoRect: { x: 40, y: 28, w: 330, h: 96 },
    companyName: 'PROLAS HOMES LTD.',
    companyLines: '78 Eastern Main Road\nTunapuna, Trinidad & Tobago\nTel: (868) 612-3456  |  Email: info@prolashomes.com\nWebsite: www.prolashomes.com',
    header: 'plain',
    headerRules: [{ x: 0, w: 1123, color: '#1a1a1a' }],
    companyNameColor: '#111111',
    companyLineColor: '#555555',
    accent: GREEN,
    sectionColor: GREEN,
    headColor: '#ffffff',
    totalColor: GREEN,
    paySlipColor: GREEN,
    paySlipRule: GREEN,
    iconBg: GREEN,
    iconColor: '#ffffff',
    earnings: EARNINGS,
    deductions: DEDUCTIONS,
    employerLines: 'NIS (Employer): 3,149.80 TTD\nInsurance Premium: 1,850.00 TTD\nThese amounts are paid by the employer and are not deducted from your salary.',
    footerContact: 'For payroll enquiries, contact payroll@prolashomes.com or (868) 612-3456.',
  });
}
