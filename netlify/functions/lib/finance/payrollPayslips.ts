// ============================================================================
// Finance — Payroll Payslips (Phase 3 Stage 3)
// ============================================================================
// Manages finance_payslips.
//
// Privacy rules (§8.4):
//   • Employee sees ONLY their own payslip.
//   • Manager CANNOT see a subordinate's payslip by default.
//   • HR CANNOT see payslips unless explicitly granted finance.payroll.view_all.
//   • Bulk generate / list-all → finance.payroll.view_all only.
//   • Signed URL download is audited.
//
// Payslips may only be generated for LOCKED runs.
// Generating when a payslip already exists for (run_id, employee_id) is idempotent
// (returns the existing record rather than erroring).
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { nextRef } from '../refGenerator';

// ── DTO ───────────────────────────────────────────────────────────────────────

export interface PayslipDto {
  id: string;
  payslipNo: string;
  runId: string;
  runLineId: string;
  employeeId: string;
  filePath: string | null;
  generatedAt: string;
  generatedBy: string | null;
  metadata: Record<string, unknown>;
}

interface DbPayslipRow {
  id: string;
  payslip_no: string;
  run_id: string;
  run_line_id: string;
  employee_id: string;
  file_path: string | null;
  generated_at: string;
  generated_by: string | null;
  metadata: Record<string, unknown>;
}

function toPayslipDto(r: DbPayslipRow): PayslipDto {
  return {
    id:          r.id,
    payslipNo:   r.payslip_no,
    runId:       r.run_id,
    runLineId:   r.run_line_id,
    employeeId:  r.employee_id,
    filePath:    r.file_path,
    generatedAt: r.generated_at,
    generatedBy: r.generated_by,
    metadata:    r.metadata,
  };
}

// ── Generate payslips for a locked run ───────────────────────────────────────

/**
 * Generate payslips for all employees in a locked run.
 * Only 'locked' (or later) runs may have payslips generated.
 * Idempotent: existing payslips are left intact; only missing ones are created.
 * Returns the full list of payslips for the run after generation.
 */
