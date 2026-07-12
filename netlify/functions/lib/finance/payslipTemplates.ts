// ============================================================================
// Finance Payroll -- Payslip layout templates (Payslip Studio, Phase 1)
// ============================================================================
// Named payslip DESIGNS authored in the embedded Payslip Studio. `design` is the
// full self-contained Design JSON (presentation only -- employer block, logo,
// which sections/components show, footer). NOT a figure editor: pay figures never
// live here. One active default at a time (guarded by a partial unique index);
// soft-delete via status='archived'. The DTO mirrors the studio's StoredTemplate
// exactly so ApiTemplateStore is a drop-in for LocalTemplateStore.
// Follows the finance house pattern: direct sb writes + awaited writeHrAudit +
// emitAppEvent (no runModuleMutation -- there is no workflow/handoff to
// orchestrate, so the adapter would be ceremony).
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { validateDesign } from './payslipDesignSchema';

const SUBMODULE = 'finance_payroll';
const ENTITY = 'payslip_template';
const SELECT = 'id,name,design,is_default,status,created_at,updated_at';
const MAX_NAME = 120;

/** Wire shape consumed by the studio (StoredTemplate). `updatedAt` is epoch ms. */
export interface PayslipTemplateDto {
  id: string;
  name: string;
  isDefault: boolean;
  updatedAt: number;
  design: unknown;
}

interface DbRow {
  id: string;
  name: string;
  design: unknown;
  is_default: boolean;
  status: string;
  created_at: string;
  updated_at: string | null;
}

function toDto(r: DbRow): PayslipTemplateDto {
  return {
    id: r.id,
    name: r.name,
    isDefault: !!r.is_default,
    updatedAt: Date.parse(r.updated_at ?? r.created_at),
    design: r.design,
  };
}

function err(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/**
 * Assert that a payslip design passes full schema validation.
 * Rejects malformed designs with 422 rather than silently accepting them and
 * letting broken JSON reach the PDF renderer later.
 * Uses the shared validateDesign() from payslipDesignSchema.ts so create and
 * update enforce exactly the same rules (no duplication).
 */
function assertDesign(design: unknown): asserts design is Record<string, unknown> {
  const validationError = validateDesign(design);
  if (validationError) throw err(validationError, 422);
}

function cleanName(name: unknown): string {
  const s = String(name ?? '').trim();
  if (!s) throw err('Template name is required.', 422);
  if (s.length > MAX_NAME) throw err(`Template name must be at most ${MAX_NAME} characters.`, 422);
  return s;
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function listTemplates(): Promise<PayslipTemplateDto[]> {
  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('status', 'active')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw err('listTemplates: ' + error.message, 500);
  return ((data ?? []) as DbRow[]).map(toDto);
}

export async function getTemplate(id: string): Promise<PayslipTemplateDto | null> {
  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', id)
    .eq('status', 'active')
    .maybeSingle<DbRow>();
  if (error) throw err('getTemplate: ' + error.message, 500);
  return data ? toDto(data) : null;
}

/** Number of active templates -- drives "first template becomes the default". */
async function activeCount(): Promise<number> {
  const { count, error } = await sb
    .from('payroll_payslip_templates')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');
  if (error) throw err('activeCount: ' + error.message, 500);
  return count ?? 0;
}

/** Load an active template row (for guards) or throw 404. */
async function requireActive(id: string): Promise<DbRow> {
  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', id)
    .eq('status', 'active')
    .maybeSingle<DbRow>();
  if (error) throw err('loadTemplate: ' + error.message, 500);
  if (!data) throw err('Payslip template not found.', 404);
  return data;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface CreateTemplateInput {
  name: string;
  design: unknown;
}

export async function createTemplate(input: CreateTemplateInput, actorId: string): Promise<PayslipTemplateDto> {
  const name = cleanName(input.name);
  assertDesign(input.design);

  // Mirror the local store: the very first template becomes the default so a
  // usable default always exists. No conflict with the unique index because
  // there are zero active defaults when count is 0.
  const isDefault = (await activeCount()) === 0;

  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .insert({ name, design: input.design, is_default: isDefault, created_by: actorId, updated_by: actorId })
    .select(SELECT)
    .single<DbRow>();
  if (error) throw err('createTemplate: ' + error.message, 500);

  const dto = toDto(data);
  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: dto.id, actorId,
    action: 'payslip_template.created',
    newState: { name: dto.name, isDefault: dto.isDefault },
  });
  await emitAppEvent({
    eventType: 'finance.payroll.payslip_template.created',
    sourceModule: SUBMODULE, sourceEntityType: ENTITY, sourceEntityId: dto.id,
    actorUserId: actorId, severity: 'info',
    payload: { name: dto.name, isDefault: dto.isDefault },
  });
  return dto;
}

export interface UpdateTemplateInput {
  id: string;
  name?: string;
  design?: unknown;
}

export async function updateTemplate(input: UpdateTemplateInput, actorId: string): Promise<PayslipTemplateDto | null> {
  const prev = await requireActive(input.id);

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (input.name !== undefined) patch.name = cleanName(input.name);
  if (input.design !== undefined) {
    assertDesign(input.design);
    patch.design = input.design;
  }

  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .update(patch)
    .eq('id', input.id)
    .eq('status', 'active')
    .select(SELECT)
    .maybeSingle<DbRow>();
  if (error) throw err('updateTemplate: ' + error.message, 500);
  if (!data) return null;

  const dto = toDto(data);
  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: dto.id, actorId,
    action: 'payslip_template.updated',
    previousState: { name: prev.name },
    newState: { name: dto.name },
  });
  await emitAppEvent({
    eventType: 'finance.payroll.payslip_template.updated',
    sourceModule: SUBMODULE, sourceEntityType: ENTITY, sourceEntityId: dto.id,
    actorUserId: actorId, severity: 'info',
    payload: { name: dto.name },
  });
  return dto;
}

