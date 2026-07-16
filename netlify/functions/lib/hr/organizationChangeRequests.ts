// lib/hr/organizationChangeRequests.ts — Phase B approval envelope for Org Structure.
//
// hr_org_change_requests is the ENVELOPE; the CENTRAL workflow engine owns the
// approval lifecycle (one binding per trigger event → hr_org_change_approval).
// The hr_org_structure adapter (lib/workflow/orgAdapter.ts) calls applyApprovedOrgChange
// on completion. Effective-dated changes become 'scheduled' and are applied by the
// service-role sweep applyDueOrgChanges. No second approval authority — decisions
// happen in the engine; this module only records + applies.

import { sb }           from '../db';
import { writeHrAudit } from './employeeCore';
import { httpError }    from './organizationCore';
import { rpcHttpError }          from '../workflow/service';
import { selectWorkflowBinding } from '../workflow/bindingResolver';
import { notifyUsersByRole }     from '../finance/financeEvents';
import { applyOrgUnitChange, applyOrgUnitDelete, applyPositionChange, applyCostCenterChange } from './organizationApply';
import type {
  OrgChangeRequest, OrgChangeRiskLevel, OrgEntityType, OrgChangeImpactSummary,
  OrgChangeListArgs, OrgMutationResult,
} from '../../../../types/hrOrganization';

type State = Record<string, unknown>;

export interface SubmitOrgChangeInput {
  entityType: OrgEntityType;
  entityId: string;
  action: string;
  riskLevel: OrgChangeRiskLevel;
  oldState: State;
  newState: State;
  impactSummary: OrgChangeImpactSummary;
  effectiveFrom?: string | null;
  reason?: string | null;
  /** Per-attempt idempotency key — required when a binding exists (atomic create-and-start). */
  idempotencyKey?: string;
}

function riskPriority(risk: OrgChangeRiskLevel): 'critical' | 'high' | 'normal' {
  return risk === 'critical' ? 'critical' : risk === 'high' ? 'high' : 'normal';
}

function nowISO(): string { return new Date().toISOString(); }

/**
 * Create the change-request envelope + start the approval workflow. Returns the
 * pendingApproval result when a workflow started; returns null when NO binding is
 * configured (the caller then applies directly — approval is opt-in via binding).
 */
export async function submitOrgChangeForApproval(actorId: string, input: SubmitOrgChangeInput): Promise<Extract<OrgMutationResult, { mode: 'pendingApproval' }> | null> {
  // Resolve the approval binding FIRST — no binding means approval is not enforced
  // for this trigger, so the caller applies the change directly (audited). Returning
  // null (without persisting anything) replaces the old insert-a-draft-then-delete
  // dance. When a binding exists, the envelope insert + workflow start + workflow_id
  // link + business event + hr_audit_log all commit in ONE transaction via
  // workflow_create_and_start_tx (hr_org_change_requests branch) — fixing the
  // insert -> startWorkflowForRecord -> update/compensating-delete strand.
  const binding = await selectWorkflowBinding(sb, {
    moduleKey: 'hr_org_structure', workflowType: 'hr_org_change_approval',
    triggerEvent: `hr.org.${input.entityType}.${input.action}`,
    sourceRecordId: '', requestedBy: actorId, priority: riskPriority(input.riskLevel), recordData: {},
  });
  if (!binding) return null;

  const requestKey = input.idempotencyKey?.trim();
  if (!requestKey) throw httpError(400, 'An idempotency key is required to submit an org change for approval.');

  const { data, error } = await sb.rpc('workflow_create_and_start_tx', {
    p_source_table: 'hr_org_change_requests', p_actor_id: actorId,
    p_binding_id: binding.id, p_request_key: requestKey,
    p_business: {
      entityType: input.entityType, entityId: input.entityId, action: input.action,
      riskLevel: input.riskLevel, oldState: input.oldState, newState: input.newState,
      impactSummary: input.impactSummary, effectiveFrom: input.effectiveFrom ?? null,
      reason: input.reason ?? null, priority: riskPriority(input.riskLevel),
    },
  });
  if (error) throw rpcHttpError(error as { code?: string | null; message: string });
  const rpc = (data ?? {}) as { recordId?: string; ref?: string; workflowId?: string };

  // First step routes to the hr_manager role — notify them post-commit so the approval
  // is actioned (replaces the fan-out startWorkflowForRecord.notifyTaskAssigned did).
  void notifyUsersByRole('hr_manager', {
    type: 'org.change.requested',
    title: `Org change ${rpc.ref ?? ''} awaiting your approval`.trim(),
    body: `A ${input.riskLevel}-risk ${input.entityType} ${input.action} change needs approval.`,
    module: 'hr', severity: input.riskLevel === 'critical' ? 'warning' : 'info',
    sourceType: 'org_change_request', sourceId: rpc.recordId ?? '', actionRequired: true,
    dedupeKey: `org.change.requested.${rpc.recordId}`,
  });

  return { mode: 'pendingApproval', changeRequestId: rpc.recordId ?? '', changeNo: rpc.ref ?? '', workflowId: rpc.workflowId ?? '', riskLevel: input.riskLevel, impactSummary: input.impactSummary };
}

