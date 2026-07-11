// ============================================================================
// Finance Payroll -- BIR TD4 + TD4 Summary (Wave 7a)
// ============================================================================
// Year-end BIR income-tax certificate. Figures are AGGREGATED from every
// LOCKED/EXPORTED run in the tax year (never hand-edited) + the employer profile
// + the employee statutory profile (NIS # / TIN). Renders a per-employee TD4 PDF
// and an employer TD4 Summary (PDF + CSV), stored via statutoryForms.
//
// HONEST layout: a complete, correct data rendering of every TD4 field — NOT the
// pre-printed BIR stationery pixel-for-pixel (field positions get mapped when the
// official template is supplied). All amounts TTD, 2dp.
// ============================================================================

import PDFDocument from 'pdfkit';
import { sb } from '../db';
import { selectAllRows, chunk } from '../dbBulk';
import { getEmployerProfile, isEmployerProfileComplete, type EmployerProfile } from './employerProfile';
import { recordStatutoryForm, uploadFormArtifact, sha256Hex, type StatutoryFormDto } from './statutoryForms';

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface Td4Row {
  employeeId: string;
  name: string;
  employeeNumber: string | null;
  tin: string | null;            // BIR file number
  nisNumber: string | null;
  periods: number;               // # of runs paid in the year
  totalEmoluments: number;       // sum of gross
  payeDeducted: number;
  nisEmployee: number;
  healthSurcharge: number;
  netPaid: number;
}

export interface Td4YearData {
  taxYear: number;
  employer: EmployerProfile;
  rows: Td4Row[];
  totals: { employees: number; totalEmoluments: number; payeDeducted: number; nisEmployee: number; healthSurcharge: number; netPaid: number };
}

/**
 * Aggregate all finalised run lines in the tax year (optionally one employee).
 * The employer's own payments only — opening YTD from a prior employer is out of
 * scope for THIS employer's TD4.
 */
