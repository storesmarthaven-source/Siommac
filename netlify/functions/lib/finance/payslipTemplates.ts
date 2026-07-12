// ============================================================================
// Finance Payroll -- Payslip layout templates (Payslip Studio)
// ============================================================================
// Named payslip DESIGNS authored in the embedded Payslip Studio. `design` is the
// full self-contained Design JSON (presentation only -- employer block, logo,
// which sections/components show, footer). NOT a figure editor: pay figures never
// live here.
//
// Lifecycle (maker-checker, migration 20260919000110):
//   draft -> pending_approval -> approved
//   pending_approval -> changes_requested -> pending_approval (request-changes path)
//   approved -> editing creates a new draft version (createTemplateVersion)
//
// Only approved templates can be set as default or linked to a payroll run.
// The partial unique index + both Postgres RPCs enforce status='approved'.
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { validateDesign } from './payslipDesignSchema';
import { startWorkflowForRecord, decideTask } from '../workflow/service';
import { assertDifferentApprover } from './statutoryConfig';
import { notifyUsersByRole } from './financeEvents';
import { notify } from '../notify';

const SUBMODULE = 'finance_payroll';
const ENTITY    = 'payslip_template';
// Columns include new approval-lifecycle fields added by migration 20260919000110.
// They are not in the generated Supabase types yet, so casts use `unknown`.
const SELECT = 'id,name,design,is_default,status,version,parent_template_id,' +
               'submitted_by,approved_by,approved_at,workflow_id,created_by,' +
               'created_at,updated_at';
const MAX_NAME  = 120;

/** Wire shape consumed by the studio (StoredTemplate) and the FE. `updatedAt` is epoch ms. */
export interface PayslipTemplateDto {
  id:               string;
  name:             string;
  isDefault:        boolean;
  updatedAt:        number;
  design:           unknown;
  status:           string;
  version:          number;
  parentTemplateId: string | null;
  submittedBy:      string | null;
  approvedBy:       string | null;
  approvedAt:       string | null;
  workflowId:       string | null;
  createdBy:        string | null;
}

interface DbRow {
  id:                 string;
  name:               string;
  design:             unknown;
  is_default:         boolean;
  status:             string;
  version:            number;
  parent_template_id: string | null;
  submitted_by:       string | null;
  approved_by:        string | null;
  approved_at:        string | null;
  workflow_id:        string | null;
  created_by:         string | null;
  created_at:         string;
  updated_at:         string | null;
}

function toDto(r: DbRow): PayslipTemplateDto {
  return {
    id:               r.id,
    name:             r.name,
    isDefault:        !!r.is_default,
    updatedAt:        Date.parse(r.updated_at ?? r.created_at),
    design:           r.design,
    status:           r.status,
    version:          r.version,
    parentTemplateId: r.parent_template_id ?? null,
    submittedBy:      r.submitted_by ?? null,
    approvedBy:       r.approved_by ?? null,
    approvedAt:       r.approved_at ?? null,
    workflowId:       r.workflow_id ?? null,
    createdBy:        r.created_by ?? null,
  };
}

