// ============================================================================
// Finance Payroll Payslips (Phase 3 Stage 3 + F3 notification hook)
// ============================================================================
// Manages finance_payslips.
//
// Privacy rules:
//   Employee sees ONLY their own payslip.
//   Manager CANNOT see subordinate payslips without finance.payroll.view_all.
//   Bulk generate / list-all requires finance.payroll.view_all.
//   Signed URL download is audited.
//
// Payslips may only be generated for LOCKED runs.
// Generating when a payslip already exists for (run_id, employee_id) is idempotent.
//
// F3 addition: after generating new payslips, emit a payslip-ready notification
// to each employee via notifyMany (fire-and-forget, dedupe-keyed per run).
// ============================================================================

import { createHash } from 'crypto';
import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { nextRef } from '../refGenerator';
import { notifyMany } from '../notify';
import { buildPayslipSnapshot, renderPayslipPdf } from './payslipPdf';

// -- DTO -----------------------------------------------------------------------

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

/** Fire the "payslip ready" in-app notification to a set of employees (dedupe-keyed per run). */
function notifyPayslipReady(employeeIds: string[], runNo: string, runId: string): void {
  if (employeeIds.length === 0) return;
  void notifyMany(employeeIds, {
    type:        'finance.payroll.payslip.ready',
    title:       'Your payslip is ready',
    body:        'Your payslip for payroll run ' + runNo + ' has been generated. Log in to view and download it.',
    link:        's-finance-my-payslips',
    module:      'finance_payroll',
    severity:    'info',
    sourceType:  'payroll_run',
    sourceId:    runId,
    actionRoute: 's-finance-my-payslips',
    metadata:    { runNo, runId },
    dedupeKey:   'payslip.ready.' + runId,
  });
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

// -- Generate payslips for a locked run ----------------------------------------

/**
 * Generate payslips for all employees in a locked run.
 * Only locked (or later) runs may have payslips generated.
 * Idempotent: existing payslips are left intact; only missing ones are created.
 * Returns the full list of payslips for the run after generation.
 *
 * Side-effects (S2):
 *   1. Inserts payslip rows.
 *   2. Writes hr_audit_log row (throws on failure).
 *   3. Emits finance.payroll.payslips.generated app_event (fire-and-forget).
 *   4. Notifies each newly-created payslip employee (fire-and-forget via notifyMany).
 *      dedupeKey payslip.ready.<runId> prevents re-notification on idempotent re-generate.
 */
export async function generatePayslips(runId: string, actorId: string, opts: { notify?: boolean } = { notify: true }): Promise<PayslipDto[]> {
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

  const { data: lines, error: lineErr } = await sb.from('finance_payroll_run_lines')
    .select('id, employee_id')
    .eq('run_id', runId);
  if (lineErr) throw Object.assign(new Error('generatePayslips/lines: ' + lineErr.message), { status: 500 });

  const lineList = (lines ?? []) as { id: string; employee_id: string }[];
  if (lineList.length === 0) {
    throw Object.assign(new Error('No run lines found for this run.'), { status: 422 });
  }

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
        file_path:    null,
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
    // Notification is opt-in: the render flow (renderRunPayslips) suppresses it here and
    // instead notifies AFTER the PDFs actually exist, so employees are never told a payslip
    // is "ready" before it can be downloaded.
    if (opts.notify) {
      const newEmployeeIds = missing.map(l => l.employee_id);
      notifyPayslipReady(newEmployeeIds, run.run_no, runId);
    }
  }

  return listPayslipsForRun(runId);
}

// -- Render a single payslip PDF -> storage ------------------------------------

/**
 * Render one payslip to a PDF, upload it to the private `payslips` bucket, and stamp
 * file_path + pdf_rendered_at + checksum on the row. Idempotent (upsert overwrites).
 * Side-effects: hr_audit_log + app_event. Throws on failure (caller isolates per-row).
 */
