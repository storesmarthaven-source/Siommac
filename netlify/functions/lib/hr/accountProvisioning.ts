// lib/hr/accountProvisioning.ts — Account / Work-Email provisioning (Phase 6).
//
// HR-created employees have an app_users row but no Supabase Auth login. Provisioning:
//   1. derives a work email (settings domain + pattern),
//   2. creates the Supabase Auth login (admin.createUser — same pattern as employees.ts),
//   3. issues a single-use invite token (sha256 stored; raw emailed via Resend to the
//      employee's PERSONAL email, since the work mailbox doesn't exist yet),
//   4. raises a PENDING IT handoff for the real mailbox (we don't run mail/directory),
//   5. on accept, sets the chosen password (admin.updateUserById) and activates.
// REAL where we own it (login + work-email field + invite); EXTERNAL (mailbox) → handoff.

import { createHash, randomBytes } from 'node:crypto';
import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { resolveSettingValue } from '../settings/resolveSetting';
import { loadPackagePlan } from './onboardingPackageService';
import type { OnboardingAccountPreflight } from '../../../../types/hrOnboarding';

const err = (status: number, message: string): Error => Object.assign(new Error(message), { status });
const nowISO = (): string => new Date().toISOString();
const SCOPE = { moduleKey: 'hr_onboarding' };
const appBaseUrl = (): string => (process.env.APP_URL ?? process.env.URL ?? '').replace(/\/+$/, '');

interface EmpRow {
  id: string; full_name: string | null; first_name: string | null; last_name: string | null;
  email: string | null; personal_email: string | null; auth_id: string | null; auth_email: string | null;
  work_email: string | null; username: string | null; account_status: string | null;
}

const slugPart = (s: string | null | undefined): string => (s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

function deriveLocalPart(first: string, last: string, pattern: string): string {
  const f = slugPart(first), l = slugPart(last);
  if (pattern === 'flast') return (f.slice(0, 1) + l) || f || 'user';
  if (pattern === 'first') return f || l || 'user';
  return [f, l].filter(Boolean).join('.') || f || l || 'user';
}

async function uniqueWorkEmail(local: string, domain: string, excludeUserId: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = `${local}${i === 0 ? '' : i}@${domain}`.toLowerCase();
    const { data, error } = await sb.from('app_users').select('id')
      .or(`work_email.eq.${candidate},auth_email.eq.${candidate},email.eq.${candidate}`)
      .neq('id', excludeUserId).limit(1);
    if (error) throw err(500, error.message);
    if (!data || data.length === 0) return candidate;
  }
  return `${local}.${Date.now().toString(36)}@${domain}`.toLowerCase();
}

export async function getAccountProvisioningPreflight(args: {
  employeeId: string;
  packageKey: string;
  ownerId?: string | null;
}): Promise<OnboardingAccountPreflight> {
  const [employeeResult, plan, domainValue, patternValue, operatingModelValue, ownerQueueValue, invitationEnabledValue, invitationOffsetValue] = await Promise.all([
    sb.from('app_users')
      .select('id, full_name, first_name, last_name, username, work_email')
      .eq('id', args.employeeId)
      .maybeSingle<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null; username: string | null; work_email: string | null }>(),
    loadPackagePlan(args.packageKey),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.work_email_domain', SCOPE, ''),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.work_email_pattern', SCOPE, 'first.last'),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.account_operating_model', SCOPE, 'hr_managed'),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.account_owner_queue', SCOPE, 'hr_operations'),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.secure_invitation_enabled', SCOPE, true),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.invitation_offset_days', SCOPE, 5),
  ]);
  if (employeeResult.error) throw err(500, employeeResult.error.message);
  if (!employeeResult.data) throw err(404, 'Employee not found.');
  if (!plan || plan.status !== 'active') throw err(400, 'Choose an active onboarding package.');

  const employee = employeeResult.data;
  const required = plan.tasks.some(task => task.moduleKey === 'access' || task.moduleKey === 'it')
    || plan.handoffs.some(handoff => handoff.targetModule === 'access' || handoff.targetModule === 'it');
  const domain = String(domainValue ?? '').trim().replace(/^@/, '');
  const pattern = String(patternValue ?? 'first.last');
  const operatingModel = ['hr_managed', 'it_managed', 'hybrid'].includes(String(operatingModelValue))
    ? String(operatingModelValue) as OnboardingAccountPreflight['operatingModel']
    : 'hr_managed';
  const owningTeamId = String(ownerQueueValue) === 'it_service_desk' ? 'it_service_desk' : 'hr_operations';
  const owningTeamLabel = owningTeamId === 'it_service_desk' ? 'IT Service Desk' : 'HR Operations';
  const invitationEnabled = invitationEnabledValue !== false;
  const invitationOffsetDays = Math.max(0, Math.min(90, Number(invitationOffsetValue) || 0));
  const firstName = employee.first_name ?? (employee.full_name ?? '').split(' ')[0] ?? employee.username ?? '';
  const lastName = employee.last_name ?? (employee.full_name ?? '').split(' ').slice(-1)[0] ?? '';
  const proposedWorkEmail = !required ? null : employee.work_email
    ?? (domain ? await uniqueWorkEmail(deriveLocalPart(firstName, lastName, pattern), domain, employee.id) : null);
  const accountableId = args.ownerId ?? null;
  let accountableName: string | null = null;
  if (accountableId) {
    const { data, error } = await sb.from('app_users').select('full_name').eq('id', accountableId).maybeSingle<{ full_name: string | null }>();
    if (error) throw err(500, error.message);
    accountableName = data?.full_name ?? null;
  }
  const blockers = [
    ...(required && !domain ? ['Configure the onboarding work-email domain before provisioning.'] : []),
    ...(required && !invitationEnabled ? ['Enable secure worker invitations before launching account setup.'] : []),
  ];
  return {
    required,
    ready: blockers.length === 0,
    operatingModel,
    owningTeam: { id: owningTeamId, label: owningTeamLabel },
    accountablePerson: accountableId ? { id: accountableId, name: accountableName } : null,
    accessProfile: plan.label,
    proposedWorkEmail,
    credentialMethod: 'invite_link',
    invitationTiming: { mode: 'before_start', offsetDays: invitationOffsetDays },
    provisioningAuthority: 'hr.onboarding.provision_account',
    blockers,
  };
}