function err(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/**
 * Assert that a payslip design passes full schema validation.
 * Rejects malformed designs with 422 rather than silently accepting them and
 * letting broken JSON reach the PDF renderer later.
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

/** List all non-archived templates. The Studio shows status badges for pending/draft/approved. */
export async function listTemplates(): Promise<PayslipTemplateDto[]> {
  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .neq('status', 'archived')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw err('listTemplates: ' + error.message, 500);
  return ((data ?? []) as unknown as DbRow[]).map(toDto);
}

/** Fetch a single non-archived template by ID. Returns null if not found or archived. */
export async function getTemplate(id: string): Promise<PayslipTemplateDto | null> {
  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', id)
    .neq('status', 'archived')
    .maybeSingle();
  if (error) throw err('getTemplate: ' + error.message, 500);
  return data ? toDto(data as unknown as DbRow) : null;
}

/** Load a row whose status allows edits (draft or changes_requested) or throw 404/422. */
async function requireEditable(id: string): Promise<DbRow> {
  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw err('requireEditable: ' + error.message, 500);
  if (!data) throw err('Payslip template not found.', 404);
  const row = data as unknown as DbRow;
  if (!['draft', 'changes_requested'].includes(row.status)) {
    throw err(
      `Template "${row.name}" is in status '${row.status}' and cannot be edited. ` +
      `Use 'create-version' to edit an approved template.`,
      422,
    );
  }
  return row;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface CreateTemplateInput {
  name:   string;
  design: unknown;
}

/**
 * Create a new template as a DRAFT. Only approved templates can be set as
 * default; drafts never auto-become the default.
 */
export async function createTemplate(input: CreateTemplateInput, actorId: string): Promise<PayslipTemplateDto> {
  const name = cleanName(input.name);
  assertDesign(input.design);

  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .insert({
      name,
      design:     input.design,
      status:     'draft',
      is_default: false,
      version:    1,
      created_by: actorId,
      updated_by: actorId,
    })
    .select(SELECT)
    .single();
  if (error) throw err('createTemplate: ' + error.message, 500);

  const dto = toDto(data as unknown as DbRow);
  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: dto.id, actorId,
    action: 'payslip_template.created',
    newState: { name: dto.name, status: 'draft' },
  });
  await emitAppEvent({
    eventType: 'finance.payroll.payslip_template.created',
    sourceModule: SUBMODULE, sourceEntityType: ENTITY, sourceEntityId: dto.id,
    actorUserId: actorId, severity: 'info',
    payload: { name: dto.name, status: 'draft' },
  });
  return dto;
}

export interface UpdateTemplateInput {
  id:      string;
  name?:   string;
  design?: unknown;
}

/** Update a draft or changes-requested template. Approved/pending templates cannot be edited. */
export async function updateTemplate(input: UpdateTemplateInput, actorId: string): Promise<PayslipTemplateDto | null> {
  const prev = await requireEditable(input.id);

  const patch: Record<string, unknown> = { updated_by: actorId };
  if (input.name   !== undefined) patch.name   = cleanName(input.name);
  if (input.design !== undefined) {
    assertDesign(input.design);
    patch.design = input.design;
  }

  const { data, error } = await sb
    .from('payroll_payslip_templates')
    .update(patch)
    .eq('id', input.id)
    .in('status', ['draft', 'changes_requested'])
    .select(SELECT)
    .maybeSingle();
  if (error) throw err('updateTemplate: ' + error.message, 500);
  if (!data) return null;

  const dto = toDto(data as unknown as DbRow);
  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: dto.id, actorId,
    action: 'payslip_template.updated',
    previousState: { name: prev.name, status: prev.status },
    newState: { name: dto.name, status: dto.status },
  });
  await emitAppEvent({
    eventType: 'finance.payroll.payslip_template.updated',
    sourceModule: SUBMODULE, sourceEntityType: ENTITY, sourceEntityId: dto.id,
    actorUserId: actorId, severity: 'info',
    payload: { name: dto.name },
  });
  return dto;
}

/**
 * Submit a draft/changes_requested template for approval via the central workflow engine.
 * Transitions: draft|changes_requested -> pending_approval.
 * Compensating rollback: if startWorkflowForRecord fails, status is reverted.
 */
