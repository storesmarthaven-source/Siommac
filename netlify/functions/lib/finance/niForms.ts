// ============================================================================
// Finance Payroll -- NIBTT NI184 (contribution schedule) + NI187 (remittance)
// (Wave 7b)
// ============================================================================
// Monthly NIS return. Figures aggregate every LOCKED/EXPORTED run whose period
// falls in the contribution month, per employee: earnings class, insurable
// earnings (gross basis), employee + employer NIS contributions. NI184 is the
// per-employee schedule; NI187 the employer remittance summary. PDF + CSV.
// HONEST layout (complete data, not the NIBTT pre-printed stationery pixel map).
// ============================================================================

import PDFDocument from 'pdfkit';
import { sb } from '../db';
import { getEmployerProfile, isEmployerProfileComplete, type EmployerProfile } from './employerProfile';
import { recordStatutoryForm, uploadFormArtifact, sha256Hex, type StatutoryFormDto } from './statutoryForms';

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface NiRow {
  employeeId: string;
  name: string;
  nisNumber: string | null;
  classNo: number | null;       // NIS earnings class
  weeks: number;                // # of runs contributing in the period
  insurableEarnings: number;    // gross basis
  eeContribution: number;
  erContribution: number;
  total: number;
}

export interface NiPeriodData {
  periodStart: string;          // YYYY-MM-01
  periodEnd: string;            // YYYY-MM-<last>
  monthLabel: string;           // "June 2027"
  employer: EmployerProfile;
  rows: NiRow[];
  totals: { employees: number; insurableEarnings: number; eeContribution: number; erContribution: number; total: number };
}

function monthBounds(year: number, month: number): { start: string; end: string; label: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start, end, label };
}

export async function buildNiPeriodData(year: number, month: number): Promise<NiPeriodData> {
  const employer = await getEmployerProfile();
  const { start, end, label } = monthBounds(year, month);

  const { data: runs, error: runErr } = await sb.from('finance_payroll_runs')
    .select('id')
    .in('status', ['locked', 'exported'])
    .gte('period_month', start).lte('period_month', end);
  if (runErr) throw Object.assign(new Error('buildNiPeriodData/runs: ' + runErr.message), { status: 500 });
  const runIds = (runs ?? []).map((r: { id: string }) => r.id);

  const acc = new Map<string, NiRow>();
  if (runIds.length > 0) {
    const { data: lines, error: lineErr } = await sb.from('finance_payroll_run_lines')
      .select('employee_id, gross, nis_employee, nis_employer, nis_class_no')
      .in('run_id', runIds);
    if (lineErr) throw Object.assign(new Error('buildNiPeriodData/lines: ' + lineErr.message), { status: 500 });
    for (const l of (lines ?? []) as Array<{ employee_id: string; gross: number; nis_employee: number; nis_employer: number; nis_class_no: number | null }>) {
      // Only lines that actually attracted NIS belong on the schedule.
      if (Number(l.nis_employee) <= 0 && Number(l.nis_employer) <= 0) continue;
      const r = acc.get(l.employee_id) ?? { employeeId: l.employee_id, name: l.employee_id, nisNumber: null, classNo: l.nis_class_no, weeks: 0, insurableEarnings: 0, eeContribution: 0, erContribution: 0, total: 0 };
      r.weeks += 1;
      r.insurableEarnings += Number(l.gross);
      r.eeContribution += Number(l.nis_employee);
      r.erContribution += Number(l.nis_employer);
      if (l.nis_class_no != null) r.classNo = l.nis_class_no;   // last non-null class
      acc.set(l.employee_id, r);
    }
  }

  const empIds = [...acc.keys()];
  if (empIds.length > 0) {
    const [{ data: users }, { data: profiles }] = await Promise.all([
      sb.from('app_users').select('id, full_name').in('id', empIds),
      sb.from('hr_employee_statutory_profiles').select('employee_id, nis_number').in('employee_id', empIds),
    ]);
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null }>) { const r = acc.get(u.id); if (r) r.name = u.full_name ?? u.id; }
    for (const p of (profiles ?? []) as Array<{ employee_id: string; nis_number: string | null }>) { const r = acc.get(p.employee_id); if (r) r.nisNumber = p.nis_number; }
  }

  const rows = [...acc.values()].map(r => ({
    ...r, insurableEarnings: round2(r.insurableEarnings), eeContribution: round2(r.eeContribution),
    erContribution: round2(r.erContribution), total: round2(r.eeContribution + r.erContribution),
  })).sort((a, b) => a.name.localeCompare(b.name));

  const totals = rows.reduce((t, r) => ({
    employees: t.employees + 1,
    insurableEarnings: round2(t.insurableEarnings + r.insurableEarnings),
    eeContribution: round2(t.eeContribution + r.eeContribution),
    erContribution: round2(t.erContribution + r.erContribution),
    total: round2(t.total + r.total),
  }), { employees: 0, insurableEarnings: 0, eeContribution: 0, erContribution: 0, total: 0 });

  return { periodStart: start, periodEnd: end, monthLabel: label, employer, rows, totals };
}