export async function generatePayslips(runId: string, actorId: string): Promise<PayslipDto[]> {
  // Guard: run must be locked (or exported)
  const { data: run, error: runErr } = await sb.from('finance_payroll_runs')
    .select('id, run_no, status')
    .eq('id', runId)
    .maybeSingle<{ id: string; run_no: string; status: string }>();
  if (runErr) throw Object.assign(new Error('generatePayslips/run: ' + runErr.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!['locked', 'exported'].includes(run.status)) {
    throw Object.assign(
      new Error(`Payslips can only be generated for locked runs. Run is in status '${run.status}'.`),
      { status: 422 },
    );
  }

  // Load all run lines
  const { data: lines, error: lineErr } = await sb.from('finance_payroll_run_lines')
    .select('id, employee_id')
    .eq('run_id', runId);
  if (lineErr) throw Object.assign(new Error('generatePayslips/lines: ' + lineErr.message), { status: 500 });

  const lineList = (lines ?? []) as { id: string; employee_id: string }[];
  if (lineList.length === 0) {
    throw Object.assign(new Error('No run lines found for this run.'), { status: 422 });
  }

  // Find which employees already have a payslip for this run
  const { data: existing, error: exErr } = await sb.from('finance_payslips')
    .select('employee_id')
    .eq('run_id', runId);
  if (exErr) throw Object.assign(new Error('generatePayslips/existing: ' + exErr.message), { status: 500 });

  const existingEmployeeIds = new Set(((existing ?? []) as { employee_id: string }[]).map(r => r.employee_id));
  const missing = lineList.filter(l => !existingEmployeeIds.has(l.employee_id));

  if (missing.length > 0) {
    const insertRows: Record<string, unknown>[] = [];
    for (const line of missing) {
      const payslipNo = await nextRef('PSL');
      insertRows.push({
        payslip_no:   payslipNo,
        run_id:       runId,
        run_line_id:  line.id,
        employee_id:  line.employee_id,
        file_path:    null,        // file generation is an async / external step
        generated_by: actorId,
        metadata:     {},
      });
    }

    const { error: insertErr } = await sb.from('finance_payslips').insert(insertRows);
    if (insertErr) throw Object.assign(new Error('generatePayslips/insert: ' + insertErr.message), { status: 500 });

    await writeHrAudit({
      submoduleKey: 'finance_payroll', recordId: runId, actorId,
      action: 'payroll_run.payslips_generated',
      previousState: { existingCount: existingEmployeeIds.size },
      newState: { generatedCount: missing.length, totalCount: lineList.length },
    });

    void emitAppEvent({
      eventType:        'finance.payroll.payslips.generated',
      sourceModule:     'finance_payroll',
      sourceEntityType: 'payroll_run',
      sourceEntityId:   runId,
      actorUserId:      actorId,
      severity:         'info',
      payload:          { runNo: run.run_no, generatedCount: missing.length },
    });
  }

  return listPayslipsForRun(runId);
}

// ── List payslips for a run (Finance only) ───────────────────────────────────

export async function listPayslipsForRun(runId: string): Promise<PayslipDto[]> {
  const { data, error } = await sb.from('finance_payslips')
    .select('*')
    .eq('run_id', runId)
    .order('employee_id');
  if (error) throw Object.assign(new Error('listPayslipsForRun: ' + error.message), { status: 500 });
  return ((data ?? []) as DbPayslipRow[]).map(toPayslipDto);
}

// ── Get own payslips (employee self-service) ─────────────────────────────────

/**
 * Return all payslips for the calling employee (self-scope enforced).
 * Does NOT allow viewing another employee's payslips — use listPayslipsForRun for Finance.
 */
export async function getMyPayslips(employeeId: string): Promise<PayslipDto[]> {
  const { data, error } = await sb.from('finance_payslips')
    .select('*')
    .eq('employee_id', employeeId)
    .order('generated_at', { ascending: false });
  if (error) throw Object.assign(new Error('getMyPayslips: ' + error.message), { status: 500 });
  return ((data ?? []) as DbPayslipRow[]).map(toPayslipDto);
}

// ── Get single payslip (with ownership check) ────────────────────────────────

/**
 * Return a single payslip.
 * ownerFilter: if provided, throws 403 if the payslip does not belong to that employee.
 * Finance staff/managers call this without ownerFilter.
 */
export async function getPayslip(
  payslipId: string,
  ownerFilter?: string,
): Promise<PayslipDto | null> {
  const { data, error } = await sb.from('finance_payslips')
    .select('*')
    .eq('id', payslipId)
    .maybeSingle<DbPayslipRow>();
  if (error) throw Object.assign(new Error('getPayslip: ' + error.message), { status: 500 });
  if (!data) return null;

  if (ownerFilter && data.employee_id !== ownerFilter) {
    throw Object.assign(new Error('Forbidden: you may only view your own payslips.'), { status: 403 });
  }

  return toPayslipDto(data);
}

// ── Signed payslip URL (download audited) ────────────────────────────────────

/**
 * Return a short-lived (expiring) signed URL for a payslip file download.
 * Ownership is enforced: pass callerEmployeeId for employee self-service,
 * or null for Finance roles (which have already been permission-gated).
 * Download is audited via app_events.
 */
export async function signedPayslipUrl(
  payslipId: string,
  callerEmployeeId: string | null,
  actorId: string,
): Promise<{ url: string; expiresAt: string }> {
  const payslip = await getPayslip(payslipId, callerEmployeeId ?? undefined);
  if (!payslip) throw Object.assign(new Error('Payslip not found.'), { status: 404 });

  if (!payslip.filePath) {
    throw Object.assign(new Error('Payslip file has not been generated yet.'), { status: 422 });
  }

  // Generate a signed URL from Supabase Storage (60-minute expiry)
  const { data: signed, error: signErr } = await sb.storage
    .from('payslips')
    .createSignedUrl(payslip.filePath, 3600);

  if (signErr || !signed?.signedUrl) {
    throw Object.assign(
      new Error('Failed to generate signed URL: ' + (signErr?.message ?? 'unknown')),
      { status: 500 },
    );
  }

  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

  // Audit the download
  void emitAppEvent({
    eventType:        'finance.payroll.payslip.downloaded',
    sourceModule:     'finance_payroll',
    sourceEntityType: 'payslip',
    sourceEntityId:   payslipId,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { employeeId: payslip.employeeId, runId: payslip.runId, payslipNo: payslip.payslipNo },
  });

  return { url: signed.signedUrl, expiresAt };
}
