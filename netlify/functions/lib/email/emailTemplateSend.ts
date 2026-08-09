/**
 * lib/email/emailTemplateSend.ts — the production send path for Email Template Studio.
 *
 *   Studio → load AUTHORITATIVE template/version → resolve approved variables
 *          → resolve hosted assets → compile MJML server-side → validate
 *          → sendEmail() → email_deliveries → Resend
 *
 * ⛔ THE BROWSER NEVER SUPPLIES THE BODY. The caller names a template key and a set of variables;
 * everything that is actually sent comes from the PUBLISHED version row. Accepting a rendered
 * document from the client would let it dictate the content of mail leaving the platform's
 * verified sending domain.
 *
 * ⛔ `compiled_html` ON THE VERSION IS A CACHE, NOT THE SEND SOURCE. Production recompiles from
 * `editor_schema` here, so a stale or tampered cache column can never become an outgoing email.
 *
 * ⛔ NO RESEND IMPORT. This composes a message and hands it to sendEmail(); resendTransport.ts
 * remains the only place the provider SDK exists.
 */

import { sb } from '../db';
import { sendEmail } from './emailService';
import { renderEmailMjml } from '../../../../src/lib/emailTemplateDocument';
import type { EmailEditorSchema } from '../../../../types/emailTemplates';

export type TemplateSendRefusal =
  | 'template_not_found'
  | 'no_published_version'
  | 'unresolved_variables'
  | 'unhosted_assets'
  | 'compile_failed';

export type TemplateSendResult =
  | {
      ok: true;
      deliveryId: string | null;
      providerMessageId: string | null;
      templateKey: string;
      versionNo: number;
      recipients: string[];
      dryRun: boolean;
      deduplicated: boolean;
    }
  | { ok: false; refusal: TemplateSendRefusal; message: string; detail?: string[] };

/** `{{ token }}` — the placeholder syntax the Studio authors against. */
const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Substitute approved variables and REFUSE if any placeholder survives.
 *
 * A template that ships `Hi {{recipient.firstName}}` to a real person because a variable was
 * missing is worse than one that fails to send: the failure is visible and fixable, the placeholder
 * is public and permanent. Every unresolved token is named so the caller can supply it.
 */
export function resolveTemplateVariables(
  source: string,
  variables: Record<string, string>,
): { ok: true; text: string } | { ok: false; missing: string[] } {
  const missing = new Set<string>();
  const text = source.replace(TOKEN_RE, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null || value === '') { missing.add(key); return _match; }
    return String(value);
  });
  return missing.size ? { ok: false, missing: [...missing].sort() } : { ok: true, text };
}

/**
 * Every image must already be hosted at an absolute URL.
 *
 * The Studio authors against repo-relative asset paths (`/assets/images/email/...`), which resolve
 * in the canvas and in a preview iframe and resolve to NOTHING in a mail client — the recipient
 * gets broken images. A real send therefore refuses them rather than shipping a broken email.
 */
export function findUnhostedAssets(html: string): string[] {
  const unhosted = new Set<string>();
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = (match[1] ?? '').trim();
    if (!src) continue;
    // data: URIs are self-contained and therefore fine; everything else must be absolute http(s).
    if (/^https?:\/\//i.test(src) || /^data:/i.test(src)) continue;
    unhosted.add(src);
  }
  return [...unhosted].sort();
}

interface VersionRow {
  id: string; version_no: number; subject: string; preheader: string;
  editor_schema: EmailEditorSchema; status: string;
}
interface TemplateRow { id: string; template_key: string; name: string; status: string }

export interface TemplateSendArgs {
  templateKey: string;
  to: string | string[];
  variables?: Record<string, string>;
  actorId: string;
  /** Validate and compile without transmitting. Records nothing — see sendEmail. */
  dryRun?: boolean;
  /** Caller-supplied durable key. Defaults to template+version+recipients+variables (content). */
  idempotencyKey?: string;
}

