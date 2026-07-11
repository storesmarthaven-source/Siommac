// ============================================================================
// Finance Payroll — Payslip snapshot + PDF renderer (Wave 1)
// ============================================================================
// Two pure-ish concerns:
//   buildPayslipSnapshot(payslipId)  — assemble the DETERMINISTIC T&T payslip data
//     from the LOCKED run line + itemised run inputs + employee + statutory + bank + YTD.
//     No calculation happens here — it only reads values SIOMAC already computed.
//   renderPayslipPdf(snapshot)       — draw the snapshot to a PDF buffer with pdfkit
//     (pure JS, no headless browser — scales to thousands of payslips serverlessly).
//
// Reconciliation invariant: sum(earnings) = gross; gross - sum(deductions) = net.
// Deductions listed are exactly the ones that reduce net (PAYE, NIS employee, Health
// Surcharge, post-tax voluntary items) so the payslip footer always balances the run line.
// ============================================================================

import PDFDocument from 'pdfkit';
import { sb } from '../db';

// ── Snapshot types ──────────────────────────────────────────────────────────

export interface PayslipLineItem { label: string; amount: number; }

export interface PayslipSnapshot {
  payslipId: string;
  payslipNo: string;
  runId: string;
  runNo: string;
  periodLabel: string;          // "July 2026"
  periodMonth: string;          // YYYY-MM-DD
  payFrequency: string;
  payDate: string | null;
  currency: 'TTD';
  employer: { name: string };
  employee: {
    id: string; name: string; employeeNumber: string | null;
    department: string | null; position: string | null;
    nisNumberMasked: string | null; nisClassNo: number | null;
  };
  bank: { bankName: string; accountType: string; accountMasked: string } | null;
  earnings: PayslipLineItem[];
  deductions: PayslipLineItem[];        // statutory + post-tax voluntary (reconciles to net)
  employerContributions: PayslipLineItem[];
  gross: number;
  totalDeductions: number;
  net: number;
  ytd: { gross: number; paye: number; nisEmployee: number; healthSurcharge: number; net: number };
  generatedAt: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Snapshot builder ────────────────────────────────────────────────────────

/**
 * Assemble the payslip snapshot for a payslip whose run is LOCKED (or exported).
 * Throws 404 if the payslip/line is missing, 422 if the run isn't locked yet.
 */
export async function buildPayslipSnapshot(payslipId: string): Promise<PayslipSnapshot> {
  // Payslip
  const { data: ps, error: psErr } = await sb.from('finance_payslips')
    .select('id, payslip_no, run_id, run_line_id, employee_id')
    .eq('id', payslipId)
    .maybeSingle<{ id: string; payslip_no: string; run_id: string; run_line_id: string; employee_id: string }>();
  if (psErr) throw Object.assign(new Error('payslipSnapshot/payslip: ' + psErr.message), { status: 500 });
  if (!ps) throw Object.assign(new Error('Payslip not found.'), { status: 404 });

  // Run
  const { data: run, error: runErr } = await sb.from('finance_payroll_runs')
    .select('run_no, period_month, pay_frequency, pay_date, status')
    .eq('id', ps.run_id)
    .maybeSingle<{ run_no: string; period_month: string; pay_frequency: string; pay_date: string | null; status: string }>();
  if (runErr) throw Object.assign(new Error('payslipSnapshot/run: ' + runErr.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!['locked', 'exported'].includes(run.status)) {
    throw Object.assign(new Error(`Payslips render only for locked runs (run is '${run.status}').`), { status: 422 });
  }

  // Run line (the authoritative computed figures)
  const { data: line, error: lineErr } = await sb.from('finance_payroll_run_lines')
    .select('base, taxable_gross, gross, nis_employee, nis_employer, health_surcharge, paye, voluntary_deductions, net, nis_number_masked, nis_class_no')
    .eq('id', ps.run_line_id)
    .maybeSingle<{
      base: number; taxable_gross: number; gross: number; nis_employee: number; nis_employer: number;
      health_surcharge: number; paye: number; voluntary_deductions: number; net: number;
      nis_number_masked: string | null; nis_class_no: number | null;
    }>();
  if (lineErr) throw Object.assign(new Error('payslipSnapshot/line: ' + lineErr.message), { status: 500 });
  if (!line) throw Object.assign(new Error('Payroll run line not found.'), { status: 404 });

  // Itemised inputs for this employee (earnings + voluntary deductions)
  const { data: inputs, error: inErr } = await sb.from('finance_payroll_run_inputs')
    .select('source_type, component_code, label, amount, metadata')
    .eq('run_id', ps.run_id)
    .eq('employee_id', ps.employee_id);
  if (inErr) throw Object.assign(new Error('payslipSnapshot/inputs: ' + inErr.message), { status: 500 });
  const inputRows = (inputs ?? []) as Array<{ source_type: string; component_code: string | null; label: string | null; amount: number | null; metadata: Record<string, unknown> }>;

  // Employee + department + bank + company (all best-effort, cosmetic on failure)
  const [{ data: emp }, bank, companyName] = await Promise.all([
    sb.from('app_users').select('full_name, employee_number, department_id, position')
      .eq('id', ps.employee_id).maybeSingle<{ full_name: string | null; employee_number: string | null; department_id: string | null; position: string | null }>(),
    (async () => {
      // Primary account first (one is_primary per employee); table has no status/priority cols.
      const { data } = await sb.from('finance_employee_bank_accounts')
        .select('bank_name, account_type, account_number_masked, is_primary')
        .eq('employee_id', ps.employee_id)
        .order('is_primary', { ascending: false }).limit(1);
      const row = (data ?? [])[0] as { bank_name: string; account_type: string; account_number_masked: string } | undefined;
      return row ? { bankName: row.bank_name, accountType: row.account_type, accountMasked: row.account_number_masked } : null;
    })(),
    (async () => {
      const { data } = await sb.from('settings').select('value').eq('key', 'companyName').maybeSingle<{ value: unknown }>();
      const v = data?.value;
      return (typeof v === 'string' && v.trim()) ? v.trim() : 'Siomac';
    })(),
  ]);

  let department: string | null = null;
  if (emp?.department_id) {
    const { data: dept } = await sb.from('departments').select('name').eq('id', emp.department_id).maybeSingle<{ name: string }>();
    department = dept?.name ?? null;
  }

  // ── Build earnings / deductions (reconciling to the line) ──────────────────
  const earnings: PayslipLineItem[] = [];
  const voluntary: PayslipLineItem[] = [];
  let otTotal = 0;
  for (const i of inputRows) {
    const amt = Number(i.amount ?? 0);
    if (i.source_type === 'base_pay') {
      earnings.push({ label: i.label ?? 'Basic Pay', amount: round2(amt) });
    } else if (i.source_type === 'overtime') {
      otTotal += amt;
    } else if (i.source_type === 'pay_item') {
      const kind = (i.metadata?.['kind'] as string | undefined) ?? 'earning';
      const reducesChargeable = i.metadata?.['reduces_chargeable'] === true;
      if (kind === 'earning') earnings.push({ label: prettyCode(i.label ?? i.component_code), amount: round2(amt) });
      // Only POST-TAX deductions reduce net (match computeRunLine); pre-tax pension is excluded
      // from the net-reconciling list (it affects chargeable income, not net).
      else if (kind === 'deduction' && !reducesChargeable) voluntary.push({ label: prettyCode(i.label ?? i.component_code), amount: round2(amt) });
    }
  }
  if (otTotal > 0) earnings.push({ label: 'Overtime', amount: round2(otTotal) });

  const deductions: PayslipLineItem[] = [
    { label: 'PAYE (Income Tax)', amount: round2(line.paye) },
    { label: 'NIS (Employee)', amount: round2(line.nis_employee) },
    { label: 'Health Surcharge', amount: round2(line.health_surcharge) },
    ...voluntary,
  ].filter(d => d.amount !== 0);

  const totalDeductions = round2(line.paye + line.nis_employee + line.health_surcharge + line.voluntary_deductions);

  // YTD across the tax year's locked/exported runs for this employee
  const year = run.period_month.slice(0, 4);
  const ytd = await computeYtd(ps.employee_id, year);

  return {
    payslipId: ps.id, payslipNo: ps.payslip_no, runId: ps.run_id, runNo: run.run_no,
    periodLabel: monthLabel(run.period_month), periodMonth: run.period_month,
    payFrequency: run.pay_frequency, payDate: run.pay_date, currency: 'TTD',
    employer: { name: companyName },
    employee: {
      id: ps.employee_id, name: emp?.full_name ?? ps.employee_id,
      employeeNumber: emp?.employee_number ?? null, department, position: emp?.position ?? null,
      nisNumberMasked: line.nis_number_masked, nisClassNo: line.nis_class_no,
    },
    bank,
    earnings, deductions,
    employerContributions: [{ label: 'NIS (Employer)', amount: round2(line.nis_employer) }].filter(d => d.amount !== 0),
    gross: round2(line.gross), totalDeductions, net: round2(line.net),
    ytd,
    generatedAt: new Date().toISOString(),
  };
}

async function computeYtd(employeeId: string, year: string): Promise<PayslipSnapshot['ytd']> {
  // Runs in this tax year that are finalised
  const { data: runs } = await sb.from('finance_payroll_runs')
    .select('id')
    .in('status', ['locked', 'exported'])
    .gte('period_month', `${year}-01-01`).lte('period_month', `${year}-12-31`);
  const runIds = (runs ?? []).map((r: { id: string }) => r.id);
  if (runIds.length === 0) return { gross: 0, paye: 0, nisEmployee: 0, healthSurcharge: 0, net: 0 };

  const { data: lines } = await sb.from('finance_payroll_run_lines')
    .select('gross, paye, nis_employee, health_surcharge, net')
    .eq('employee_id', employeeId).in('run_id', runIds);
  const acc = { gross: 0, paye: 0, nisEmployee: 0, healthSurcharge: 0, net: 0 };
  for (const l of (lines ?? []) as Array<{ gross: number; paye: number; nis_employee: number; health_surcharge: number; net: number }>) {
    acc.gross += Number(l.gross); acc.paye += Number(l.paye);
    acc.nisEmployee += Number(l.nis_employee); acc.healthSurcharge += Number(l.health_surcharge);
    acc.net += Number(l.net);
  }
  return {
    gross: round2(acc.gross), paye: round2(acc.paye), nisEmployee: round2(acc.nisEmployee),
    healthSurcharge: round2(acc.healthSurcharge), net: round2(acc.net),
  };
}

// ── PDF renderer (pdfkit) ───────────────────────────────────────────────────

const NAVY = '#1b2d54';
const SLATE = '#64748b';
const LIGHT = '#eef1f6';

export interface RenderOptions {
  /** When set, the PDF is AES-encrypted — the reader must enter this to open it
   *  (used for emailed copies; the self-service bucket copy is left unprotected
   *  because it's already behind an authenticated signed URL). */
  password?: string;
}

/** Render the snapshot to a PDF buffer. Uses built-in Helvetica (no font files). */
export function renderPayslipPdf(s: PayslipSnapshot, opts: RenderOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4', margin: 40,
        info: { Title: `Payslip ${s.payslipNo}`, Author: s.employer.name },
        ...(opts.password ? { userPassword: opts.password, ownerPassword: opts.password, permissions: { printing: 'highResolution', copying: false, modifying: false } } : {}),
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const M = 40;
      const W = doc.page.width - M * 2;
      const money = (n: number): string => `$${n.toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Header
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text(s.employer.name, M, M);
      doc.font('Helvetica').fontSize(9).fillColor(SLATE).text('Trinidad & Tobago Payroll', M, M + 24);
      doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text('PAYSLIP', M, M, { width: W, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor(SLATE)
        .text(`${s.periodLabel} · ${cap(s.payFrequency)}`, M, M + 22, { width: W, align: 'right' })
        .text(`Payslip ${s.payslipNo} · Run ${s.runNo}`, M, M + 34, { width: W, align: 'right' });

      let y = M + 58;
      doc.moveTo(M, y).lineTo(M + W, y).strokeColor('#64748b').lineWidth(1).stroke();
      y += 14;

      // Employee / meta grid (two columns)
      const colW = W / 2;
      const field = (x: number, yy: number, label: string, value: string): void => {
        doc.font('Helvetica').fontSize(7.5).fillColor(SLATE).text(label.toUpperCase(), x, yy);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(value || '—', x, yy + 9, { width: colW - 12 });
      };
      field(M, y, 'Employee', s.employee.name);
      field(M + colW, y, 'Employee No.', s.employee.employeeNumber ?? '—');
      y += 30;
      field(M, y, 'Department', s.employee.department ?? '—');
      field(M + colW, y, 'Position', s.employee.position ?? '—');
      y += 30;
      field(M, y, 'Pay Date', s.payDate ? fmtDate(s.payDate) : '—');
      field(M + colW, y, 'NIS Number', s.employee.nisNumberMasked ?? '—');
      y += 38;

      // Earnings / Deductions two-column tables
      const tableTop = y;
      const gap = 16;
      const tW = (W - gap) / 2;
      const rowH = 16;

      const drawTable = (x: number, title: string, items: PayslipLineItem[], total: number, totalLabel: string): number => {
        doc.rect(x, tableTop, tW, 20).fill(LIGHT);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(title, x + 8, tableTop + 6);
        let ry = tableTop + 24;
        doc.font('Helvetica').fontSize(9).fillColor('#334155');
        if (items.length === 0) { doc.fillColor(SLATE).text('None', x + 8, ry); ry += rowH; }
        for (const it of items) {
          doc.fillColor('#334155').text(it.label, x + 8, ry, { width: tW - 90 });
          doc.text(money(it.amount), x + tW - 82, ry, { width: 74, align: 'right' });
          ry += rowH;
        }
        ry += 4;
        doc.moveTo(x, ry).lineTo(x + tW, ry).strokeColor('#dde3ec').lineWidth(0.5).stroke();
        ry += 6;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(totalLabel, x + 8, ry);
        doc.text(money(total), x + tW - 82, ry, { width: 74, align: 'right' });
        return ry + 20;
      };

      const leftBottom = drawTable(M, 'Earnings', s.earnings, s.gross, 'Gross Pay');
      const rightBottom = drawTable(M + tW + gap, 'Deductions', s.deductions, s.totalDeductions, 'Total Deductions');
      y = Math.max(leftBottom, rightBottom) + 6;

      // Net pay banner
      doc.rect(M, y, W, 34).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#fff').text('NET PAY', M + 12, y + 11);
      doc.fontSize(15).text(money(s.net), M, y + 8, { width: W - 14, align: 'right' });
      y += 48;

      // Employer contributions + Bank + YTD
      const half = W / 2;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE).text('EMPLOYER CONTRIBUTIONS', M, y);
      let ey = y + 12;
      doc.font('Helvetica').fontSize(9).fillColor('#334155');
      for (const it of s.employerContributions) {
        doc.text(`${it.label}`, M, ey);
        doc.text(money(it.amount), M, ey, { width: half - 20, align: 'right' });
        ey += 14;
      }
      if (s.employee.nisClassNo != null) { doc.fillColor(SLATE).fontSize(8).text(`NIS Earnings Class ${toRoman(s.employee.nisClassNo)}`, M, ey); ey += 12; }

      doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE).text('PAYMENT', M + half, y);
      let by = y + 12;
      doc.font('Helvetica').fontSize(9).fillColor('#334155');
      if (s.bank) {
        doc.text(`${s.bank.bankName}`, M + half, by); by += 13;
        doc.text(`${cap(s.bank.accountType)} · ${s.bank.accountMasked}`, M + half, by); by += 13;
      } else {
        doc.fillColor(SLATE).text('No bank account on file', M + half, by); by += 13;
      }
      y = Math.max(ey, by) + 10;

      // YTD strip
      doc.rect(M, y, W, 40).fill('#f8fafc').strokeColor('#e5eaf2').lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE).text(`YEAR TO DATE (${s.periodMonth.slice(0, 4)})`, M + 8, y + 6);
      const ytdCols: Array<[string, number]> = [
        ['Gross', s.ytd.gross], ['PAYE', s.ytd.paye], ['NIS', s.ytd.nisEmployee],
        ['Health Surcharge', s.ytd.healthSurcharge], ['Net', s.ytd.net],
      ];
      const cw = W / ytdCols.length;
      ytdCols.forEach(([label, val], i) => {
        const x = M + i * cw;
        doc.font('Helvetica').fontSize(7.5).fillColor(SLATE).text(label, x + 8, y + 18);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(money(val), x + 8, y + 27, { width: cw - 12 });
      });
      y += 52;

      // Footer
      doc.font('Helvetica').fontSize(7.5).fillColor(SLATE)
        .text(`Computed by SIOMAC on the active Trinidad & Tobago statutory schedule. Generated ${fmtDateTime(s.generatedAt)}. This is a computer-generated payslip.`,
          M, doc.page.height - 55, { width: W, align: 'center' });

      doc.end();
    } catch (e) { reject(e as Error); }
  });
}

// ── small helpers ───────────────────────────────────────────────────────────
function prettyCode(code: string | null): string {
  if (!code) return 'Item';
  return code.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function cap(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function monthLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}
const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function toRoman(n: number): string {
  let out = ''; let x = n;
  for (const [v, r] of ROMAN) { while (x >= v) { out += r; x -= v; } }
  return out || String(n);
}
