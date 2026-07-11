// ============================================================================
// Finance Payroll — Payslip email delivery + tracking (Wave 1, increment 2)
// ============================================================================
// Emails a RENDERED payslip to the employee as a PASSWORD-PROTECTED PDF (the
// self-service bucket copy stays unprotected — it's already behind an
// authenticated signed URL). Every attempt is recorded in
// finance_payslip_deliveries so Finance can see status + resend.
//
// Decoupled from the run: a failed/skipped send NEVER invalidates the run.
// When RESEND_API_KEY is absent (dev / E2E), the send is recorded as 'skipped'
// rather than 'failed', so downstream flows/tests don't depend on a live mailbox.
// Password = employee date of birth DDMMYYYY (a standard T&T payroll convention);
// omitted (unprotected) when no DOB is on file.
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { buildPayslipSnapshot, renderPayslipPdf } from './payslipPdf';

export interface PayslipDeliveryDto {
  id: string;
  payslipId: string;
  runId: string;
  employeeId: string;
  channel: string;
  recipient: string | null;          // masked
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  passwordProtected: boolean;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface DbDeliveryRow {
  id: string; payslip_id: string; run_id: string; employee_id: string;
  channel: string; recipient: string | null; status: PayslipDeliveryDto['status'];
  password_protected: boolean; attempts: number; error: string | null;
  sent_at: string | null; created_at: string;
}

function toDeliveryDto(r: DbDeliveryRow): PayslipDeliveryDto {
  return {
    id: r.id, payslipId: r.payslip_id, runId: r.run_id, employeeId: r.employee_id,
    channel: r.channel, recipient: r.recipient, status: r.status,
    passwordProtected: r.password_protected, attempts: r.attempts, error: r.error,
    sentAt: r.sent_at, createdAt: r.created_at,
  };
}

/** Date of birth (YYYY-MM-DD) → DDMMYYYY, or null. */
function derivePassword(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const d = new Date(dob + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${d.getUTCFullYear()}`;
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain || !user) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}

function buildDeliveryHtml(payslipNo: string, period: string, employer: string, employeeName: string, protectedPdf: boolean): string {
  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1b2d54;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h2 style="color:#1b2d54;margin:0 0 4px;">${employer}</h2>
    <p style="color:#64748b;margin:0 0 18px;font-size:13px;">Payroll</p>
    <p>Dear ${employeeName},</p>
    <p>Your payslip <strong>${payslipNo}</strong> for <strong>${period}</strong> is attached as a PDF.</p>
    ${protectedPdf
      ? `<p style="background:#f2f6fc;border:1px solid #dde3ec;border-radius:8px;padding:12px;font-size:13px;">
           The PDF is password-protected. Your password is your <strong>date of birth</strong> in
           <strong>DDMMYYYY</strong> format (e.g. 07&nbsp;March&nbsp;1990 → <code>07031990</code>).</p>`
      : ``}
    <p style="font-size:12px;color:#64748b;margin-top:18px;">This is an automated message from ${employer} payroll. If you did not expect this, contact your payroll administrator.</p>
  </div></body></html>`;
}

// ── Deliver one payslip ─────────────────────────────────────────────────────

/**
 * Email one rendered payslip to the employee as a password-protected PDF and record the
 * attempt. Throws 404/422 for missing/unrendered payslips; a failed SEND is recorded as
 * 'failed' (not thrown) so a bulk run isolates per-row.
 */
export async function deliverPayslip(payslipId: string, actorId: string): Promise<PayslipDeliveryDto> {
  const { data: ps, error: psErr } = await sb.from('finance_payslips')
    .select('id, payslip_no, run_id, employee_id, file_path')
    .eq('id', payslipId)
    .maybeSingle<{ id: string; payslip_no: string; run_id: string; employee_id: string; file_path: string | null }>();
  if (psErr) throw Object.assign(new Error('deliverPayslip/get: ' + psErr.message), { status: 500 });
  if (!ps) throw Object.assign(new Error('Payslip not found.'), { status: 404 });
  if (!ps.file_path) throw Object.assign(new Error('Render the payslip PDF before emailing it.'), { status: 422 });

  const { data: emp } = await sb.from('app_users')
    .select('email, personal_email, date_of_birth, full_name')
    .eq('id', ps.employee_id)
    .maybeSingle<{ email: string | null; personal_email: string | null; date_of_birth: string | null; full_name: string | null }>();

  const recipient = emp?.email?.trim() || emp?.personal_email?.trim() || null;
  const password = derivePassword(emp?.date_of_birth);
  const snapshot = await buildPayslipSnapshot(payslipId);

  let status: PayslipDeliveryDto['status'] = 'sent';
  let error: string | null = null;
  const apiKey = process.env.RESEND_API_KEY;

  if (!recipient) { status = 'skipped'; error = 'No email address on file for this employee.'; }
  else if (!apiKey) { status = 'skipped'; error = 'Email delivery disabled (RESEND_API_KEY not set).'; }
  else {
    try {
      const pdf = await renderPayslipPdf(snapshot, password ? { password } : {});
      const { Resend } = await import('resend');
      const resend = new Resend(apiKey);
      const from = process.env.RESEND_FROM_EMAIL ?? 'Siomac <no-reply@siomac.app>';
      const { error: sendErr } = await resend.emails.send({
        from, to: [recipient],
        subject: `Payslip ${snapshot.payslipNo} — ${snapshot.periodLabel}`,
        html: buildDeliveryHtml(snapshot.payslipNo, snapshot.periodLabel, snapshot.employer.name, snapshot.employee.name, !!password),
        attachments: [{ filename: `Payslip-${snapshot.payslipNo}.pdf`, content: pdf.toString('base64') }],
      });
      if (sendErr) { status = 'failed'; error = typeof sendErr === 'object' ? JSON.stringify(sendErr) : String(sendErr); }
    } catch (e) { status = 'failed'; error = (e as Error).message; }
  }

  const nowIso = new Date().toISOString();
  const { data: del, error: insErr } = await sb.from('finance_payslip_deliveries').insert({
    payslip_id: ps.id, run_id: ps.run_id, employee_id: ps.employee_id,
    channel: 'email', recipient: recipient ? maskEmail(recipient) : null,
    status, password_protected: status === 'sent' && !!password, attempts: 1,
    error, sent_at: status === 'sent' ? nowIso : null, created_by: actorId, updated_at: nowIso,
  }).select('*').single<DbDeliveryRow>();
  if (insErr) throw Object.assign(new Error('deliverPayslip/record: ' + insErr.message), { status: 500 });

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: ps.run_id, actorId,
    action: 'payslip.delivered',
    newState: { payslipId, payslipNo: ps.payslip_no, employeeId: ps.employee_id, status, channel: 'email' },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.payslip.delivered',
    sourceModule: 'finance_payroll', sourceEntityType: 'payslip', sourceEntityId: payslipId,
    actorUserId: actorId, severity: status === 'failed' ? 'warning' : 'info',
    payload: { payslipNo: ps.payslip_no, employeeId: ps.employee_id, status },
  });

