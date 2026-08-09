/**
 * lib/email/emailTransport.ts — the transport boundary.
 *
 * `sendEmail()` owns configuration, validation, normalisation and result classification; a
 * TRANSPORT owns one thing only: handing an already-valid message to a provider and saying
 * whether the provider accepted it. Everything a second provider would otherwise duplicate lives
 * on this side of the line.
 *
 * Only the Resend transport exists today, and the service does not offer a choice — there is
 * nothing to choose between. This boundary is here so adding SMTP later is a new file plus a
 * selection rule, not a rewrite of every caller. It is NOT a pretence that SMTP already works:
 * no transport name is accepted as input anywhere, because accepting a value the code cannot
 * honour is the accept-and-drop failure this codebase refuses.
 */

import type { EmailConfig } from './emailConfig';

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded content. Callers that hold a Buffer pass `buf.toString('base64')`. */
  contentBase64: string;
  contentType?: string;
}

/** What a caller asks to send. */
export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  /** Plain-text alternative. Strongly preferred by spam filters; optional because not every
   *  caller has one to give and inventing one by stripping tags produces worse text than none. */
  text?: string;
  attachments?: EmailAttachment[];
  /** Overrides the configured reply-to for this message only. */
  replyTo?: string | null;
}

/** A message that has passed validation: recipients are a non-empty list of real addresses. */
export interface NormalisedEmailMessage extends Omit<EmailMessage, 'to' | 'replyTo'> {
  to: string[];
  replyTo: string | null;
}

/** A transport reports acceptance or a reason — it never throws and never classifies. */
export type TransportOutcome =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; message: string };

export interface EmailTransport {
  /** Stable identifier surfaced by the status endpoint and recorded against deliveries. */
  readonly name: 'resend';
  send(config: EmailConfig, message: NormalisedEmailMessage): Promise<TransportOutcome>;
}

/**
 * Why a send did not happen. Callers branch on this, so it is a closed set with meanings that
 * matter downstream: payslip delivery records `not_configured` as SKIPPED (nothing was attempted,
 * nothing to retry) but `transport_error` as FAILED (an attempt was made and rejected). Collapsing
 * the two would tell an operator to chase a provider outage that never occurred.
 */
export type EmailFailureReason =
  | 'not_configured'
  | 'invalid_recipient'
  | 'invalid_message'
  | 'transport_error';