export async function setDefaultTemplate(id: string, actorId: string): Promise<PayslipTemplateDto> {
  // Atomic RPC: clears the old default and sets the new one in ONE transaction
  // (migration 20260919000090). The prior two-step clear-then-set was non-atomic:
  // a crash between the two calls left zero active defaults.
  const { error: rpcErr } = await sb.rpc('payroll_set_default_template', {
    p_id: id, p_actor_id: actorId,
  });
  if (rpcErr) {
    // Postgres raises P0002 (no_data_found) when the template doesn't exist or
    // is already archived. Map to 404 so the caller gets a meaningful status.
    if (rpcErr.message.includes('not found or not active'))
      throw err('Payslip template not found.', 404);
    throw err('setDefaultTemplate: ' + rpcErr.message, 500);
  }

  // Fetch the freshly-updated row to build the DTO.
  const { data, error: selErr } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle<DbRow>();
  if (selErr) throw err('setDefaultTemplate/fetch: ' + selErr.message, 500);
  if (!data) throw err('Payslip template not found after update.', 404);

  const dto = toDto(data);
  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: dto.id, actorId,
    action: 'payslip_template.default_changed',
    newState: { name: dto.name, isDefault: true },
  });
  await emitAppEvent({
    eventType: 'finance.payroll.payslip_template.default_changed',
    sourceModule: SUBMODULE, sourceEntityType: ENTITY, sourceEntityId: dto.id,
    actorUserId: actorId, severity: 'info',
    payload: { name: dto.name },
  });
  return dto;
}

export async function archiveTemplate(id: string, actorId: string): Promise<{ ok: true }> {
  // Load the row before archiving so we can write a meaningful audit previousState.
  // requireActive throws 404 if the template doesn't exist/is already archived.
  const prev = await requireActive(id);

  // Atomic RPC: archives the row AND promotes the next-default in ONE transaction
  // (migration 20260919000090). The prior archive-then-promote was non-atomic:
  // a crash between the two calls left zero active defaults.
  const { error: rpcErr } = await sb.rpc('payroll_archive_template', {
    p_id: id, p_actor_id: actorId,
  });
  if (rpcErr) {
    if (rpcErr.message.includes('not found or not active'))
      throw err('Payslip template not found.', 404);
    throw err('archiveTemplate: ' + rpcErr.message, 500);
  }

  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: id, actorId,
    action: 'payslip_template.archived',
    previousState: { name: prev.name, isDefault: prev.is_default },
  });
  await emitAppEvent({
    eventType: 'finance.payroll.payslip_template.archived',
    sourceModule: SUBMODULE, sourceEntityType: ENTITY, sourceEntityId: id,
    actorUserId: actorId, severity: 'info',
    payload: { name: prev.name },
  });
  return { ok: true };
}

// ── Per-user editor state (autosave draft + open-ref) ───────────────────────────
// Private per-user scratch state that replaces the studio's browser localStorage,
// so nothing is browser-only. Not a business record: no events/audit (like a
// widget layout). Every query is scoped to the calling user's id.

export interface OpenRef { id: string; name: string }
export interface EditorState { draftDesign: unknown | null; openRef: OpenRef | null }

export async function getEditorState(userId: string): Promise<EditorState> {
  const { data, error } = await sb
    .from('payroll_payslip_editor_state')
    .select('draft_design, open_ref')
    .eq('user_id', userId)
    .maybeSingle<{ draft_design: unknown; open_ref: OpenRef | null }>();
  if (error) throw err('getEditorState: ' + error.message, 500);
  return { draftDesign: data?.draft_design ?? null, openRef: data?.open_ref ?? null };
}

export interface SaveEditorStateInput { draftDesign?: unknown | null; openRef?: OpenRef | null }

/** Partial upsert: only the provided keys are written (unset keys are preserved). */
export async function saveEditorState(userId: string, input: SaveEditorStateInput): Promise<{ ok: true }> {
  const patch: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if ('draftDesign' in input) patch.draft_design = input.draftDesign ?? null;
  if ('openRef' in input) patch.open_ref = input.openRef ?? null;

  const { error } = await sb
    .from('payroll_payslip_editor_state')
    .upsert(patch, { onConflict: 'user_id' });
  if (error) throw err('saveEditorState: ' + error.message, 500);
  return { ok: true };
}