export async function renderPayslip(payslipId: string, actorId: string): Promise<PayslipDto> {
  const snapshot = await buildPayslipSnapshot(payslipId);
  const pdf = await renderPayslipPdf(snapshot);
  const checksum = createHash('sha256').update(pdf).digest('hex');
  const filePath = `${snapshot.runId}/${snapshot.payslipNo}.pdf`;

  const { error: upErr } = await sb.storage.from('payslips')
    .upload(filePath, pdf, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw Object.assign(new Error('renderPayslip/upload: ' + upErr.message), { status: 500 });

  const nowIso = new Date().toISOString();
  const { data, error } = await sb.from('finance_payslips')
    .update({ file_path: filePath, pdf_rendered_at: nowIso, pdf_checksum: checksum })
    .eq('id', payslipId).select('*').single<DbPayslipRow>();
  if (error) throw Object.assign(new Error('renderPayslip/update: ' + error.message), { status: 500 });

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: snapshot.runId, actorId,
    action: 'payslip.rendered',
    newState: { payslipId, payslipNo: snapshot.payslipNo, checksum, employeeId: snapshot.employee.id },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.payslip.rendered',
    sourceModule: 'finance_payroll', sourceEntityType: 'payslip', sourceEntityId: payslipId,
    actorUserId: actorId, severity: 'info',
    payload: { payslipNo: snapshot.payslipNo, employeeId: snapshot.employee.id },
  });

  return toPayslipDto(data);
}

// -- Render all payslips for a locked run --------------------------------------

export interface RenderRunResult { rendered: number; failed: number; total: number }

/**
 * Ensure payslip rows exist for a locked run (idempotent generate), then render a PDF for
 * each one still missing its file. Row-level failure isolation: one bad line increments
 * `failed` but never aborts the batch or the run (§11 — PDF failure must not invalidate the
 * run). For very large runs this is Wave-8 job territory; here it renders inline.
 */
export async function renderRunPayslips(runId: string, actorId: string): Promise<RenderRunResult> {
  // Silent generate (notify=false): we notify AFTER the PDFs exist, not before.
  const all = await generatePayslips(runId, actorId, { notify: false });
  const pending = all.filter(p => !p.filePath);
  let rendered = 0, failed = 0;
  const renderedEmployeeIds: string[] = [];
  for (const ps of pending) {
    try { const dto = await renderPayslip(ps.id, actorId); rendered++; renderedEmployeeIds.push(dto.employeeId); }
    catch { failed++; }
  }

  // Notify only the employees whose payslip actually rendered this round.
  if (renderedEmployeeIds.length > 0) {
    const { data: run } = await sb.from('finance_payroll_runs').select('run_no').eq('id', runId).maybeSingle<{ run_no: string }>();
    notifyPayslipReady(renderedEmployeeIds, run?.run_no ?? runId, runId);
  }

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.payslips_rendered',
    newState: { rendered, failed, total: all.length },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.payslips.rendered',
    sourceModule: 'finance_payroll', sourceEntityType: 'payroll_run', sourceEntityId: runId,
    actorUserId: actorId, severity: failed > 0 ? 'warning' : 'success',
    payload: { rendered, failed, total: all.length },
  });

  return { rendered, failed, total: all.length };
}

// -- List payslips for a run (Finance only) ------------------------------------

export async function listPayslipsForRun(runId: string): Promise<PayslipDto[]> {
  const { data, error } = await sb.from('finance_payslips')
    .select('*')
    .eq('run_id', runId)
    .order('employee_id');
  if (error) throw Object.assign(new Error('listPayslipsForRun: ' + error.message), { status: 500 });
  return ((data ?? []) as DbPayslipRow[]).map(toPayslipDto);
}

// -- Get own payslips (employee self-service) ----------------------------------

export async function getMyPayslips(employeeId: string): Promise<PayslipDto[]> {
  const { data, error } = await sb.from('finance_payslips')
    .select('*')
    .eq('employee_id', employeeId)
    .order('generated_at', { ascending: false });
  if (error) throw Object.assign(new Error('getMyPayslips: ' + error.message), { status: 500 });
  return ((data ?? []) as DbPayslipRow[]).map(toPayslipDto);
}

// -- Get single payslip (with ownership check) ---------------------------------

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

// -- Signed payslip URL (download audited) -------------------------------------

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