/** Resend invite to the PERSONAL email (work mailbox doesn't exist yet). Returns sent? */
async function sendInviteEmail(to: string, link: string, name: string, senderName: string, senderEmail: string, expiryDays: number): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return false;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const configuredFrom = senderEmail ? `${senderName || 'SIOMAC HR'} <${senderEmail}>` : '';
    const from = configuredFrom || process.env.RESEND_FROM_EMAIL || 'SIOMAC HR <no-reply@siomac.app>';
    const { error } = await resend.emails.send({
      from, to: [to], subject: 'Set up your work account',
      html: `<p>Hi ${name || 'there'},</p><p>Your work account is ready. Click below to set your password and finish setup:</p><p><a href="${link}">Set my password</a></p><p>This link expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}. If you didn't expect this, ignore it.</p>`,
    });
    return !error;
  } catch { return false; }
}

export interface ProvisionResult {
  employeeId: string; workEmail: string; accountStatus: 'invited'; inviteSent: boolean;
  /** Returned ONLY when the email couldn't be sent, so the provisioner can deliver it. */
  inviteLink: string | null;
}

export async function provisionAccount(actorId: string, args: { employeeId: string; sendInvite?: boolean }): Promise<ProvisionResult> {
  const { data: emp, error: employeeError } = await sb.from('app_users')
    .select('id, full_name, first_name, last_name, email, personal_email, auth_id, auth_email, work_email, username, account_status')
    .eq('id', args.employeeId).maybeSingle<EmpRow>();
  if (employeeError) throw err(500, employeeError.message);
  if (!emp) throw err(404, 'Employee not found.');
  if (emp.account_status === 'active') throw err(400, 'Account is already active.');

  const [domainValue, patternValue, invitationEnabledValue, expiryValue, senderNameValue, senderEmailValue] = await Promise.all([
    resolveSettingValue<unknown>(sb, 'hr_onboarding.work_email_domain', SCOPE, ''),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.work_email_pattern', SCOPE, 'first.last'),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.secure_invitation_enabled', SCOPE, true),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.invitation_expiry_days', SCOPE, 7),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.communication_sender_name', SCOPE, 'SIOMAC HR'),
    resolveSettingValue<unknown>(sb, 'hr_onboarding.communication_sender_email', SCOPE, ''),
  ]);
  if (invitationEnabledValue === false) throw err(409, 'Secure worker invitations are disabled in Onboarding Settings.');
  const domain = String(domainValue ?? '').trim();
  if (!domain) throw err(400, 'No work email domain configured (set hr_onboarding.work_email_domain in settings).');
  const pattern = String(patternValue ?? 'first.last');
  const expiryDays = Math.max(1, Math.min(30, Number(expiryValue) || 7));
  const senderName = String(senderNameValue ?? 'SIOMAC HR').trim();
  const senderEmail = String(senderEmailValue ?? '').trim();

  const firstName = emp.first_name ?? (emp.full_name ?? '').split(' ')[0] ?? emp.username ?? '';
  const lastName = emp.last_name ?? (emp.full_name ?? '').split(' ').slice(-1)[0] ?? '';
  const workEmail = emp.work_email ?? await uniqueWorkEmail(deriveLocalPart(firstName, lastName, pattern), domain, emp.id);

  // Ensure a Supabase Auth login exists (same pattern as routes/employees.ts).
  let authId = emp.auth_id;
  if (!authId) {
    const tempPw = randomBytes(24).toString('base64url');
    const { data: authData, error: aErr } = await sb.auth.admin.createUser({
      email: workEmail, password: tempPw, email_confirm: true, user_metadata: { appUserId: emp.id, username: emp.username },
    });
    if (aErr || !authData?.user) throw err(500, 'Failed to create login: ' + (aErr?.message ?? 'unknown'));
    authId = authData.user.id;
  }

  const { error: uErr } = await sb.from('app_users').update({
    work_email: workEmail, auth_id: authId, auth_email: emp.auth_email ?? workEmail,
    account_status: 'invited', provisioned_at: nowISO(), provisioned_by: actorId,
  }).eq('id', emp.id);
  if (uErr) throw err(500, uErr.message);

  // Single-use invite token (store only the hash).
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 3600 * 1000).toISOString();

  const { data: kase, error: caseError } = await sb.from('hr_onboarding_cases').select('id')
    .eq('employee_id', emp.id).not('status', 'in', '("completed","cancelled")')
    .order('started_at', { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  if (caseError) throw err(500, caseError.message);

  const { error: revokeError } = await sb.from('hr_onboarding_account_invites').update({ status: 'revoked' }).eq('user_id', emp.id).eq('status', 'pending');
  if (revokeError) throw err(500, revokeError.message);

  const link = `${appBaseUrl()}/set-password?token=${token}`;
  const sent = (args.sendInvite ?? true) ? await sendInviteEmail(emp.personal_email ?? '', link, emp.full_name ?? '', senderName, senderEmail, expiryDays) : false;

  const { error: iErr } = await sb.from('hr_onboarding_account_invites').insert({
    user_id: emp.id, case_id: kase?.id ?? null, token_hash: tokenHash, work_email: workEmail,
    delivery: sent ? 'email' : 'surfaced', expires_at: expiresAt, created_by: actorId,
  });
  if (iErr) throw err(500, iErr.message);

  // Mailbox is external (we don't run mail/directory) → pending IT handoff, never faked.
  if (kase?.id) {
    const { error: handoffError } = await sb.from('hr_onboarding_handoffs').insert({
      case_id: kase.id, handoff_key: 'account_mailbox', target_module: 'it', handoff_type: 'account_mailbox_provision',
      status: 'pending', payload: { workEmail, employeeId: emp.id },
    });
    if (handoffError) throw err(500, handoffError.message);
  }

  void emitAppEvent({
    eventType: 'onboarding.account.provisioned', sourceModule: 'hr',
    sourceEntityType: kase?.id ? 'onboarding_case' : 'employee', sourceEntityId: kase?.id ?? emp.id,
    actorUserId: actorId, severity: 'info', payload: { employeeId: emp.id, workEmail, delivery: sent ? 'email' : 'surfaced' },
  });
  await writeHrAudit({ employeeId: emp.id, submoduleKey: 'onboarding', recordId: kase?.id ?? emp.id, actorId,
    action: 'hr.onboarding.account_provisioned', newState: { workEmail, accountStatus: 'invited', delivery: sent ? 'email' : 'surfaced' } });

  return { employeeId: emp.id, workEmail, accountStatus: 'invited', inviteSent: sent, inviteLink: sent ? null : link };
}

/** Unauthenticated: the invitee sets their own password via the emailed token. */
export async function acceptAccountInvite(args: { token: string; password: string }): Promise<{ ok: true }> {
  const token = (args.token ?? '').trim();
  const password = args.password ?? '';
  if (token.length < 16) throw err(400, 'Invalid or expired invite.');
  if (password.length < 8) throw err(400, 'Password must be at least 8 characters.');

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data: inv } = await sb.from('hr_onboarding_account_invites')
    .select('id, user_id, status, expires_at').eq('token_hash', tokenHash).maybeSingle<{ id: string; user_id: string; status: string; expires_at: string }>();
  if (!inv || inv.status !== 'pending') throw err(400, 'Invalid or expired invite.');
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    await sb.from('hr_onboarding_account_invites').update({ status: 'expired' }).eq('id', inv.id);
    throw err(400, 'Invalid or expired invite.');
  }

  const { data: emp } = await sb.from('app_users').select('id, auth_id').eq('id', inv.user_id).maybeSingle<{ id: string; auth_id: string | null }>();
  if (!emp?.auth_id) throw err(400, 'Invalid or expired invite.');

  const { error: pErr } = await sb.auth.admin.updateUserById(emp.auth_id, { password });
  if (pErr) throw err(500, 'Could not set the password. Please try again.');

  await sb.from('hr_onboarding_account_invites').update({ status: 'accepted', accepted_at: nowISO() }).eq('id', inv.id);
  await sb.from('app_users').update({ account_status: 'active' }).eq('id', emp.id);

  void emitAppEvent({ eventType: 'onboarding.account.activated', sourceModule: 'hr', sourceEntityType: 'employee', sourceEntityId: emp.id, actorUserId: emp.id, severity: 'info', payload: { employeeId: emp.id } });
  await writeHrAudit({ employeeId: emp.id, submoduleKey: 'onboarding', recordId: emp.id, actorId: emp.id, action: 'hr.onboarding.account_activated', newState: { accountStatus: 'active' } });
  return { ok: true };
}