export async function buildTd4YearData(taxYear: number, employeeId?: string): Promise<Td4YearData> {
  const employer = await getEmployerProfile();

  const { data: runs, error: runErr } = await sb.from('finance_payroll_runs')
    .select('id')
    .in('status', ['locked', 'exported'])
    .gte('period_month', `${taxYear}-01-01`).lte('period_month', `${taxYear}-12-31`);
  if (runErr) throw Object.assign(new Error('buildTd4YearData/runs: ' + runErr.message), { status: 500 });
  const runIds = (runs ?? []).map((r: { id: string }) => r.id);

  const acc = new Map<string, Td4Row>();
  if (runIds.length > 0) {
    // Paginate the run-lines query — a run with 1000+ employees would silently truncate.
    // runIds is typically <=52 (monthly/weekly in one year) so the .in() URL stays safe.
    const lines = await selectAllRows<{ employee_id: string; gross: number; paye: number; nis_employee: number; health_surcharge: number; net: number }>(
      () => {
        let q = sb.from('finance_payroll_run_lines')
          .select('employee_id, gross, paye, nis_employee, health_surcharge, net')
          .in('run_id', runIds).order('id');
        if (employeeId) q = q.eq('employee_id', employeeId);
        return q;
      },
    );
    for (const l of lines) {
      const r = acc.get(l.employee_id) ?? { employeeId: l.employee_id, name: l.employee_id, employeeNumber: null, tin: null, nisNumber: null, periods: 0, totalEmoluments: 0, payeDeducted: 0, nisEmployee: 0, healthSurcharge: 0, netPaid: 0 };
      r.periods += 1;
      r.totalEmoluments += Number(l.gross);
      r.payeDeducted += Number(l.paye);
      r.nisEmployee += Number(l.nis_employee);
      r.healthSurcharge += Number(l.health_surcharge);
      r.netPaid += Number(l.net);
      acc.set(l.employee_id, r);
    }
  }

  const empIds = [...acc.keys()];
  if (empIds.length > 0) {
    // Chunk the lookup IDs — .in() with 1000+ IDs causes URL overflow ("fetch failed").
    const allUsers: Array<{ id: string; full_name: string | null; employee_number: string | null }> = [];
    const allProfiles: Array<{ employee_id: string; nis_number: string | null; bir_file_number: string | null }> = [];
    for (const batch of chunk(empIds, 500)) {
      const [{ data: uBatch, error: uErr }, { data: pBatch, error: pErr }] = await Promise.all([
        sb.from('app_users').select('id, full_name, employee_number').in('id', batch),
        sb.from('hr_employee_statutory_profiles').select('employee_id, nis_number, bir_file_number').in('employee_id', batch),
      ]);
      if (uErr) throw Object.assign(new Error('buildTd4YearData/users: ' + uErr.message), { status: 500 });
      if (pErr) throw Object.assign(new Error('buildTd4YearData/profiles: ' + pErr.message), { status: 500 });
      allUsers.push(...(uBatch ?? []) as typeof allUsers);
      allProfiles.push(...(pBatch ?? []) as typeof allProfiles);
    }
    for (const u of allUsers) {
      const r = acc.get(u.id); if (r) { r.name = u.full_name ?? u.id; r.employeeNumber = u.employee_number; }
    }
    for (const p of allProfiles) {
      const r = acc.get(p.employee_id); if (r) { r.nisNumber = p.nis_number; r.tin = p.bir_file_number; }
    }
  }

  const rows = [...acc.values()].map(r => ({
    ...r, totalEmoluments: round2(r.totalEmoluments), payeDeducted: round2(r.payeDeducted),
    nisEmployee: round2(r.nisEmployee), healthSurcharge: round2(r.healthSurcharge), netPaid: round2(r.netPaid),
  })).sort((a, b) => a.name.localeCompare(b.name));

  const totals = rows.reduce((t, r) => ({
    employees: t.employees + 1,
    totalEmoluments: round2(t.totalEmoluments + r.totalEmoluments),
    payeDeducted: round2(t.payeDeducted + r.payeDeducted),
    nisEmployee: round2(t.nisEmployee + r.nisEmployee),
    healthSurcharge: round2(t.healthSurcharge + r.healthSurcharge),
    netPaid: round2(t.netPaid + r.netPaid),
  }), { employees: 0, totalEmoluments: 0, payeDeducted: 0, nisEmployee: 0, healthSurcharge: 0, netPaid: 0 });

  return { taxYear, employer, rows, totals };
}

// ── PDF rendering ─────────────────────────────────────────────────────────────