interface CrRow {
  id: string; entity_type: OrgEntityType; entity_id: string; action: string; status: string;
  effective_from: string; old_state: State; new_state: State;
}

/** Apply the stored change to its target table (no gate — the approval already happened). */
async function dispatchApply(cr: CrRow, actorId: string): Promise<void> {
  if (cr.entity_type === 'org_unit') {
    if (cr.action === 'delete') { await applyOrgUnitDelete(actorId, cr.entity_id, cr.old_state, cr.id); return; }
    await applyOrgUnitChange(actorId, cr.entity_id, cr.action as 'update' | 'move' | 'archive', cr.new_state, cr.old_state, cr.id);
    return;
  }
  if (cr.entity_type === 'position') { await applyPositionChange(actorId, cr.entity_id, cr.action as 'update' | 'retire', cr.new_state, cr.old_state, cr.id); return; }
  await applyCostCenterChange(actorId, cr.entity_id, cr.action as 'update' | 'retire', cr.new_state, cr.old_state, cr.id);
}

/**
 * Called by the hr_org_structure adapter on workflow completion (approval). If the
 * change is effective-dated in the future it becomes 'scheduled'; otherwise it is
 * applied now. A failed apply marks the request 'failed' (never silently swallowed).
 */
export async function applyApprovedOrgChange(changeRequestId: string, approverId: string | null): Promise<void> {
  const { data: cr } = await sb.from('hr_org_change_requests')
    .select('id, entity_type, entity_id, action, status, effective_from, old_state, new_state')
    .eq('id', changeRequestId).maybeSingle<CrRow>();
  if (!cr) return;
  if (!['pending_approval', 'approved', 'scheduled'].includes(cr.status)) return;   // cancelled/applied/etc → no-op

  const decided = { decided_by: approverId, decided_at: nowISO(), updated_at: nowISO() };
  if (new Date(cr.effective_from).getTime() > Date.now()) {
    await sb.from('hr_org_change_requests').update({ status: 'scheduled', ...decided }).eq('id', cr.id);
    return;
  }
  try {
    await dispatchApply(cr, approverId ?? cr.entity_id);
    await sb.from('hr_org_change_requests').update({ status: 'applied', applied_by: approverId, applied_at: nowISO(), ...decided }).eq('id', cr.id);
  } catch (e) {
    // The source mutation FAILED. This runs inside the workflow-completion adapter, so we
    // MUST rethrow — swallowing here lets the workflow finalize as `completed` while the
    // change request was never applied (finding #2). Rethrowing fails the outbox
    // transition → retry with backoff → dead-letter, and the workflow stays gated (never
    // falsely completed). Do NOT flip the CR to a terminal `status='failed'`: the status
    // guard above would then early-return on the next retry and hand the adapter a false
    // success. Leave it re-attemptable; record the last error for diagnostics only.
    await sb.from('hr_org_change_requests').update({ rejection_reason: e instanceof Error ? e.message : 'Apply failed', updated_at: nowISO() }).eq('id', cr.id);
    console.error('[org] applyApprovedOrgChange failed — rethrowing to gate the workflow', { changeRequestId, error: e instanceof Error ? e.message : e });
    throw e;
  }
}

/** Service-role sweep: apply every scheduled change whose effective_from has passed. */
export async function applyDueOrgChanges(actorId: string): Promise<{ applied: number; failed: number }> {
  const { data } = await sb.from('hr_org_change_requests')
    .select('id, entity_type, entity_id, action, status, effective_from, old_state, new_state')
    .eq('status', 'scheduled').lte('effective_from', nowISO());
  const rows = (data ?? []) as CrRow[];
  let applied = 0, failed = 0;
  for (const cr of rows) {
    try { await dispatchApply(cr, actorId); await sb.from('hr_org_change_requests').update({ status: 'applied', applied_by: actorId, applied_at: nowISO(), updated_at: nowISO() }).eq('id', cr.id); applied++; }
    catch (e) { await sb.from('hr_org_change_requests').update({ status: 'failed', rejection_reason: e instanceof Error ? e.message : 'Apply failed', updated_at: nowISO() }).eq('id', cr.id); failed++; }
  }
  return { applied, failed };
}

