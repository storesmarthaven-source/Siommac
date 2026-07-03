// ============================================================================
// Finance — Payroll Exports (Phase 3 Stage 3)
// ============================================================================
// Manages finance_payroll_exports.
//
// Rules (§8.5):
//   • Only 'locked' runs may be exported.
//   • Each export creates a new artifact row.
//   • Re-export: prior is_current rows for this run are set to false before insert.
//   • Transitions run status: locked → exported on first export.
//   • Does NOT disburse funds.
//   • Audited via app_events + hr_audit_log.
//
// Formats: csv and json (xlsx/pdf are structural stubs — no dep needed).
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { nextRef } from '../refGenerator';
import { listRunLines } from './payrollRuns';

// ── DTO ───────────────────────────────────────────────────────────────────────

export interface PayrollExportDto {
  id: string;
  exportNo: string;
  runId: string;
  format: string;
  filePath: string;
  checksum: string | null;
  generatedBy: string | null;
  generatedAt: string;
  isCurrent: boolean;
  metadata: Record<string, unknown>;
}

interface DbExportRow {
  id: string;
  export_no: string;
  run_id: string;
  format: string;
  file_path: string;
  checksum: string | null;
  generated_by: string | null;
  generated_at: string;
  is_current: boolean;
  metadata: Record<string, unknown>;
}

function toExportDto(r: DbExportRow): PayrollExportDto {
  return {
    id:          r.id,
    exportNo:    r.export_no,
    runId:       r.run_id,
    format:      r.format,
    filePath:    r.file_path,
    checksum:    r.checksum,
    generatedBy: r.generated_by,
    generatedAt: r.generated_at,
    isCurrent:   r.is_current,
    metadata:    r.metadata,
  };
}

// ── Simple checksum (SHA-256 via Web Crypto) ─────────────────────────────────

async function sha256Hex(data: string): Promise<string> {
  const buf = new TextEncoder().encode(data);
  try {
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Fallback: simple length + crc32-like (non-crypto, just deterministic)
    let crc = 0xDEADBEEF;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ ((crc ^ (buf[i] ?? 0)) & 0xFF) * 0x1DB7;
    }
    return (crc >>> 0).toString(16).padStart(8, '0') + '_len' + buf.length;
  }
}

// ── Build export content ──────────────────────────────────────────────────────

interface ExportLine {
  employeeId: string;
  base: number;
  taxableGross: number;
  gross: number;
  nisEmployee: number;
  nisEmployer: number;
  healthSurcharge: number;
  chargeableIncome: number;
  paye: number;
  voluntaryDeductions: number;
  net: number;
  nisNumberMasked: string | null;
  nisStatus: string | null;
  nisClassNo: number | null;
}

async function buildExportContent(
  runId: string,
  format: 'csv' | 'json' | 'xlsx' | 'pdf',
): Promise<{ content: string; mimeType: string }> {
  const lines = await listRunLines(runId);

  const exportLines: ExportLine[] = lines.map(l => ({
    employeeId:          l.employeeId,
    base:                l.base,
    taxableGross:        l.taxableGross,
    gross:               l.gross,
    nisEmployee:         l.nisEmployee,
    nisEmployer:         l.nisEmployer,
    healthSurcharge:     l.healthSurcharge,
    chargeableIncome:    l.chargeableIncome,
    paye:                l.paye,
    voluntaryDeductions: l.voluntaryDeductions,
    net:                 l.net,
    nisNumberMasked:     l.nisNumberMasked,
    nisStatus:           l.nisStatus,
    nisClassNo:          l.nisClassNo,
  }));

  if (format === 'json') {
    return {
      content:  JSON.stringify({ runId, lines: exportLines, exportedAt: new Date().toISOString() }, null, 2),
      mimeType: 'application/json',
    };
  }

  // csv (default and xlsx/pdf stubs)
  const headers = [
    'employee_id', 'base', 'taxable_gross', 'gross',
    'nis_employee', 'nis_employer', 'health_surcharge',
    'chargeable_income', 'paye', 'voluntary_deductions', 'net',
    'nis_number_masked', 'nis_status', 'nis_class_no',
  ].join(',');

  const rows = exportLines.map(l =>
    [
      l.employeeId, l.base, l.taxableGross, l.gross,
      l.nisEmployee, l.nisEmployer, l.healthSurcharge,
      l.chargeableIncome, l.paye, l.voluntaryDeductions, l.net,
      l.nisNumberMasked ?? '', l.nisStatus ?? '', l.nisClassNo ?? '',
    ].join(','),
  );

  return {
    content:  [headers, ...rows].join('\n'),
    mimeType: 'text/csv',
  };
}

