/**
 * lib/email/emailCompatibility.ts — the last gate before authored content becomes real mail.
 *
 * ⭐⭐ WHY THIS EXISTS. Compiling successfully is not the same as rendering in an inbox. The Gmail
 * icon defect passed every gate we had: the schema was valid, MJML compiled without a warning,
 * both renderers agreed, and the E2E was green — and Gmail still deleted nine icons, because
 * nothing ever asked whether the FINAL HTML used constructs a mail client actually supports.
 * Parity between two of our own renderers cannot answer that question; only an assertion about the
 * delivered markup can.
 *
 * ⭐ So this inspects the COMPILED, VARIABLE-RESOLVED, ASSET-RESOLVED html — the exact bytes that
 * would be handed to the provider — and refuses anything that is known not to survive delivery.
 * Every rule below is a construct that either fails silently in a real client or is a security
 * hazard; none of them is a style preference.
 *
 * ⛔ SCOPE: authored content, i.e. the Email Template Studio send path. Notification, invitation
 * and payslip bodies are built by code that is reviewed once and cannot be edited by a user, so
 * they are not run through this gate — a template is the only place arbitrary markup enters.
 */

import { emailAssetBaseUrl } from './emailAssetResolver';
import { EMAIL_ICON_ASSET_PREFIX } from '../../../../src/lib/emailIcons';

export interface EmailCompatibilityIssue {
  /** Stable machine code, so a caller can branch without parsing prose. */
  code:
    | 'inline_svg'
    | 'script_tag'
    | 'javascript_url'
    | 'local_url'
    | 'unresolved_variable'
    | 'relative_image'
    | 'unhosted_icon';
  message: string;
  /** The offending fragments, de-duplicated and capped so a refusal stays readable. */
  samples: string[];
}

export interface EmailCompatibilityReport {
  ok: boolean;
  issues: EmailCompatibilityIssue[];
}

const SAMPLE_LIMIT = 8;

const sample = (values: Iterable<string>): string[] => [...new Set(values)].slice(0, SAMPLE_LIMIT);

/** Every `<img src>` value in the document, in order. */
function imageSources(html: string): string[] {
  const out: string[] = [];
  const pattern = /<img[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match[1]) out.push(match[1].trim());
  }
  return out;
}

const isAbsolute = (src: string): boolean => /^https?:\/\//i.test(src) || /^data:/i.test(src);

/**
 * Validate compiled production email HTML.
 *
 * @param html  compiled, variable-resolved, asset-resolved markup — NOT the MJML source and NOT
 *              the pre-resolution html, or the relative-image and unresolved-variable rules will
 *              fire on work the pipeline was always going to do.
 */
export function checkEmailCompatibility(
  html: string,
  env: NodeJS.ProcessEnv = process.env,
): EmailCompatibilityReport {
  const issues: EmailCompatibilityIssue[] = [];

  // 1. Inline SVG — the defect this module was written for. Gmail strips `<svg>` from message
  // bodies outright, leaving whatever wrapper the icon sat in as an empty box. Silent, and
  // invisible in every preview we own.
  const svgMatches = html.match(/<svg\b/gi);
  if (svgMatches) {
    issues.push({
      code: 'inline_svg',
      message: `Contains ${svgMatches.length} inline <svg> element(s). Gmail strips inline SVG, so these would arrive as blank spaces. Icons must render as hosted PNG <img> — see src/lib/emailIcons.ts.`,
      samples: [],
    });
  }

  // 2/3. Script and javascript: URLs — stripped by every mail client, and an injection vector in
  // the ones that mishandle them. Either way they must never leave the building.
  const scriptMatches = html.match(/<script\b/gi);
  if (scriptMatches) {
    issues.push({
      code: 'script_tag',
      message: `Contains ${scriptMatches.length} <script> element(s). Email clients strip scripts; content that depends on one cannot work in an inbox.`,
      samples: [],
    });
  }
  const jsUrls = html.match(/["'\s(]javascript:[^"'\s)]*/gi);
  if (jsUrls) {
    issues.push({
      code: 'javascript_url',
      message: 'Contains a javascript: URL. These do not execute in mail clients and are treated as hostile by spam filters.',
      samples: sample(jsUrls.map(v => v.slice(1).trim())),
    });
  }

  // 4. Local URLs — resolvable on the machine that compiled the mail and nowhere else. This is the
  // classic way a staging build ships links and images that are dead for every recipient.
  const localUrls = html.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^"'\s>]*/gi);
  if (localUrls) {
    issues.push({
      code: 'local_url',
      message: 'Contains localhost URLs, which resolve only on the machine that built the message. Recipients would get dead links and broken images.',
      samples: sample(localUrls),
    });
  }

  // 5. Unresolved tokens. The pipeline already refuses these before compiling; re-checking the
  // final bytes catches the case the earlier pass structurally cannot — a token that arrived
  // inside a supplied VARIABLE VALUE rather than the template.
  const tokens = html.match(/\{\{\s*[\w.]+\s*\}\}/g);
  if (tokens) {
    issues.push({
      code: 'unresolved_variable',
      message: `Contains ${tokens.length} unresolved placeholder(s). A visible {{token}} in a delivered email is permanent.`,
      samples: sample(tokens),
    });
  }

  // 6. Relative images. A mail client fetches with no session and no page context, so a relative
  // src has nothing to resolve against and always arrives broken.
  const sources = imageSources(html);
  const relative = sources.filter(src => !isAbsolute(src));
  if (relative.length) {
    issues.push({
      code: 'relative_image',
      message: 'Contains images with relative sources. A mail client has no base URL to resolve them against, so they would arrive broken.',
      samples: sample(relative),
    });
  }

  // 7. Icons specifically must sit on the approved email asset host. An icon URL pointing anywhere
  // else means the resolver did not run or the path was hand-written — either way the asset was
  // never published, and an unpublished icon is a broken image in a real inbox.
  const base = emailAssetBaseUrl(env);
  const iconPattern = /\/icons\/[a-z]+\/[a-z0-9-]+\.png$/i;
  const strayIcons = sources.filter(src => {
    if (src.includes(EMAIL_ICON_ASSET_PREFIX)) return true;
    if (!iconPattern.test(src)) return false;
    return !base || !src.startsWith(`${base}/`);
  });
  if (strayIcons.length) {
    issues.push({
      code: 'unhosted_icon',
      message: `Icon images must resolve to the approved email asset host${base ? ` (${base})` : ''}. These do not, so the asset was never published and would arrive broken.`,
      samples: sample(strayIcons),
    });
  }

  return { ok: issues.length === 0, issues };
}