export async function submitTemplate(id: string, actorId: string): Promise<PayslipTemplateDto> {
  const { data: prev, error: loadErr } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (loadErr) throw err('submitTemplate/load: ' + loadErr.message, 500);
  if (!prev) throw err('Payslip template not found.', 404);
  const prevRow = prev as unknown as DbRow;
  if (!['draft', 'changes_requested'].includes(prevRow.status)) {
    throw err(
      `Cannot submit: template is in status '${prevRow.status}'. Only 'draft' or 'changes_requested' templates can be submitted.`,
      422,
    );
  }

  // Set to pending_approval first (workflow manages status from here)
  const { data: updated, error: updErr } = await sb
    .from('payroll_payslip_templates')
    .update({ status: 'pending_approval', submitted_by: actorId })
    .eq('id', id)
    .in('status', ['draft', 'changes_requested'])
    .select(SELECT)
    .maybeSingle();
  if (updErr) throw err('submitTemplate/update: ' + updErr.message, 500);
  if (!updated) throw err('Template was modified concurrently — please retry.', 409);
  const updatedRow = updated as unknown as DbRow;

  let workflowInstance: { id: string } | null = null;
  try {
    workflowInstance = await startWorkflowForRecord({
      context: {
        moduleKey:      'finance_payroll_templates',
        workflowType:   'payslip_template_approval',
        triggerEvent:   'finance.payroll.template.submitted',
        sourceRecordId: id,
        requestedBy:    actorId,
        recordData: {
          templateName: prevRow.name,
          version:      prevRow.version,
          submittedBy:  actorId,
        },
      },
      actor: { id: actorId },
    });
  } catch (wfErr) {
    // Compensating rollback: revert to pre-submit status
    await sb.from('payroll_payslip_templates')
      .update({ status: prevRow.status, submitted_by: prevRow.submitted_by })
      .eq('id', id);
    throw err('submitTemplate/workflow: ' + (wfErr as Error).message, 500);
  }

  // Stamp workflow_id if a workflow was created
  if (workflowInstance) {
    await sb.from('payroll_payslip_templates')
      .update({ workflow_id: workflowInstance.id })
      .eq('id', id);
  }

  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: id, actorId,
    action: 'payslip_template.submitted',
    previousState: { status: prevRow.status },
    newState: { status: 'pending_approval', workflowId: workflowInstance?.id ?? null },
  });

  void emitAppEvent({
    eventType:        'finance.payroll.payslip_template.submitted',
    sourceModule:     SUBMODULE,
    sourceEntityType: ENTITY,
    sourceEntityId:   id,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { name: prevRow.name, version: prevRow.version, workflowId: workflowInstance?.id ?? null },
  });

  // Notify Finance Managers that a template is awaiting approval
  void notifyUsersByRole('finance_manager', {
    type:           'finance.payroll.template.pending_approval',
    title:          `Payslip template "${prevRow.name}" submitted for approval`,
    body:           `Version ${prevRow.version} of the template is awaiting your approval.`,
    module:         SUBMODULE,
    severity:       'warning',
    sourceType:     ENTITY,
    sourceId:       id,
    actionRequired: true,
    dedupeKey:      `payslip_template.pending_approval.${id}`,
  });

  return toDto({ ...updatedRow, workflow_id: workflowInstance?.id ?? null });
}

/**
 * Approve or request-changes on a pending_approval template.
 * Routes through the central workflow engine (decideTask). The adapter
 * (financePayslipTemplateAdapter) transitions the template status.
 * SoD: creator cannot approve their own template (enforced here + in adapter).
 */
