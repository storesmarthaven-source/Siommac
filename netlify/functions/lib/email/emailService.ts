/**
 * lib/email/emailService.ts — the canonical outbound email path.
 *
 * ONE function sends mail for the whole platform. It replaces three independent implementations
 * (notify.ts, finance/payrollPayslipDelivery.ts, hr/accountProvisioning.ts) that each read the
 * environment, built their own provider client, and shared a hardcoded unverified fallback
 * sender. Those implementations are deleted, not wrapped: a second path would drift from this one
 * the first time either changed.
 *
 * `sendEmail` NEVER throws. Every caller is a side effect of a business action that has already
 * succeeded — an approved leave request, a provisioned account, a rendered payslip — and none of
 * them should be undone because a mail provider had a bad minute. Failures come back as a typed
 * result the caller classifies and records.
 */

import { readEmailConfig, type EmailConfigProblem, type EmailSender } from './emailConfig';
import { resendTransport } from './resendTransport';
import { isEmailAddress } from './emailConfig';
import type { EmailFailureReason, EmailMessage, NormalisedEmailMessage } from './emailTransport';

/** The single transport. See emailTransport.ts for why the boundary exists with only one. */
const transport = resendTransport;

export type EmailSendResult =
  | {
      ok: true;
      /** Provider id, when the provider returned one. Null on a dry run. */
      providerMessageId: string | null;
      /** Address the message was sent from — the resolved configuration, not a guess. */
      sender: string;
      transport: string;
      recipients: string[];
      /** True when configuration and message were validated but nothing was transmitted. */
      dryRun: boolean;
    }
  | {
      ok: false;
      reason: EmailFailureReason;
      /** Operator-facing. Never contains the credential. */
      message: string;
      /** Present only for `not_configured`, naming the variables at fault. */
      problems?: EmailConfigProblem[];
    };

export interface SendEmailOptions {
  /**
   * Validate configuration and the message, resolve the sender, and report what WOULD be sent —
   * without transmitting anything.
   *
   * This is a real operator capability ("is email set up correctly?" answered without mailing a
   * human), and it is what the automated tests use so a test run can never deliver real mail.
   * It is NOT a transport: it does not pretend a send happened — `dryRun: true` is on the result.
   */
  dryRun?: boolean;
}

/** Trimmed, de-duplicated, validated recipients. */
function normaliseRecipients(to: string | string[]): { ok: true; to: string[] } | { ok: false; message: string } {
  const raw = (Array.isArray(to) ? to : [to]).map(v => (v ?? '').trim()).filter(Boolean);
  if (!raw.length) return { ok: false, message: 'No recipient address was supplied.' };

  const seen = new Set<string>();
  const invalid: string[] = [];
  const valid: string[] = [];
  for (const address of raw) {
    if (!isEmailAddress(address)) { invalid.push(address); continue; }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(address);
  }
  // Naming the bad address matters: "invalid recipient" with no address sends an operator
  // hunting through a bulk run for which row was wrong.
  if (invalid.length) return { ok: false, message: `Not a valid email address: ${invalid.join(', ')}.` };
  if (!valid.length) return { ok: false, message: 'No recipient address was supplied.' };
  return { ok: true, to: valid };
}

/**
 * Send one email through the platform's configured provider.
 *
 * Order matters: configuration is checked BEFORE the message, because "email is not set up" is a
 * different operational problem from "this particular message is malformed", and an operator
 * staring at a missing sender should not first be told about a blank subject.
 */
export async function sendEmail(message: EmailMessage, options: SendEmailOptions = {}): Promise<EmailSendResult> {
  const configResult = readEmailConfig();
  if (!configResult.configured) {
    return {
      ok: false,
      reason: 'not_configured',
      message: configResult.problems.map(p => p.message).join(' '),
      problems: configResult.problems,
    };
  }
  const { config } = configResult;

  const recipients = normaliseRecipients(message.to);
  if (!recipients.ok) return { ok: false, reason: 'invalid_recipient', message: recipients.message };

  const subject = (message.subject ?? '').trim();
  if (!subject) return { ok: false, reason: 'invalid_message', message: 'An email needs a subject.' };
  if (!(message.html ?? '').trim()) return { ok: false, reason: 'invalid_message', message: 'An email needs a body.' };

  const normalised: NormalisedEmailMessage = {
    to: recipients.to,
    subject,
    html: message.html,
    ...(message.text ? { text: message.text } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    replyTo: message.replyTo ?? config.replyTo,
  };

  if (options.dryRun) {
    return {
      ok: true, providerMessageId: null, sender: config.sender.formatted,
      transport: transport.name, recipients: normalised.to, dryRun: true,
    };
  }

  const outcome = await transport.send(config, normalised);
  if (!outcome.ok) return { ok: false, reason: 'transport_error', message: outcome.message };

  return {
    ok: true, providerMessageId: outcome.providerMessageId, sender: config.sender.formatted,
    transport: transport.name, recipients: normalised.to, dryRun: false,
  };
}

// ── Configuration status ────────────────────────────────────────────────────────

export interface EmailDeliveryStatus {
  configured: boolean;
  transport: string;
  /** Resolved sender, or null when it is not configured. NEVER a guessed default. */
  sender: { address: string; name: string | null; formatted: string } | null;
  replyTo: string | null;
  /** Named variables at fault, so an operator knows exactly what to set. */
  problems: EmailConfigProblem[];
}

/**
 * Describe delivery configuration for operators.
 *
 * Reports whether the credential is PRESENT and well-shaped — never its value, not even masked. A
 * masked secret is still a leak of length and prefix, and there is no question an operator can
 * answer from four characters of a key that `configured: true` does not already answer.
 *
 * ⚠ This cannot prove the sender's domain is verified with the provider. The current key is
 * send-only and cannot enumerate domains, so the only proof a sender works is an accepted send —
 * which is what the test-email endpoint is for.
 */
export function getEmailDeliveryStatus(): EmailDeliveryStatus {
  const result = readEmailConfig();
  if (!result.configured) {
    return { configured: false, transport: transport.name, sender: null, replyTo: null, problems: result.problems };
  }
  const sender: EmailSender = result.config.sender;
  return {
    configured: true,
    transport: transport.name,
    sender: { address: sender.address, name: sender.name, formatted: sender.formatted },
    replyTo: result.config.replyTo,
    problems: [],
  };
}