export async function sendTemplateEmail(args: TemplateSendArgs): Promise<TemplateSendResult> {
  // ── 1. the AUTHORITATIVE template + published version ──
  const { data: template, error: tplErr } = await sb.from('email_templates')
    .select('id, template_key, name, status').eq('template_key', args.templateKey)
    .maybeSingle<TemplateRow>();
  if (tplErr) throw Object.assign(new Error(`Template lookup failed: ${tplErr.message}`), { status: 500 });
  if (!template) {
    return { ok: false, refusal: 'template_not_found', message: `No email template exists with the key "${args.templateKey}".` };
  }

  const { data: version, error: verErr } = await sb.from('email_template_versions')
    .select('id, version_no, subject, preheader, editor_schema, status')
    .eq('template_id', template.id).eq('status', 'published')
    .maybeSingle<VersionRow>();
  if (verErr) throw Object.assign(new Error(`Template version lookup failed: ${verErr.message}`), { status: 500 });
  if (!version) {
    // A draft is not sendable. Publishing is the control that says a human approved this content.
    return {
      ok: false, refusal: 'no_published_version',
      message: `"${template.name}" has no published version. Publish it before sending — a draft has not been approved for real recipients.`,
    };
  }

  // ── 2. compile SERVER-SIDE from the canonical schema ──
  // renderEmailMjml is the SAME renderer the editor uses, so what is sent matches what was
  // designed; the difference is only where it runs and that the cached HTML is ignored.
  let mjmlSource: string;
  try {
    mjmlSource = renderEmailMjml(version.editor_schema, version.subject);
  } catch (e) {
    return { ok: false, refusal: 'compile_failed', message: `The template could not be rendered: ${e instanceof Error ? e.message : String(e)}` };
  }

  const variables = args.variables ?? {};
  // Variables are substituted BEFORE compiling, so a token inside an attribute or a URL is
  // resolved too — not just the ones sitting in visible text.
  //
  // ⭐ The SUBJECT is checked in the same pass as the body. A subject line is the most visible
  // part of an email, so an unresolved token there ("Welcome to {{company.name}}") is the worst
  // place for one to survive — and checking only the body would have let it through.
  const resolvedSource = resolveTemplateVariables(mjmlSource, variables);
  const resolvedSubject = resolveTemplateVariables(version.subject, variables);
  if (!resolvedSource.ok || !resolvedSubject.ok) {
    const missing = [...new Set([
      ...(resolvedSource.ok ? [] : resolvedSource.missing),
      ...(resolvedSubject.ok ? [] : resolvedSubject.missing),
    ])].sort();
    return {
      ok: false, refusal: 'unresolved_variables',
      message: `This template needs values that were not supplied: ${missing.join(', ')}. Nothing was sent — a placeholder reaching a real recipient is permanent.`,
      detail: missing,
    };
  }

  let html: string;
  try {
    const mjml2html = (await import('mjml')).default as unknown as
      (src: string, opts?: Record<string, unknown>) => { html: string; errors: Array<{ message: string }> } | Promise<{ html: string; errors: Array<{ message: string }> }>;
    const compiled = await mjml2html(resolvedSource.text, { validationLevel: 'strict' });
    if (compiled.errors?.length) {
      return {
        ok: false, refusal: 'compile_failed',
        message: `The template failed MJML validation: ${compiled.errors.map(e => e.message).join('; ')}`,
        detail: compiled.errors.map(e => e.message),
      };
    }
    html = compiled.html;
  } catch (e) {
    return { ok: false, refusal: 'compile_failed', message: `MJML compilation failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // ── 3. assets must already be hosted ──
  const unhosted = findUnhostedAssets(html);
  if (unhosted.length) {
    return {
      ok: false, refusal: 'unhosted_assets',
      message: `These images are not hosted at an absolute URL and would arrive broken: ${unhosted.join(', ')}. Upload them and update the template before sending.`,
      detail: unhosted,
    };
  }

  // ── 4. the canonical send ──
  const recipients = Array.isArray(args.to) ? args.to : [args.to];
  // Content-derived by default: the same template version, to the same people, with the same
  // values, is the same email — so a repeated request dedupes instead of mailing twice.
  const idempotencyKey = args.idempotencyKey?.trim()
    || `email_studio:${template.template_key}:v${version.version_no}:${recipients.slice().sort().join(',')}:${JSON.stringify(variables)}`.slice(0, 200);

  const result = await sendEmail({
    to: args.to,
    subject: resolvedSubject.text,
    html,
  }, {
    moduleKey: 'platform',
    useCase: 'email_studio',
    idempotencyKey,
    sourceModule: 'platform',
    sourceEntityType: 'email_template_version',
    sourceEntityId: version.id,
    actorUserId: args.actorId,
    // Origin metadata, so an audit can say WHICH template and version produced an email.
    metadata: { templateKey: template.template_key, templateName: template.name, versionNo: version.version_no },
  }, { dryRun: args.dryRun === true });

  if (!result.ok) {
    return { ok: false, refusal: 'compile_failed', message: result.message };
  }
  return {
    ok: true,
    deliveryId: result.deliveryId,
    providerMessageId: result.providerMessageId,
    templateKey: template.template_key,
    versionNo: version.version_no,
    recipients: result.recipients,
    dryRun: result.dryRun,
    deduplicated: result.deduplicated,
  };
}