  return toDeliveryDto(del);
}

// ── Deliver all rendered payslips in a run ──────────────────────────────────

export interface DeliverRunResult { sent: number; failed: number; skipped: number; total: number }

export async function deliverRunPayslips(runId: string, actorId: string): Promise<DeliverRunResult> {
  const { data: payslips, error } = await sb.from('finance_payslips')
    .select('id, file_path').eq('run_id', runId);
  if (error) throw Object.assign(new Error('deliverRunPayslips/list: ' + error.message), { status: 500 });

  const rendered = (payslips ?? []).filter((p: { file_path: string | null }) => p.file_path) as Array<{ id: string }>;
  let sent = 0, failed = 0, skipped = 0;
  for (const p of rendered) {
    try {
      const d = await deliverPayslip(p.id, actorId);
      if (d.status === 'sent') sent++; else if (d.status === 'failed') failed++; else skipped++;
    } catch { failed++; }
  }

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.payslips_delivered',
    newState: { sent, failed, skipped, total: rendered.length },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.payslips.delivered',
    sourceModule: 'finance_payroll', sourceEntityType: 'payroll_run', sourceEntityId: runId,
    actorUserId: actorId, severity: failed > 0 ? 'warning' : 'success',
    payload: { sent, failed, skipped, total: rendered.length },
  });

  return { sent, failed, skipped, total: rendered.length };
}

// ── List deliveries for a run ───────────────────────────────────────────────

export async function listRunDeliveries(runId: string): Promise<PayslipDeliveryDto[]> {
  const { data, error } = await sb.from('finance_payslip_deliveries')
    .select('*').eq('run_id', runId).order('created_at', { ascending: false });
  if (error) throw Object.assign(new Error('listRunDeliveries: ' + error.message), { status: 500 });
  return ((data ?? []) as DbDeliveryRow[]).map(toDeliveryDto);
}
