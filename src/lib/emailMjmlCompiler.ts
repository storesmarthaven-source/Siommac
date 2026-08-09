// src/lib/emailMjmlCompiler.ts — the production email HTML pipeline.
//
// Contract (docs/module-contracts/EMAIL_TEMPLATE_STUDIO_CONTRACT.md) + user
// decision 2026-08-03: SIOMAC editor → canonical block schema → MJML source
// (renderEmailMjml) → MJML compile → client-compatible HTML with Outlook
// conditionals. Preview and send always use the COMPILED HTML, never raw MJML.
//
// `mjml-browser` is pinned exactly (5.4.0). It is loaded lazily so the editor
// bundle stays lean; the future server route uses the sibling `mjml` package
// (same core, same pin) for authoritative recompilation before send.
import type { EmailEditorSchema } from '../../types/emailTemplates';
import { renderEmailMjml, renderEmailPreview } from './emailTemplateDocument';

export interface CompiledEmail {
  /** Client-compatible HTML compiled by MJML. */
  html: string;
  /** Plain-text alternative derived from the schema. */
  text: string;
  /** The intermediate MJML source (diagnostics; never sent). */
  mjml: string;
  /** MJML validation errors. Non-empty output still compiles best-effort. */
  errors: string[];
}

type MjmlCompileResult = {
  html: string;
  errors: { formattedMessage?: string; message?: string }[];
};
type MjmlCompiler = (source: string) => Promise<MjmlCompileResult> | MjmlCompileResult;

let compilerPromise: Promise<MjmlCompiler> | null = null;

async function loadCompiler(): Promise<MjmlCompiler> {
  compilerPromise ??= import('mjml-browser').then(
    module => (module as { default?: MjmlCompiler }).default ?? (module as unknown as MjmlCompiler),
  );
  return compilerPromise;
}

export async function compileEmailDocument(
  document: EmailEditorSchema,
  title: string,
): Promise<CompiledEmail> {
  const mjmlSource = renderEmailMjml(document, title);
  const compile = await loadCompiler();
  const result = await compile(mjmlSource);
  return {
    html: result.html,
    text: renderEmailPreview(document, title).text,
    mjml: mjmlSource,
    errors: result.errors.map(error => error.formattedMessage ?? error.message ?? 'Unknown MJML error'),
  };
}