export async function decideTemplateApproval(opts: {
  templateId: string;
  actor:      { id: string; role?: string | null };
  decision:   'approved' | 'rejected';
  comment?:   string;
}): Promise<PayslipTemplateDto> {
  const { data: row, error: loadErr } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', opts.templateId)
    .maybeSingle();
  if (loadErr) throw err('decideTemplateApproval/load: ' + loadErr.message, 500);
  if (!row) throw err('Payslip template not found.', 404);
  const tmpl = row as unknown as DbRow;
  if (tmpl.status !== 'pending_approval') {
    throw err(
      `Cannot ${opts.decision === 'approved' ? 'approve' : 'reject'}: template is in status '${tmpl.status}'. Only 'pending_approval' templates can be decided.`,
      422,
    );
  }
  if (opts.decision === 'rejected' && !opts.comment?.trim()) {
    throw err('A reason is required to request changes on a template.', 422);
  }
  // SoD fast-fail (adapter re-enforces at completion)
  if (opts.decision === 'approved') {
    assertDifferentApprover({
      actorId:   opts.actor.id,
      createdBy: tmpl.submitted_by ?? tmpl.created_by,
      action:    'approve a payslip template',
    });
  }
  if (!tmpl.workflow_id) {
    throw err(
      'This template has no approval workflow attached. Resubmit it to start a new approval.',
      422,
    );
  }

  const { data: tasks, error: tErr } = await sb
    .from('workflow_tasks')
    .select('id, assigned_to, assigned_role, status, created_at')
    .eq('workflow_id', tmpl.workflow_id!)
    .in('status', ['pending', 'open', 'in_progress'])
    .order('created_at', { ascending: true });
  if (tErr) throw err('decideTemplateApproval/tasks: ' + tErr.message, 500);
  const open = (tasks ?? []) as Array<{ id: string; assigned_to: string | null; assigned_role: string | null }>;
  if (open.length === 0) {
    throw err(
      'No open approval task found for this template — the workflow state is inconsistent. Resolve it from the workflow console.',
      409,
    );
  }
  // Actor must be the task's assignee (by user or by role)
  const mine = open.find(
    t => t.assigned_to === opts.actor.id ||
         (!!t.assigned_role && t.assigned_role === (opts.actor.role ?? '')),
  );
  if (!mine) {
    throw err(
      'The open approval task is not assigned to you — decide it from your workflow inbox, or have it reassigned.',
      403,
    );
  }

  await decideTask({
    workflowId: tmpl.workflow_id!,
    taskId:     mine.id,
    actor:      { id: opts.actor.id, role: opts.actor.role ?? undefined },
    decision:   opts.decision,
    comment:    opts.comment?.trim() || undefined,
  });

  // Adapter has transitioned the template status — return the fresh row.
  const fresh = await getTemplate(opts.templateId);
  if (!fresh) throw err('Template not found after decision.', 500);
  return fresh;
}

/**
 * Create a new editable version of an approved template.
 * Transitions: approved (original stays approved) -> new row with status='draft',
 * parent_template_id pointing to `id`, version = original.version + 1.
 */
export async function createTemplateVersion(id: string, actorId: string): Promise<PayslipTemplateDto> {
  const { data: orig, error: loadErr } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (loadErr) throw err('createTemplateVersion/load: ' + loadErr.message, 500);
  if (!orig) throw err('Payslip template not found.', 404);
  const origRow = orig as unknown as DbRow;
  if (origRow.status !== 'approved') {
    throw err(
      `Can only create a new version of an approved template (current status: '${origRow.status}').`,
      422,
    );
  }

  const { data: newRow, error: insErr } = await sb
    .from('payroll_payslip_templates')
    .insert({
      name:               origRow.name,
      design:             origRow.design,
      status:             'draft',
      is_default:         false,
      version:            origRow.version + 1,
      parent_template_id: origRow.id,
      created_by:         actorId,
      updated_by:         actorId,
    })
    .select(SELECT)
    .single();
  if (insErr) throw err('createTemplateVersion/insert: ' + insErr.message, 500);

  const dto = toDto(newRow as unknown as DbRow);
  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: dto.id, actorId,
    action: 'payslip_template.version_created',
    newState: { name: dto.name, version: dto.version, parentTemplateId: id, status: 'draft' },
  });
  await emitAppEvent({
    eventType:        'finance.payroll.payslip_template.version_created',
    sourceModule:     SUBMODULE,
    sourceEntityType: ENTITY,
    sourceEntityId:   dto.id,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { name: dto.name, version: dto.version, parentTemplateId: id },
  });
  return dto;
}