// ── Export run ────────────────────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'pdf';

/**
 * Export a locked payroll run.
 * - Requires run status = 'locked'.
 * - Marks prior exports for this run as is_current = false.
 * - Creates a new export artifact with the generated content.
 * - Transitions run status: 'locked' → 'exported' on first export;
 *   subsequent re-exports keep status as 'exported' and just add a new artifact.
 * - Does NOT disburse funds.
 */
export async function exportRun(
  runId: string,
  actorId: string,
  format: ExportFormat = 'csv',
): Promise<PayrollExportDto> {
  const validFormats = ['csv', 'json', 'xlsx', 'pdf'] as const;
  if (!(validFormats as readonly string[]).includes(format)) {
    throw Object.assign(new Error(`Invalid export format '${format}'. Valid: csv, json, xlsx, pdf.`), { status: 422 });
  }

  const { data: run, error: runErr } = await sb.from('finance_payroll_runs')
    .select('id, run_no, status, period_month')
    .eq('id', runId)
    .maybeSingle<{ id: string; run_no: string; status: string; period_month: string }>();
  if (runErr) throw Object.assign(new Error('exportRun/run: ' + runErr.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });

  if (run.status !== 'locked' && run.status !== 'exported') {
    throw Object.assign(
      new Error(`Cannot export: run is in status '${run.status}'. Only 'locked' (or already 'exported') runs can be exported.`),
      { status: 422 },
    );
  }

  // Build content
  const { content, mimeType } = await buildExportContent(runId, format);
  const checksum = await sha256Hex(content);
  const exportNo = await nextRef('EXP');

  // Derive a synthetic "file_path" — in production this would be a Storage upload
  // For now: a deterministic logical path so the artifact is addressable.
  const filePath = `payroll_exports/${run.run_no}/${exportNo}.${format}`;

  // Mark all prior current exports for this run as not current
  await sb.from('finance_payroll_exports')
    .update({ is_current: false })
    .eq('run_id', runId)
    .eq('is_current', true);

  const { data: exportRow, error: insertErr } = await sb.from('finance_payroll_exports')
    .insert({
      export_no:    exportNo,
      run_id:       runId,
      format,
      file_path:    filePath,
      checksum,
      generated_by: actorId,
      is_current:   true,
      metadata:     { mimeType, lineCount: content.split('\n').length - 1, runNo: run.run_no },
    })
    .select()
    .single<DbExportRow>();
  if (insertErr) throw Object.assign(new Error('exportRun/insert: ' + insertErr.message), { status: 500 });

  // Transition run to exported (idempotent: no-op if already exported)
  const now = new Date().toISOString();
  await sb.from('finance_payroll_runs')
    .update({ status: 'exported', exported_at: now })
    .eq('id', runId)
    .in('status', ['locked', 'exported']); // safe for re-export

  const dto = toExportDto(exportRow);

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.exported',
    previousState: { status: run.status },
    newState: { status: 'exported', exportNo, format, checksum },
  });

  void emitAppEvent({
    eventType:        'finance.payroll.run.exported',
    sourceModule:     'finance_payroll',
    sourceEntityType: 'payroll_run',
    sourceEntityId:   runId,
    actorUserId:      actorId,
    severity:         'success',
    payload:          { runNo: run.run_no, exportNo, format, checksum },
  });

  return dto;
}

// ── List exports for a run ───────────────────────────────────────────────────

export async function listRunExports(runId: string): Promise<PayrollExportDto[]> {
  const { data, error } = await sb.from('finance_payroll_exports')
    .select('*')
    .eq('run_id', runId)
    .order('generated_at', { ascending: false });
  if (error) throw Object.assign(new Error('listRunExports: ' + error.message), { status: 500 });
  return ((data ?? []) as DbExportRow[]).map(toExportDto);
}