/** Raw status setter used by the workflow adapter (returned / rejected / cancelled). */
export async function setOrgChangeStatus(changeRequestId: string, status: string, opts: { decidedBy?: string | null; comment?: string | null } = {}): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: nowISO() };
  if (opts.decidedBy !== undefined) { patch['decided_by'] = opts.decidedBy; patch['decided_at'] = nowISO(); }
  if (opts.comment !== undefined) patch['rejection_reason'] = opts.comment;
  await sb.from('hr_org_change_requests').update(patch).eq('id', changeRequestId);
}

export async function cancelOrgChangeRequest(actorId: string, args: { changeRequestId: string; reason?: string | null }): Promise<{ id: string }> {
  const { data: cr } = await sb.from('hr_org_change_requests').select('status, requested_by').eq('id', args.changeRequestId).maybeSingle<{ status: string; requested_by: string | null }>();
  if (!cr) throw httpError(404, 'Change request not found.');
  // No 'draft': change requests are now persisted directly as pending_approval by the
  // atomic create-and-start RPC (the old insert-a-draft-then-promote path is gone).
  if (!['pending_approval', 'scheduled', 'approved'].includes(cr.status)) throw httpError(400, `Cannot cancel a ${cr.status} change request.`);
  await sb.from('hr_org_change_requests').update({ status: 'cancelled', rejection_reason: args.reason ?? null, updated_at: nowISO() }).eq('id', args.changeRequestId);
  await writeHrAudit({ submoduleKey: 'organization', recordId: args.changeRequestId, actorId, action: 'hr.org_change.cancelled', reason: args.reason ?? null });
  return { id: args.changeRequestId };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

async function nameMap(ids: Array<string | null>): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!uniq.length) return new Map();
  const { data } = await sb.from('app_users').select('id, full_name').in('id', uniq);
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name ?? u.id]));
}

interface CrFullRow {
  id: string; change_no: string | null; entity_type: OrgEntityType; entity_id: string | null; action: string;
  risk_level: OrgChangeRiskLevel; status: OrgChangeRequest['status']; effective_from: string; effective_to: string | null;
  reason: string | null; rejection_reason: string | null; old_state: State; new_state: State; impact_summary: State;
  workflow_id: string | null; requested_by: string | null; decided_by: string | null; applied_by: string | null;
  requested_at: string; decided_at: string | null; applied_at: string | null;
}

function mapCr(r: CrFullRow, names: Map<string, string>): OrgChangeRequest {
  return {
    id: r.id, changeNo: r.change_no, entityType: r.entity_type, entityId: r.entity_id, entityName: (r.new_state['name'] as string) ?? (r.old_state['name'] as string) ?? null,
    action: r.action, riskLevel: r.risk_level, status: r.status,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to, reason: r.reason, rejectionReason: r.rejection_reason,
    oldState: r.old_state, newState: r.new_state, impactSummary: r.impact_summary as Partial<OrgChangeImpactSummary>,
    workflowId: r.workflow_id,
    requestedBy: r.requested_by, requestedByName: r.requested_by ? (names.get(r.requested_by) ?? null) : null,
    decidedBy: r.decided_by, decidedByName: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
    appliedBy: r.applied_by, appliedByName: r.applied_by ? (names.get(r.applied_by) ?? null) : null,
    requestedAt: r.requested_at, decidedAt: r.decided_at, appliedAt: r.applied_at,
  };
}

export async function listOrgChangeRequests(args: OrgChangeListArgs = {}): Promise<OrgChangeRequest[]> {
  let q = sb.from('hr_org_change_requests').select('*').order('requested_at', { ascending: false }).limit(args.limit ?? 200);
  if (args.status && args.status !== 'all') q = q.eq('status', args.status);
  if (args.entityType) q = q.eq('entity_type', args.entityType);
  const { data } = await q;
  const rows = (data ?? []) as CrFullRow[];
  const names = await nameMap(rows.flatMap(r => [r.requested_by, r.decided_by, r.applied_by]));
  return rows.map(r => mapCr(r, names));
}

export async function getOrgChangeRequest(changeRequestId: string): Promise<OrgChangeRequest | null> {
  const { data } = await sb.from('hr_org_change_requests').select('*').eq('id', changeRequestId).maybeSingle<CrFullRow>();
  if (!data) return null;
  const names = await nameMap([data.requested_by, data.decided_by, data.applied_by]);
  return mapCr(data, names);
}