const NAVY = '#1b2d54', SLATE = '#64748b', LIGHT = '#eef1f6';
const money = (n: number): string => `$${(Number(n) || 0).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function pdfBuffer(draw: (doc: PDFKit.PDFDocument, M: number, W: number) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      draw(doc, 40, doc.page.width - 80);
      doc.end();
    } catch (e) { reject(e as Error); }
  });
}

function employerHeader(doc: PDFKit.PDFDocument, e: EmployerProfile, M: number, W: number, title: string, sub: string): number {
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text(e.legalName || 'Employer', M, M);
  doc.font('Helvetica').fontSize(8.5).fillColor(SLATE);
  const addr = [e.addressLine1, e.addressLine2, e.city, e.country].filter(Boolean).join(', ');
  let y = M + 20;
  if (addr) { doc.text(addr, M, y); y += 11; }
  doc.text(`BIR File No: ${e.birFileNumber ?? '—'}    NIS Employer No: ${e.nisEmployerNumber ?? '—'}`, M, y); y += 14;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(title, M, M, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(SLATE).text(sub, M, M + 18, { width: W, align: 'right' });
  y = Math.max(y, M + 34) + 6;
  doc.moveTo(M, y).lineTo(M + W, y).strokeColor(SLATE).lineWidth(1).stroke();
  return y + 12;
}

export function renderTd4Pdf(data: Td4YearData, row: Td4Row): Promise<Buffer> {
  return pdfBuffer((doc, M, W) => {
    let y = employerHeader(doc, data.employer, M, W, 'TD4 — Certificate of Emoluments', `Income year ${data.taxYear} · Trinidad & Tobago`);

    const field = (x: number, label: string, value: string, w: number): void => {
      doc.font('Helvetica').fontSize(7.5).fillColor(SLATE).text(label.toUpperCase(), x, y);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(value || '—', x, y + 9, { width: w });
    };
    const half = W / 2;
    field(M, 'Employee', row.name, half - 10);
    field(M + half, 'Employee No.', row.employeeNumber ?? '—', half - 10); y += 30;
    field(M, 'BIR File No. (TIN)', row.tin ?? '—', half - 10);
    field(M + half, 'NIS Number', row.nisNumber ?? '—', half - 10); y += 34;

    // Amounts table
    const rows: Array<[string, number]> = [
      ['Total Emoluments', row.totalEmoluments],
      ['PAYE (Income Tax) Deducted', row.payeDeducted],
      ['NIS — Employee Contributions', row.nisEmployee],
      ['Health Surcharge', row.healthSurcharge],
      ['Net Paid', row.netPaid],
    ];
    doc.rect(M, y, W, 20).fill(LIGHT);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text('For the income year', M + 8, y + 6);
    doc.text('Amount (TTD)', M, y + 6, { width: W - 12, align: 'right' });
    y += 24;
    doc.font('Helvetica').fontSize(10).fillColor('#334155');
    for (const [label, amt] of rows) {
      doc.fillColor('#334155').font('Helvetica').text(label, M + 8, y);
      doc.font('Helvetica-Bold').fillColor(NAVY).text(money(amt), M, y, { width: W - 12, align: 'right' });
      y += 18;
    }
    y += 6;
    doc.font('Helvetica').fontSize(8).fillColor(SLATE)
      .text(`Emoluments paid to the above employee by ${data.employer.legalName || 'the employer'} during income year ${data.taxYear}, and the tax and statutory contributions deducted. Paid over ${row.periods} pay period(s).`, M, y, { width: W });

    doc.font('Helvetica').fontSize(7.5).fillColor(SLATE)
      .text('Computer-generated from locked payroll runs on the active Trinidad & Tobago statutory schedule. Values reconcile to the run lines.', M, doc.page.height - 55, { width: W, align: 'center' });
  });
}

export function renderTd4SummaryPdf(data: Td4YearData): Promise<Buffer> {
  return pdfBuffer((doc, M, W) => {
    let y = employerHeader(doc, data.employer, M, W, 'TD4 Summary', `Employer return · Income year ${data.taxYear}`);

    const cols: Array<[string, number, 'l' | 'r']> = [
      ['Employee', 0.30, 'l'], ['TIN', 0.16, 'l'],
      ['Emoluments', 0.18, 'r'], ['PAYE', 0.13, 'r'], ['NIS', 0.12, 'r'], ['H.S.', 0.11, 'r'],
    ];
    const drawRow = (cells: string[], bold: boolean): void => {
      let x = M;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(bold ? NAVY : '#334155');
      cols.forEach(([, frac, align], i) => {
        const w = W * frac;
        doc.text(cells[i] ?? '', x + 3, y, { width: w - 6, align: align === 'r' ? 'right' : 'left' });
        x += w;
      });
      y += 15;
    };
    doc.rect(M, y - 2, W, 17).fill(LIGHT); doc.fillColor(NAVY);
    drawRow(cols.map(c => c[0]), true);
    for (const r of data.rows) {
      if (y > doc.page.height - 90) { doc.addPage(); y = M; }
      drawRow([r.name, r.tin ?? '—', money(r.totalEmoluments), money(r.payeDeducted), money(r.nisEmployee), money(r.healthSurcharge)], false);
    }
    y += 2; doc.moveTo(M, y).lineTo(M + W, y).strokeColor(SLATE).lineWidth(1).stroke(); y += 4;
    drawRow([`TOTAL (${data.totals.employees} employees)`, '', money(data.totals.totalEmoluments), money(data.totals.payeDeducted), money(data.totals.nisEmployee), money(data.totals.healthSurcharge)], true);
  });
}

export function td4SummaryCsv(data: Td4YearData): string {
  const esc = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  const header = 'EmployeeId,Employee,EmployeeNo,TIN,NISNumber,Periods,TotalEmoluments,PAYE,NISEmployee,HealthSurcharge,NetPaid';
  const rows = data.rows.map(r => [r.employeeId, esc(r.name), r.employeeNumber ?? '', r.tin ?? '', r.nisNumber ?? '', String(r.periods), r.totalEmoluments.toFixed(2), r.payeDeducted.toFixed(2), r.nisEmployee.toFixed(2), r.healthSurcharge.toFixed(2), r.netPaid.toFixed(2)].join(','));
  const total = ['', 'TOTAL', '', '', '', String(data.totals.employees), data.totals.totalEmoluments.toFixed(2), data.totals.payeDeducted.toFixed(2), data.totals.nisEmployee.toFixed(2), data.totals.healthSurcharge.toFixed(2), data.totals.netPaid.toFixed(2)].join(',');
  return [header, ...rows, total].join('\n');
}

// ── Generation (build -> render -> upload -> record) ────────────────────────────

function assertGeneratable(data: Td4YearData): void {
  const complete = isEmployerProfileComplete(data.employer);
  if (!complete.ok) throw Object.assign(new Error('Employer profile incomplete — set ' + complete.missing.join(', ') + ' before generating TD4 forms.'), { status: 422 });
  if (data.rows.length === 0) throw Object.assign(new Error(`No locked/exported payroll runs found for tax year ${data.taxYear}.`), { status: 422 });
}

export async function generateTd4ForEmployee(employeeId: string, taxYear: number, actorId: string): Promise<StatutoryFormDto> {
  const data = await buildTd4YearData(taxYear, employeeId);
  assertGeneratable(data);
  const row = data.rows[0]!;
  const pdf = await renderTd4Pdf(data, row);
  const key = `td4/${taxYear}/${employeeId}-${Date.now()}.pdf`;
  await uploadFormArtifact(key, pdf, 'application/pdf');
  return recordStatutoryForm({
    formType: 'td4', taxYear, employeeId, scope: 'employee', filePath: key,
    totals: { totalEmoluments: row.totalEmoluments, payeDeducted: row.payeDeducted, nisEmployee: row.nisEmployee, healthSurcharge: row.healthSurcharge },
    checksum: sha256Hex(pdf), actorId,
  });
}

export interface GenerateTd4YearResult { taxYear: number; employeeForms: number; summary: StatutoryFormDto; }

export async function generateTd4Year(taxYear: number, actorId: string): Promise<GenerateTd4YearResult> {
  const data = await buildTd4YearData(taxYear);
  assertGeneratable(data);
  const stamp = Date.now();
  let count = 0;
  for (const row of data.rows) {
    const pdf = await renderTd4Pdf(data, row);
    const key = `td4/${taxYear}/${row.employeeId}-${stamp}.pdf`;
    await uploadFormArtifact(key, pdf, 'application/pdf');
    await recordStatutoryForm({
      formType: 'td4', taxYear, employeeId: row.employeeId, scope: 'employee', filePath: key,
      totals: { totalEmoluments: row.totalEmoluments, payeDeducted: row.payeDeducted, nisEmployee: row.nisEmployee, healthSurcharge: row.healthSurcharge },
      checksum: sha256Hex(pdf), actorId,
    });
    count += 1;
  }
  const summaryPdf = await renderTd4SummaryPdf(data);
  const csv = td4SummaryCsv(data);
  const pdfKey = `td4_summary/${taxYear}-${stamp}.pdf`;
  const csvKey = `td4_summary/${taxYear}-${stamp}.csv`;
  await uploadFormArtifact(pdfKey, summaryPdf, 'application/pdf');
  await uploadFormArtifact(csvKey, new TextEncoder().encode(csv), 'text/csv');
  const summary = await recordStatutoryForm({
    formType: 'td4_summary', taxYear, scope: 'employer', filePath: pdfKey, dataFilePath: csvKey,
    totals: data.totals, checksum: sha256Hex(summaryPdf), actorId, metadata: { employeeForms: count },
  });
  return { taxYear, employeeForms: count, summary };
}
