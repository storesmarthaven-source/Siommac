// lib/hr/accountProvisioning.ts — Account / Work-Email provisioning (Phase 6).
//
// HR-created employees have an app_users row but no Supabase Auth login. Provisioning:
//   1. derives a work email (settings domain + pattern),
//   2. creates the Supabase Auth login (admin.createUser — same pattern as employees.ts),
//   3. issues a single-use invite token (sha256 stored; raw emailed via the canonical
//      email service to the
//      employee's PERSONAL email, since the work mailbox doesn't exist yet),
//   4. raises a PENDING IT handoff for the real mailbox (we don't run mail/directory),
//   5. on accept, sets the chosen password (admin.updateUserById) and activates.
// REAL where we own it (login + work-email field + invite); EXTERNAL (mailbox) → handoff.

import { createHash, randomBytes } from 'node:crypto';
import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { resolveSettingValue } from '../settings/resolveSetting';
import { sendEmail } from '../email/emailService';

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
    const { data } = await sb.from('app_users').select('id')
      .or(`work_email.eq.${candidate},auth_email.eq.${candidate},email.eq.${candidate}`)
      .neq('id', excludeUserId).limit(1);
    if (!data || data.length === 0) return candidate;
  }
  return `${local}.${Date.now().toString(36)}@${domain}`.toLowerCase();
}

/**
 * Send the invite to the PERSONAL email (the work mailbox does not exist yet). Returns sent?
 *
 * A false return is not swallowed by the caller: `provisionAccount` reports `inviteSent: false`
 * and hands back `inviteLink` so a human can deliver it. That contract is why this returns a
 * boolean rather than throwing — and why an unconfigured platform must still return false rather
 * than pretending, which is what a hardcoded sender fallback used to make possible.
 */
async function sendInviteEmail(to: string, link: string, name: string, employeeId: string): Promise<boolean> {
  if (!to) return false;
  const result = await sendEmail({
    to,
    subject: 'Set up your work account',
    html: `<p>Hi ${name || 'there'},</p><p>Your work account is ready. Click below to set your password and finish setup:</p><p><a href="${link}">Set my password</a></p><p>This link expires in 7 days. If you didn't expect this, ignore it.</p>`,
  }, {
    moduleKey: 'hr_onboarding',
    useCase: 'account_invite',
    // Derived from the invite TOKEN, which is minted fresh per invite. So re-sending the same
    // invite cannot mail twice, while reissuing an expired invite — a legitimate HR act that
    // revokes the old token and mints a new one — produces a new key and really sends.
    idempotencyKey: `account_invite:${createHash('sha256').update(link).digest('hex').slice(0, 32)}`,
    sourceModule: 'hr_onboarding',
    sourceEntityType: 'employee',
    sourceEntityId: employeeId,
    actorUserId: employeeId,
  });
  return result.ok;
}

export interface ProvisionResult {
  employeeId: string; workEmail: string; accountStatus: 'invited'; inviteSent: boolean;
  /** Returned ONLY when the email couldn't be sent, so the provisioner can deliver it. */
  inviteLink: string | null;
}

export async function provisionAccount(actorId: string, args: { employeeId: string; sendInvite?: boolean }): Promise<ProvisionResult> {
  const { data: emp } = await sb.from('app_users')
    .select('id, full_name, first_name, last_name, email, personal_email, auth_id, auth_email, work_email, username, account_status')
    .eq('id', args.employeeId).maybeSingle<EmpRow>();
  if (!emp) throw err(404, 'Employee not found.');
  if (emp.account_status === 'active') throw err(400, 'Account is already active.');

  const domain = String(await resolveSettingValue<unknown>(sb, 'hr_onboarding.work_email_domain', SCOPE, '') ?? '').trim();
  if (!domain) throw err(400, 'No work email domain configured (set hr_onboarding.work_email_domain in settings).');
  const pattern = String(await resolveSettingValue<unknown>(sb, 'hr_onboarding.work_email_pattern', SCOPE, 'first.last'));

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
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const { data: kase } = await sb.from('hr_onboarding_cases').select('id')
    .eq('employee_id', emp.id).not('status', 'in', '("completed","cancelled")')
    .order('started_at', { ascending: false }).limit(1).maybeSingle<{ id: string }>();

  await sb.from('hr_onboarding_account_invites').update({ status: 'revoked' }).eq('user_id', emp.id).eq('status', 'pending');

  const link = `${appBaseUrl()}/set-password?token=${token}`;
  const sent = (args.sendInvite ?? true) ? await sendInviteEmail(emp.personal_email ?? '', link, emp.full_name ?? '', emp.id) : false;

  const { error: iErr } = await sb.from('hr_onboarding_account_invites').insert({
    user_id: emp.id, case_id: kase?.id ?? null, token_hash: tokenHash, work_email: workEmail,
    delivery: sent ? 'email' : 'surfaced', expires_at: expiresAt, created_by: actorId,
  });
  if (iErr) throw err(500, iErr.message);

  // Mailbox is external (we don't run mail/directory) → pending IT handoff, never faked.
  if (kase?.id) {
    await sb.from('hr_onboarding_handoffs').insert({
      case_id: kase.id, handoff_key: 'account_mailbox', target_module: 'it', handoff_type: 'account_mailbox_provision',
      status: 'pending', payload: { workEmail, employeeId: emp.id },
    });
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
