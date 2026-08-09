/**
 * lib/email/emailConfig.ts — the ONE place email delivery configuration is read and validated.
 *
 * Before this file there were THREE independent readers of RESEND_API_KEY / RESEND_FROM_EMAIL
 * (notify.ts, finance/payrollPayslipDelivery.ts, hr/accountProvisioning.ts). Each parsed the
 * environment itself and each carried the SAME hardcoded fallback sender,
 * `Siomac <no-reply@siomac.app>`.
 *
 * ⛔ That fallback is exactly the failure this module exists to remove. A fallback sender is a
 * GUESS: the address is only deliverable if it happens to belong to a domain verified on the
 * account behind the key. On the current account it is not, so every send that relied on the
 * fallback would have been rejected by the provider — three call sites silently mailing into a
 * wall. An unset sender is a configuration error, and it is reported as one.
 *
 * There is deliberately NO default for the sender. `RESEND_FROM_EMAIL` is required.
 */

/** A parsed, validated sender identity. */
export interface EmailSender {
  /** RFC 5322 form handed to the provider, e.g. `Siomac <no-reply@example.com>`. */
  formatted: string;
  /** Bare address — what actually has to belong to a verified domain. */
  address: string;
  /** Display name, or null when the sender was configured as a bare address. */
  name: string | null;
}

export interface EmailConfig {
  /** Provider credential. NEVER logged, NEVER returned by the status endpoint. */
  apiKey: string;
  sender: EmailSender;
  replyTo: string | null;
}

/** Why configuration is unusable. Callers branch on this, so it is a closed set. */
export interface EmailConfigProblem {
  /** The environment variable at fault. */
  variable: 'RESEND_API_KEY' | 'RESEND_FROM_EMAIL' | 'RESEND_REPLY_TO';
  /** Operator-facing explanation — safe to surface, contains no secret. */
  message: string;
}

export type EmailConfigResult =
  | { configured: true; config: EmailConfig }
  | { configured: false; problems: EmailConfigProblem[] };

/**
 * Deliberately conservative: enough to catch a pasted placeholder or a swapped variable, not an
 * attempt to re-implement RFC 5322. Anything stricter would reject addresses providers accept.
 */
const ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;.]+(\.[^\s@<>,;.]+)+$/;

export const isEmailAddress = (value: string): boolean => ADDRESS_RE.test(value.trim());

/**
 * Parse `Display Name <addr@example.com>` or a bare `addr@example.com`.
 * Returns null when the value cannot yield a usable address.
 */
export function parseSender(raw: string): EmailSender | null {
  const value = raw.trim();
  if (!value) return null;

  const angled = /^(.*)<([^<>]+)>$/.exec(value);
  if (angled) {
    const address = (angled[2] ?? '').trim();
    if (!isEmailAddress(address)) return null;
    // Strip surrounding quotes from a quoted display name; keep the name otherwise verbatim.
    const name = (angled[1] ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
    return name
      ? { formatted: `${name} <${address}>`, address, name }
      : { formatted: address, address, name: null };
  }

  if (!isEmailAddress(value)) return null;
  return { formatted: value, address: value, name: null };
}

/**
 * Read and validate delivery configuration from the environment.
 *
 * Reads `process.env` on every call rather than caching at module load: Netlify Functions reuse a
 * warm container across invocations, so a cached snapshot would survive an environment change and
 * report stale configuration to the status endpoint. This is a handful of string operations — the
 * cost of getting it right is nil.
 */
export function readEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfigResult {
  const problems: EmailConfigProblem[] = [];

  const apiKey = (env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) {
    problems.push({ variable: 'RESEND_API_KEY', message: 'RESEND_API_KEY is not set, so no email can be sent.' });
  } else if (!apiKey.startsWith('re_')) {
    // A Resend key is `re_…`. Catching the shape here turns a confusing provider 401 at send
    // time into a configuration error the operator can act on.
    problems.push({ variable: 'RESEND_API_KEY', message: 'RESEND_API_KEY does not look like a Resend key (expected it to start with "re_").' });
  }

  const rawFrom = (env.RESEND_FROM_EMAIL ?? '').trim();
  let sender: EmailSender | null = null;
  if (!rawFrom) {
    problems.push({
      variable: 'RESEND_FROM_EMAIL',
      message: 'RESEND_FROM_EMAIL is not set. There is no default sender: an unverified guess would be rejected by the provider, so the sender must be configured explicitly.',
    });
  } else {
    sender = parseSender(rawFrom);
    if (!sender) {
      problems.push({
        variable: 'RESEND_FROM_EMAIL',
        message: 'RESEND_FROM_EMAIL is not a usable sender. Expected "name@example.com" or "Display Name <name@example.com>".',
      });
    }
  }

  const rawReplyTo = (env.RESEND_REPLY_TO ?? '').trim();
  let replyTo: string | null = null;
  if (rawReplyTo) {
    const parsed = parseSender(rawReplyTo);
    if (!parsed) {
      problems.push({ variable: 'RESEND_REPLY_TO', message: 'RESEND_REPLY_TO is set but is not a usable address.' });
    } else {
      replyTo = parsed.address;
    }
  }

  if (problems.length || !sender) return { configured: false, problems };
  return { configured: true, config: { apiKey, sender, replyTo } };
}
