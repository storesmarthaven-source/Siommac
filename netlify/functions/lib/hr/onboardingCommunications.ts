// lib/hr/onboardingCommunications.ts — HR Onboarding case communications (Phase 5).
//
// A durable per-case log of the messages HR sends around an onboarding case, plus
// REAL in-app delivery: a sent communication emits an app_event with a notification
// to the resolved recipient (via emitAppEvent's explicitRecipients + notification) —
// never a faked send. 'manual' channel records a communication that happened outside
// the system (a call, an in-person chat) with no delivery. Backend-only (service-role).

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import type {
  OnboardingCommunicationRow, OnboardingCommunicationType, OnboardingCommunicationChannel,
  OnboardingCommunicationPreview, PreviewCommunicationArgs, SendCommunicationArgs,
} from '../../../../types/hrOnboarding';

const err = (status: number, message: string): Error => Object.assign(new Error(message), { status });
const nowISO = (): string => new Date().toISOString();

interface CaseCtx { id: string; case_no: string; employee_id: string | null; employee_name: string | null; owner_id: string | null; owner_name: string | null; supervisor_id: string | null; supervisor_name: string | null; package_key: string }

async function loadCaseCtx(caseId: string): Promise<CaseCtx> {
  const { data: kase } = await sb.from('hr_onboarding_cases').select('id, case_no, employee_id, owner_id, package_key').eq('id', caseId).maybeSingle<{ id: string; case_no: string; employee_id: string | null; owner_id: string | null; package_key: string }>();
  if (!kase) throw err(404, 'Onboarding case not found.');
  const { data: emp } = kase.employee_id
    ? await sb.from('app_users').select('id, full_name, supervisor_id').eq('id', kase.employee_id).maybeSingle<{ id: string; full_name: string | null; supervisor_id: string | null }>()
    : { data: null };
  const ids = [kase.owner_id, emp?.supervisor_id].filter((x): x is string => !!x);
  const names: Record<string, string | null> = ids.length
    ? Object.fromEntries((((await sb.from('app_users').select('id, full_name').in('id', ids)).data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name]))
    : {};
  return {
    id: kase.id, case_no: kase.case_no, package_key: kase.package_key,
    employee_id: kase.employee_id, employee_name: emp?.full_name ?? null,
    owner_id: kase.owner_id, owner_name: kase.owner_id ? names[kase.owner_id] ?? null : null,
    supervisor_id: emp?.supervisor_id ?? null, supervisor_name: emp?.supervisor_id ? names[emp.supervisor_id] ?? null : null,
  };
}

/** Resolve recipient + default subject/body per communication type. `warning` is set
 *  (recipient null) when the type has no one to send to (e.g. no supervisor on file). */
function resolveSpec(
  ctx: CaseCtx, type: OnboardingCommunicationType, overrides: { subject?: string | null; body?: string | null; recipientUserId?: string | null },
): OnboardingCommunicationPreview {
  const who = ctx.employee_name ?? 'the employee';
  let recipientUserId: string | null;
  let recipientName: string | null;
  let subject: string;
  let body: string;
  let warning: string | null = null;

  switch (type) {
    case 'employee_welcome':
      recipientUserId = ctx.employee_id; recipientName = ctx.employee_name;
      subject = `Welcome aboard — your onboarding has started`;
      body = `Hi ${who}, welcome to the team! Your onboarding (case ${ctx.case_no}) is underway. You'll be guided through the required steps.`;
      if (!recipientUserId) warning = 'This case has no linked employee to welcome.';
      break;
    case 'supervisor_notification':
      recipientUserId = ctx.supervisor_id; recipientName = ctx.supervisor_name;
      subject = `New team member onboarding: ${who}`;
      body = `${who}'s onboarding (case ${ctx.case_no}) has started. Please prepare their first-week plan and check in on their tasks.`;
      if (!recipientUserId) warning = 'No supervisor is on file for this employee.';
      break;
    case 'owner_reminder':
      recipientUserId = ctx.owner_id; recipientName = ctx.owner_name;
      subject = `Onboarding reminder: ${ctx.case_no}`;
      body = `Reminder to progress the onboarding case ${ctx.case_no} for ${who} — check open and blocking tasks.`;
      if (!recipientUserId) warning = 'This case has no owner assigned to remind.';
      break;
    case 'escalation_notice':
      recipientUserId = ctx.owner_id; recipientName = ctx.owner_name;
      subject = `Escalation — onboarding case ${ctx.case_no}`;
      body = `Onboarding case ${ctx.case_no} for ${who} needs attention: blocking work is overdue. Please review and resolve.`;
      if (!recipientUserId) warning = 'This case has no owner to escalate to.';
      break;
    case 'manual_message':
    default:
      recipientUserId = overrides.recipientUserId ?? null; recipientName = null;
      subject = ''; body = '';
      if (!recipientUserId) warning = 'Choose a recipient for the manual message.';
      break;
  }

  return {
    communicationType: type,
    recipientUserId: overrides.recipientUserId ?? recipientUserId,
    recipientName,
    subject: (overrides.subject ?? '').trim() || subject,
    body: (overrides.body ?? '').trim() || body,
    warning: overrides.recipientUserId ? null : warning,
  };
}

export async function previewOnboardingCommunication(args: PreviewCommunicationArgs): Promise<OnboardingCommunicationPreview> {
  const ctx = await loadCaseCtx(args.caseId);
  const spec = resolveSpec(ctx, args.communicationType, args);
  // Enrich a manually-chosen recipient's name for display.
  if (spec.recipientUserId && !spec.recipientName) {
    const { data: u } = await sb.from('app_users').select('full_name').eq('id', spec.recipientUserId).maybeSingle<{ full_name: string | null }>();
    spec.recipientName = u?.full_name ?? null;
  }
  return spec;
}