export async function setDefaultTemplate(id: string, actorId: string): Promise<PayslipTemplateDto> {
  // Atomic RPC: clears the old default and sets the new one in ONE transaction.
  // RPC checks status='approved' (migration 20260919000110 recreated it).
  const { error: rpcErr } = await sb.rpc('payroll_set_default_template', {
    p_id: id, p_actor_id: actorId,
  });
  if (rpcErr) {
    if (rpcErr.message.includes('not found or not approved'))
      throw err('Payslip template not found or not approved.', 404);
    throw err('setDefaultTemplate: ' + rpcErr.message, 500);
  }

  const { data, error: selErr } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw err('setDefaultTemplate/fetch: ' + selErr.message, 500);
  if (!data) throw err('Payslip template not found after update.', 404);

  const dto = toDto(data as unknown as DbRow);
  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: dto.id, actorId,
    action: 'payslip_template.default_changed',
    newState: { name: dto.name, isDefault: true },
  });
  await emitAppEvent({
    eventType:        'finance.payroll.payslip_template.default_changed',
    sourceModule:     SUBMODULE,
    sourceEntityType: ENTITY,
    sourceEntityId:   dto.id,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { name: dto.name },
  });
  return dto;
}

export async function archiveTemplate(id: string, actorId: string): Promise<{ ok: true }> {
  const { data: prev, error: loadErr } = await sb
    .from('payroll_payslip_templates')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (loadErr) throw err('archiveTemplate/load: ' + loadErr.message, 500);
  if (!prev) throw err('Payslip template not found.', 404);
  const prevRow = prev as unknown as DbRow;
  if (prevRow.status !== 'approved') {
    throw err(`Cannot archive: template is in status '${prevRow.status}'. Only approved templates can be archived.`, 422);
  }

  const { error: rpcErr } = await sb.rpc('payroll_archive_template', {
    p_id: id, p_actor_id: actorId,
  });
  if (rpcErr) {
    if (rpcErr.message.includes('not found or not approved'))
      throw err('Payslip template not found or not approved.', 404);
    throw err('archiveTemplate: ' + rpcErr.message, 500);
  }

  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: id, actorId,
    action: 'payslip_template.archived',
    previousState: { name: prevRow.name, isDefault: prevRow.is_default, status: 'approved' },
  });
  await emitAppEvent({
    eventType:        'finance.payroll.payslip_template.archived',
    sourceModule:     SUBMODULE,
    sourceEntityType: ENTITY,
    sourceEntityId:   id,
    actorUserId:      actorId,
    severity:         'info',
    payload:          { name: prevRow.name },
  });
  return { ok: true };
}

// ── Notify template submitter ─────────────────────────────────────────────────
// Called by the adapter after an approval decision.

export async function notifyTemplateSubmitter(opts: {
  templateId: string;
  submittedBy: string | null;
  actorId: string;
  decision: 'approved' | 'changes_requested';
  name: string;
  comment?: string | null;
}): Promise<void> {
  if (!opts.submittedBy || opts.submittedBy === opts.actorId) return;
  const isApproved = opts.decision === 'approved';
  void notify({
    userId:     opts.submittedBy,
    type:       isApproved
                  ? 'finance.payroll.template.approved'
                  : 'finance.payroll.template.changes_requested',
    title:      isApproved
                  ? `Payslip template "${opts.name}" approved`
                  : `Changes requested on payslip template "${opts.name}"`,
    body:       isApproved
                  ? 'Your template has been approved and is now available for use.'
                  : (opts.comment ? `Reason: ${opts.comment}` : 'The reviewer has requested changes.'),
    module:     SUBMODULE,
    severity:   isApproved ? 'success' : 'warning',
    sourceType: ENTITY,
    sourceId:   opts.templateId,
  });
}

// ── Per-user editor state (autosave draft + open-ref) ───────────────────────────
// Private per-user scratch state that replaces the studio's browser localStorage.
// Not a business record: no events/audit (like a widget layout).

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
  if ('openRef'     in input) patch.open_ref     = input.openRef ?? null;

  const { error } = await sb
    .from('payroll_payslip_editor_state')
    .upsert(patch, { onConflict: 'user_id' });
  if (error) throw err('saveEditorState: ' + error.message, 500);
  return { ok: true };
}