// ── PDF rendering ─────────────────────────────────────────────────────────────

const NAVY = '#1b2d54', SLATE = '#64748b', LIGHT = '#eef1f6';
const money = (n: number): string => `$${(Number(n) || 0).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function toRoman(n: number | null): string { if (n == null) return '—'; let out = '', x = n; for (const [v, r] of ROMAN) while (x >= v) { out += r; x -= v; } return out || String(n); }

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

function header(doc: PDFKit.PDFDocument, e: EmployerProfile, M: number, W: number, title: string, sub: string): number {
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text(e.legalName || 'Employer', M, M);
  doc.font('Helvetica').fontSize(8.5).fillColor(SLATE)
    .text(`NIS Employer No: ${e.nisEmployerNumber ?? '—'}    BIR File No: ${e.birFileNumber ?? '—'}`, M, M + 20);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(title, M, M, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(SLATE).text(sub, M, M + 18, { width: W, align: 'right' });
  const y = M + 36;
  doc.moveTo(M, y).lineTo(M + W, y).strokeColor(SLATE).lineWidth(1).stroke();
  return y + 12;
}

export function renderNi184Pdf(data: NiPeriodData): Promise<Buffer> {
  return pdfBuffer((doc, M, W) => {
    let y = header(doc, data.employer, M, W, 'NI184 — Contributions Schedule', `NIS monthly return · ${data.monthLabel}`);
    const cols: Array<[string, number, 'l' | 'r']> = [
      ['Employee', 0.28, 'l'], ['NIS No.', 0.15, 'l'], ['Class', 0.08, 'l'],
      ['Insurable', 0.17, 'r'], ['Employee', 0.11, 'r'], ['Employer', 0.11, 'r'], ['Total', 0.10, 'r'],
    ];
    const row = (cells: string[], bold: boolean): void => {
      let x = M; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(bold ? NAVY : '#334155');
      cols.forEach(([, frac, align], i) => { const w = W * frac; doc.text(cells[i] ?? '', x + 3, y, { width: w - 6, align: align === 'r' ? 'right' : 'left' }); x += w; });
      y += 15;
    };
    doc.rect(M, y - 2, W, 17).fill(LIGHT); doc.fillColor(NAVY);
    row(cols.map(c => c[0]), true);
    for (const r of data.rows) {
      if (y > doc.page.height - 90) { doc.addPage(); y = M; }
      row([r.name, r.nisNumber ?? '—', toRoman(r.classNo), money(r.insurableEarnings), money(r.eeContribution), money(r.erContribution), money(r.total)], false);
    }
    y += 2; doc.moveTo(M, y).lineTo(M + W, y).strokeColor(SLATE).lineWidth(1).stroke(); y += 4;
    row([`TOTAL (${data.totals.employees})`, '', '', money(data.totals.insurableEarnings), money(data.totals.eeContribution), money(data.totals.erContribution), money(data.totals.total)], true);
  });
}

export function renderNi187Pdf(data: NiPeriodData): Promise<Buffer> {
  return pdfBuffer((doc, M, W) => {
    let y = header(doc, data.employer, M, W, 'NI187 — Remittance Summary', `NIS monthly remittance · ${data.monthLabel}`);
    const line = (label: string, value: string): void => {
      doc.font('Helvetica').fontSize(10).fillColor('#334155').text(label, M + 8, y);
      doc.font('Helvetica-Bold').fillColor(NAVY).text(value, M, y, { width: W - 12, align: 'right' });
      y += 20;
    };
    doc.rect(M, y, W, 20).fill(LIGHT); doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text('For the month', M + 8, y + 6); y += 26;
    line('Contributing employees', String(data.totals.employees));
    line('Total insurable earnings', money(data.totals.insurableEarnings));
    line('Employee contributions', money(data.totals.eeContribution));
    line('Employer contributions', money(data.totals.erContribution));
    y += 4; doc.moveTo(M, y).lineTo(M + W, y).strokeColor(SLATE).lineWidth(1).stroke(); y += 8;
    line('TOTAL NIS REMITTANCE', money(data.totals.total));
    y += 10;
    doc.font('Helvetica').fontSize(8).fillColor(SLATE).text('Computer-generated from locked payroll runs on the active Trinidad & Tobago NIS earnings-class schedule. Figures reconcile to the NI184 contributions schedule.', M, y, { width: W });
  });
}

export function ni184Csv(data: NiPeriodData): string {
  const esc = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  const header = 'EmployeeId,Employee,NISNumber,Class,Weeks,InsurableEarnings,EmployeeContribution,EmployerContribution,Total';
  const rows = data.rows.map(r => [r.employeeId, esc(r.name), r.nisNumber ?? '', toRoman(r.classNo), String(r.weeks), r.insurableEarnings.toFixed(2), r.eeContribution.toFixed(2), r.erContribution.toFixed(2), r.total.toFixed(2)].join(','));
  const total = ['', 'TOTAL', '', '', '', data.totals.insurableEarnings.toFixed(2), data.totals.eeContribution.toFixed(2), data.totals.erContribution.toFixed(2), data.totals.total.toFixed(2)].join(',');
  return [header, ...rows, total].join('\n');
}

// ── Generation ───────────────────────────────────────────────────────────────

export interface GenerateNiResult { periodStart: string; periodEnd: string; ni184: StatutoryFormDto; ni187: StatutoryFormDto; }

export async function generateNiPeriod(year: number, month: number, actorId: string): Promise<GenerateNiResult> {
  const data = await buildNiPeriodData(year, month);
  const complete = isEmployerProfileComplete(data.employer);
  if (!complete.ok) throw Object.assign(new Error('Employer profile incomplete — set ' + complete.missing.join(', ') + ' before generating NI forms.'), { status: 422 });
  if (data.rows.length === 0) throw Object.assign(new Error(`No NIS contributions found in locked runs for ${data.monthLabel}.`), { status: 422 });

  const stamp = Date.now();
  const ni184Pdf = await renderNi184Pdf(data);
  const csv = ni184Csv(data);
  const ni184Key = `ni184/${data.periodStart}-${stamp}.pdf`;
  const csvKey   = `ni184/${data.periodStart}-${stamp}.csv`;
  await uploadFormArtifact(ni184Key, ni184Pdf, 'application/pdf');
  await uploadFormArtifact(csvKey, new TextEncoder().encode(csv), 'text/csv');
  const ni184 = await recordStatutoryForm({
    formType: 'ni184', periodStart: data.periodStart, periodEnd: data.periodEnd, scope: 'employer',
    filePath: ni184Key, dataFilePath: csvKey, totals: data.totals, checksum: sha256Hex(ni184Pdf), actorId,
  });

  const ni187Pdf = await renderNi187Pdf(data);
  const ni187Key = `ni187/${data.periodStart}-${stamp}.pdf`;
  await uploadFormArtifact(ni187Key, ni187Pdf, 'application/pdf');
  const ni187 = await recordStatutoryForm({
    formType: 'ni187', periodStart: data.periodStart, periodEnd: data.periodEnd, scope: 'employer',
    filePath: ni187Key, totals: data.totals, checksum: sha256Hex(ni187Pdf), actorId,
  });

  return { periodStart: data.periodStart, periodEnd: data.periodEnd, ni184, ni187 };
}