export async function listOnboardingCommunications(caseId: string): Promise<OnboardingCommunicationRow[]> {
  const { data } = await sb.from('hr_onboarding_communications')
    .select('id, case_id, communication_type, channel, recipient_user_id, recipient_email, subject, body, status, failure_reason, sent_by, sent_at, created_at')
    .eq('case_id', caseId).order('created_at', { ascending: false });
  const rows = (data ?? []) as { id: string; case_id: string; communication_type: string; channel: string; recipient_user_id: string | null; recipient_email: string | null; subject: string | null; body: string | null; status: string; failure_reason: string | null; sent_by: string | null; sent_at: string | null; created_at: string }[];
  const ids = [...new Set(rows.flatMap(r => [r.recipient_user_id, r.sent_by]).filter((x): x is string => !!x))];
  const names: Record<string, string | null> = ids.length
    ? Object.fromEntries((((await sb.from('app_users').select('id, full_name').in('id', ids)).data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name]))
    : {};
  return rows.map(r => ({
    id: r.id, caseId: r.case_id,
    communicationType: r.communication_type as OnboardingCommunicationType,
    channel: r.channel as OnboardingCommunicationChannel,
    recipientUserId: r.recipient_user_id ?? null, recipientName: r.recipient_user_id ? names[r.recipient_user_id] ?? null : null,
    recipientEmail: r.recipient_email ?? null, subject: r.subject ?? null, body: r.body ?? null,
    status: r.status as OnboardingCommunicationRow['status'], failureReason: r.failure_reason ?? null,
    sentByName: r.sent_by ? names[r.sent_by] ?? null : null, sentAt: r.sent_at ?? null, createdAt: r.created_at,
  }));
}

/** Create the communication row and (for in_app) deliver a real notification to the
 *  recipient. 'manual' channel records only (no delivery). Returns the created row id. */
export async function sendOnboardingCommunication(actorId: string, args: SendCommunicationArgs): Promise<{ id: string; status: string; recipientUserId: string | null }> {
  const ctx = await loadCaseCtx(args.caseId);
  const spec = resolveSpec(ctx, args.communicationType, args);
  const channel: OnboardingCommunicationChannel = args.channel ?? 'in_app';

  if (channel !== 'manual' && !spec.recipientUserId) {
    throw err(400, spec.warning ?? 'No recipient could be resolved for this communication.');
  }

  const deliver = channel === 'in_app' && !!spec.recipientUserId;
  const status = channel === 'manual' ? 'sent' : deliver ? 'sent' : 'draft';

  const { data: row, error } = await sb.from('hr_onboarding_communications').insert({
    case_id: ctx.id, employee_id: ctx.employee_id, communication_type: args.communicationType, channel,
    recipient_user_id: spec.recipientUserId, subject: spec.subject, body: spec.body,
    status, sent_by: actorId, sent_at: status === 'sent' ? nowISO() : null,
    metadata: { caseNo: ctx.case_no },
  }).select('id').single<{ id: string }>();
  if (error) throw err(500, error.message);

  if (deliver) {
    await emitAppEvent({
      eventType: 'onboarding.communication.sent', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: ctx.id,
      actorUserId: actorId, severity: 'info',
      payload: { communicationType: args.communicationType, recipientUserId: spec.recipientUserId, caseNo: ctx.case_no },
      explicitRecipients: [{ userId: spec.recipientUserId!, reason: 'explicit' }],
      notification: { title: spec.subject, body: spec.body, actionRoute: `hr/onboarding/${ctx.id}`, type: `onboarding_${args.communicationType}` },
    });
  }
  await writeHrAudit({ employeeId: ctx.employee_id, submoduleKey: 'onboarding', recordId: ctx.id, actorId, action: 'hr.onboarding.communication_sent', newState: { communicationType: args.communicationType, channel, recipientUserId: spec.recipientUserId, status } });
  return { id: row.id, status, recipientUserId: spec.recipientUserId };
}

/** Re-deliver an existing communication (same type/recipient/subject/body). */
export async function resendOnboardingCommunication(actorId: string, args: { id: string }): Promise<{ id: string; status: string }> {
  const { data: comm } = await sb.from('hr_onboarding_communications')
    .select('id, case_id, communication_type, channel, recipient_user_id, subject, body')
    .eq('id', args.id).maybeSingle<{ id: string; case_id: string; communication_type: string; channel: string; recipient_user_id: string | null; subject: string | null; body: string | null }>();
  if (!comm) throw err(404, 'Communication not found.');
  if (comm.channel === 'manual') throw err(400, 'A manual (offline) communication cannot be resent.');
  if (!comm.recipient_user_id) throw err(400, 'This communication has no recipient to resend to.');

  await emitAppEvent({
    eventType: 'onboarding.communication.resent', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: comm.case_id,
    actorUserId: actorId, severity: 'info',
    payload: { communicationId: comm.id, communicationType: comm.communication_type, recipientUserId: comm.recipient_user_id },
    explicitRecipients: [{ userId: comm.recipient_user_id, reason: 'explicit' }],
    notification: { title: comm.subject ?? 'Onboarding message', body: comm.body ?? undefined, actionRoute: `hr/onboarding/${comm.case_id}`, type: `onboarding_${comm.communication_type}` },
  });
  await sb.from('hr_onboarding_communications').update({ status: 'sent', sent_by: actorId, sent_at: nowISO() }).eq('id', comm.id);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: comm.case_id, actorId, action: 'hr.onboarding.communication_resent', newState: { communicationId: comm.id } });
  return { id: comm.id, status: 'sent' };
}
