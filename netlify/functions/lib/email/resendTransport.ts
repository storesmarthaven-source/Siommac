/**
 * lib/email/resendTransport.ts — the Resend transport.
 *
 * The ONLY place the `resend` SDK is imported. Three call sites used to construct their own
 * client; if a fourth ever does, this file stops being the boundary and the duplication is back.
 *
 * The SDK is imported dynamically so that merely loading the email module — which the status
 * endpoint and every caller do — does not pull the provider client into a cold Netlify Function.
 * Two of the three original call sites already did this; it is kept for the same reason.
 */

import type { EmailConfig } from './emailConfig';
import type { EmailTransport, NormalisedEmailMessage, TransportOutcome } from './emailTransport';

/**
 * Resend returns `{ data, error }` rather than throwing on a rejected send, so BOTH have to be
 * handled: a thrown error means the request never completed (network, bad SDK usage), while
 * `error` means the provider rejected it (unverified sender, invalid recipient, quota). Reporting
 * only one of the two is how a rejected send gets recorded as delivered.
 */
export const resendTransport: EmailTransport = {
  name: 'resend',

  async send(config: EmailConfig, message: NormalisedEmailMessage): Promise<TransportOutcome> {
    try {
      const { Resend } = await import('resend');
      const client = new Resend(config.apiKey);

      const { data, error } = await client.emails.send({
        from: config.sender.formatted,
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.attachments?.length
          ? {
              attachments: message.attachments.map(a => ({
                filename: a.filename,
                content: a.contentBase64,
                ...(a.contentType ? { contentType: a.contentType } : {}),
              })),
            }
          : {}),
      });

      if (error) {
        // The provider's own words are the most useful thing an operator can be given here
        // ("The domain is not verified" is actionable; "send failed" is not). It is an API
        // error object, never the credential.
        const detail = typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : JSON.stringify(error);
        return { ok: false, message: detail };
      }

      return { ok: true, providerMessageId: data?.id ?? null };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  },
};
