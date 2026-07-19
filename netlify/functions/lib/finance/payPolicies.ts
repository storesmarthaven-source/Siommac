import { createHash } from 'node:crypto';
import { sb } from '../db';
import { decideTask, rpcHttpError } from '../workflow/service';
import type { AppUser } from '../../../../types/db';
import type {
  PayPolicyDraftInput, PayPolicyPreflight, PayPolicySummary, PayPolicyVersionDto, PayPolicyWorkspace,
} from '../../../../types/payrollPayPolicies';

type Row = Record<string, unknown>;
const asText = (v: unknown): string => String(v ?? '');
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function versionDto(r: Row): PayPolicyVersionDto {
  return {
    id: asText(r.id), policyId: asText(r.policy_id), versionNo: Number(r.version_no),
    status: r.status as PayPolicyVersionDto['status'], effectiveFrom: asText(r.effective_from),
    effectiveTo: r.effective_to ? asText(r.effective_to) : null, changeSummary: asText(r.change_summary),
    timezone: 'America/Port_of_Spain', dayBoundary: r.day_boundary as PayPolicyVersionDto['dayBoundary'],
    statutoryBinding: 'approved_by_pay_date', currency: 'TTD', paymentDestination: 'primary_bank_account',
    missingBankOutcome: 'block_release', workflowId: r.workflow_id ? asText(r.workflow_id) : null,
    checksum: r.canonical_checksum ? asText(r.canonical_checksum) : null, lockVersion: Number(r.lock_version),
    preparedBy: asText(r.prepared_by), submittedBy: r.submitted_by ? asText(r.submitted_by) : null,
    approvedBy: r.approved_by ? asText(r.approved_by) : null, activatedBy: r.activated_by ? asText(r.activated_by) : null,
    createdAt: asText(r.created_at), updatedAt: asText(r.updated_at),
  };
}

function policySummary(
  policy: Row,
  versions: Row[],
  activeAssignmentCount: number,
): PayPolicySummary {
  const current = versions.find(v => ['active', 'pending_approval', 'approved', 'draft'].includes(asText(v.status))) ?? versions[0];
  return {
    id: asText(policy.id), code: asText(policy.code), name: asText(policy.name), description: asText(policy.description),
    policyType: policy.policy_type as PayPolicySummary['policyType'],
    workforceType: policy.workforce_type as PayPolicySummary['workforceType'],
    status: policy.status as PayPolicySummary['status'], ownerId: policy.owner_id ? asText(policy.owner_id) : null,
    currentVersion: current ? {
      id: asText(current.id), versionNo: Number(current.version_no), status: current.status as PayPolicyVersionDto['status'],
      effectiveFrom: asText(current.effective_from), effectiveTo: current.effective_to ? asText(current.effective_to) : null,
      checksum: current.canonical_checksum ? asText(current.canonical_checksum) : null,
    } : null,
    versionCount: versions.length, assignmentCount: activeAssignmentCount, updatedAt: asText(policy.updated_at),
  };
}

function rpcError(prefix: string, error: { code?: string | null; message: string }): never {
  const e = rpcHttpError(error);
  e.message = `${prefix}: ${e.message}`;
  throw e;
}

function dbPayload(input: PayPolicyDraftInput, expectedLockVersion?: number): Record<string, unknown> {
  return {
    code: input.code, name: input.name, description: input.description, policyType: input.policyType,
    ownerId: input.ownerId ?? '', effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? '',
    changeSummary: input.changeSummary, dayBoundary: input.dayBoundary, ...(expectedLockVersion == null ? {} : { expectedLockVersion }),
    components: input.components.map(x => ({
      component_id: x.componentId, calculation_basis: x.calculationBasis, rate_source: x.rateSource,
      eligibility_source: x.eligibilitySource, rule_parameters: x.ruleParameters, is_required: x.required, sort_order: x.sortOrder,
    })),
    sourceRules: input.sourceRules.map(x => ({
      source_type: x.sourceType, owner_role: x.ownerRole, required: x.required,
      reconciliation_key: x.reconciliationKey, late_input_policy: x.lateInputPolicy,
      conflict_severity: x.conflictSeverity, conflict_outcome: x.conflictOutcome,
    })),
  };
}

export async function listPayPolicies(input: { search?: string; status?: string; limit: number; offset: number }): Promise<{
  items: PayPolicySummary[]; total: number; nextCursor: string | null;
}> {
  let q = sb.from('finance_pay_policies').select('*', { count: 'exact' })
    .order('updated_at', { ascending: false }).order('id', { ascending: false })
    .range(input.offset, input.offset + input.limit - 1);
  if (input.status) q = q.eq('status', input.status);
  if (input.search) {
    const term = input.search.replace(/[%_,().]/g, '').trim();
    q = q.or(`code.ilike.%${term}%,name.ilike.%${term}%`);
  }
  const { data, error, count } = await q;
  if (error) throw Object.assign(new Error(`listPayPolicies: ${error.message}`), { status: 500 });
  const rows = (data ?? []) as Row[];
  const ids = rows.map(r => asText(r.id));
  const [versions, assignments] = ids.length ? await Promise.all([
    sb.from('finance_pay_policy_versions').select('*').in('policy_id', ids).order('version_no', { ascending: false }),
    sb.from('finance_pay_group_policy_assignments').select('policy_id,status').in('policy_id', ids).eq('status', 'active'),
  ]) : [{ data: [] }, { data: [] }];
  const byPolicy = new Map<string, Row[]>();
  for (const r of (versions.data ?? []) as Row[]) byPolicy.set(asText(r.policy_id), [...(byPolicy.get(asText(r.policy_id)) ?? []), r]);
  const assignmentCounts = new Map<string, number>();
  for (const r of (assignments.data ?? []) as Row[]) assignmentCounts.set(asText(r.policy_id), (assignmentCounts.get(asText(r.policy_id)) ?? 0) + 1);
  if ('error' in versions && versions.error) throw Object.assign(new Error(`listPayPolicies versions: ${versions.error.message}`), { status: 500 });
  if ('error' in assignments && assignments.error) throw Object.assign(new Error(`listPayPolicies assignments: ${assignments.error.message}`), { status: 500 });
  const items = rows.map(r => policySummary(r, byPolicy.get(asText(r.id)) ?? [], assignmentCounts.get(asText(r.id)) ?? 0));
  const total = count ?? items.length;
  const next = input.offset + items.length < total ? Buffer.from(String(input.offset + items.length)).toString('base64url') : null;
  return { items, total, nextCursor: next };
}

export function decodePolicyCursor(cursor?: string): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error('Invalid policy cursor.'), { status: 422 });
  return n;
}

export async function getPayPolicy(policyId: string, requestedVersionId?: string): Promise<PayPolicyWorkspace | null> {
  const { data: policy, error } = await sb.from('finance_pay_policies').select('*').eq('id', policyId).maybeSingle<Row>();
  if (error) throw Object.assign(new Error(`getPayPolicy: ${error.message}`), { status: 500 });
  if (!policy) return null;
  const [vr, ar, ev] = await Promise.all([
    sb.from('finance_pay_policy_versions').select('*').eq('policy_id', policyId).order('version_no', { ascending: false }).limit(100),
    sb.from('finance_pay_group_policy_assignments').select('*').eq('policy_id', policyId).order('effective_from', { ascending: false }).limit(100),
    sb.from('app_events').select('id,event_type,actor_user_id,created_at,payload').eq('source_module', 'finance_pay_policy')
      .or(`source_entity_id.eq.${policyId},payload->>policyId.eq.${policyId}`).order('created_at', { ascending: false }).limit(100),
  ]);
  for (const [label, result] of [['versions', vr], ['assignments', ar], ['audit', ev]] as const) {
    if (result.error) throw Object.assign(new Error(`getPayPolicy ${label}: ${result.error.message}`), { status: 500 });
  }
  const versions = ((vr.data ?? []) as Row[]).map(versionDto);
  const selected = requestedVersionId ? versions.find(v => v.id === requestedVersionId) : versions[0];
  const [componentsResult, sourcesResult] = selected ? await Promise.all([
      sb.from('finance_pay_policy_components').select('*,finance_pay_components!component_id(code,name,kind)').eq('policy_version_id', selected.id),
      sb.from('finance_pay_policy_source_rules').select('*').eq('policy_version_id', selected.id),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (componentsResult.error) throw Object.assign(new Error(`getPayPolicy components: ${componentsResult.error.message}`), { status: 500 });
  if (sourcesResult.error) throw Object.assign(new Error(`getPayPolicy sources: ${sourcesResult.error.message}`), { status: 500 });
  if (requestedVersionId && !selected) {
    return null;
  }
  const assignments = (ar.data ?? []) as Row[];
  const groupIds = [...new Set(assignments.map(a => asText(a.pay_group_id)))];
  const [groupRes, memberRes] = groupIds.length ? await Promise.all([
    sb.from('finance_pay_groups').select('id,code,name,frequency').in('id', groupIds),
    sb.from('finance_employee_pay_group_assignments').select('pay_group_id,effective_from,effective_to').in('pay_group_id', groupIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (groupRes.error) throw Object.assign(new Error(`getPayPolicy pay groups: ${groupRes.error.message}`), { status: 500 });
  if (memberRes.error) throw Object.assign(new Error(`getPayPolicy pay-group members: ${memberRes.error.message}`), { status: 500 });
  const groups = new Map(((groupRes.data ?? []) as Row[]).map(g => [asText(g.id), g]));
  const today = new Date().toISOString().slice(0, 10);
  const memberCounts = new Map<string, number>();
  for (const membership of (memberRes.data ?? []) as Row[]) {
    if (asText(membership.effective_from) > today) continue;
    if (membership.effective_to && asText(membership.effective_to) < today) continue;
    const groupId = asText(membership.pay_group_id);
    memberCounts.set(groupId, (memberCounts.get(groupId) ?? 0) + 1);
  }
  const versionRows = (vr.data ?? []) as Row[];
  const activeAssignmentCount = assignments.filter(a => asText(a.status) === 'active').length;
  const summary = policySummary(policy, versionRows, activeAssignmentCount);
  return {
    policy: summary, version: selected ?? null,
    components: ((componentsResult.data ?? []) as Row[]).map(r => {
      const c = (r.finance_pay_components ?? {}) as Row;
      return {
        id: asText(r.id), componentId: asText(r.component_id), componentCode: asText(c.code),
        componentName: asText(c.name), componentKind: c.kind as 'earning' | 'deduction',
        calculationBasis: r.calculation_basis as never, rateSource: r.rate_source as never,
        eligibilitySource: r.eligibility_source as never, ruleParameters: (r.rule_parameters ?? {}) as never,
        required: Boolean(r.is_required), sortOrder: Number(r.sort_order),
      };
    }),
    sourceRules: ((sourcesResult.data ?? []) as Row[]).map(r => ({
      id: asText(r.id), sourceType: r.source_type as never, ownerRole: r.owner_role as never,
      required: Boolean(r.required), reconciliationKey: r.reconciliation_key as never,
      lateInputPolicy: r.late_input_policy as never, conflictSeverity: r.conflict_severity as never,
      conflictOutcome: r.conflict_outcome as never,
    })),
    versions,
    assignments: assignments.map(a => {
      const g = groups.get(asText(a.pay_group_id)) ?? {};
      const vv = versions.find(v => v.id === asText(a.policy_version_id));
      return {
        id: asText(a.id), payGroupId: asText(a.pay_group_id), payGroupCode: asText(g.code),
        payGroupName: asText(g.name), frequency: asText(g.frequency), memberCount: memberCounts.get(asText(a.pay_group_id)) ?? 0,
        versionId: asText(a.policy_version_id), versionNo: vv?.versionNo ?? 0,
        effectiveFrom: asText(a.effective_from), effectiveTo: a.effective_to ? asText(a.effective_to) : null,
        status: a.status as 'active' | 'ended',
      };
    }),
    audit: ((ev.data ?? []) as Row[]).map(e => ({
      id: asText(e.id), type: asText(e.event_type), actorId: e.actor_user_id ? asText(e.actor_user_id) : null,
      occurredAt: asText(e.created_at), payload: (e.payload ?? {}) as Record<string, unknown>,
    })),
  };
}

async function draftRpc(command: 'create' | 'update', input: PayPolicyDraftInput, actorId: string, requestKey: string, ids?: {
  policyId: string; versionId: string; expectedLockVersion: number;
}): Promise<{ policyId: string; versionId: string; lockVersion: number; status: 'draft' }> {
  const payload = dbPayload(input, ids?.expectedLockVersion);
  const { data, error } = await sb.rpc('finance_pay_policy_draft_command_tx', {
    p_command: command, p_policy_id: ids?.policyId ?? null, p_version_id: ids?.versionId ?? null,
    p_actor_id: actorId, p_request_key: requestKey, p_input_hash: hash({ command, ...payload }), p_payload: payload,
  });
  if (error) rpcError('pay policy draft', error);
  return data as never;
}

export const createPayPolicyDraft = (input: PayPolicyDraftInput, actorId: string, requestKey: string) =>
  draftRpc('create', input, actorId, requestKey);
export const updatePayPolicyDraft = (ids: { policyId: string; versionId: string; expectedLockVersion: number },
  input: PayPolicyDraftInput, actorId: string, requestKey: string) => draftRpc('update', input, actorId, requestKey, ids);

export async function copyPayPolicyVersion(args: {
  policyId: string; sourceVersionId: string; effectiveFrom: string; changeSummary: string; actorId: string; requestKey: string;
}) {
  const { data, error } = await sb.rpc('finance_pay_policy_copy_version_tx', {
    p_policy_id: args.policyId, p_source_version_id: args.sourceVersionId, p_effective_from: args.effectiveFrom,
    p_change_summary: args.changeSummary, p_actor_id: args.actorId, p_request_key: args.requestKey,
    p_input_hash: hash({
      policyId: args.policyId, sourceVersionId: args.sourceVersionId,
      effectiveFrom: args.effectiveFrom, changeSummary: args.changeSummary,
    }),
  });
  if (error) rpcError('pay policy copy version', error);
  return data;
}

export async function preflightPayPolicy(versionId: string): Promise<PayPolicyPreflight> {
  const { data, error } = await sb.rpc('finance_pay_policy_preflight', { p_version_id: versionId });
  if (error) rpcError('pay policy preflight', error);
  return data as PayPolicyPreflight;
}

export async function submitPayPolicy(versionId: string, certifications: Record<string, boolean>, actorId: string, requestKey: string) {
  const { data, error } = await sb.rpc('finance_pay_policy_submit_tx', {
    p_version_id: versionId, p_actor_id: actorId, p_request_key: requestKey,
    p_input_hash: hash({ versionId, certifications }), p_certifications: certifications,
  });
  if (error) rpcError('pay policy submit', error);
  return data;
}

async function admin(command: 'activate' | 'assign' | 'end_assignment' | 'retire', args: {
  policyId: string; versionId?: string; payload?: Record<string, unknown>; actorId: string; requestKey: string;
}) {
  const payload = args.payload ?? {};
  const { data, error } = await sb.rpc('finance_pay_policy_admin_command_tx', {
    p_command: command, p_policy_id: args.policyId, p_version_id: args.versionId ?? null,
    p_actor_id: args.actorId, p_request_key: args.requestKey,
    p_input_hash: hash({ command, policyId: args.policyId, versionId: args.versionId, payload }), p_payload: payload,
  });
  if (error) rpcError(`pay policy ${command}`, error);
  return data;
}

export const activatePayPolicy = (a: { policyId: string; versionId: string; actorId: string; requestKey: string }) => admin('activate', a);
export const assignPayPolicy = (a: { policyId: string; versionId: string; payGroupId: string; effectiveFrom: string; effectiveTo?: string | null; actorId: string; requestKey: string }) =>
  admin('assign', { ...a, payload: { payGroupId: a.payGroupId, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo ?? '' } });
export const endPayPolicyAssignment = (a: { policyId: string; assignmentId: string; effectiveTo: string; reason: string; actorId: string; requestKey: string }) =>
  admin('end_assignment', { ...a, payload: { assignmentId: a.assignmentId, effectiveTo: a.effectiveTo, reason: a.reason } });
export const retirePayPolicy = (a: { policyId: string; effectiveTo: string; reason: string; actorId: string; requestKey: string }) =>
  admin('retire', { ...a, payload: { effectiveTo: a.effectiveTo, reason: a.reason } });

export async function rejectPayPolicyReview(a: { workflowId: string; taskId: string; reason: string; actor: AppUser }) {
  return decideTask({ workflowId: a.workflowId, taskId: a.taskId, actor: a.actor, decision: 'rejected', comment: a.reason });
}

export async function comparePayPolicyVersions(policyId: string, fromVersionId: string, toVersionId: string) {
  const [fromWorkspace, toWorkspace] = await Promise.all([
    getPayPolicy(policyId, fromVersionId),
    getPayPolicy(policyId, toVersionId),
  ]);
  const from = fromWorkspace?.version;
  const to = toWorkspace?.version;
  if (!from || !to) throw Object.assign(new Error('Both versions must belong to the policy.'), { status: 422 });
  const fields = ['effectiveFrom', 'effectiveTo', 'changeSummary', 'dayBoundary', 'checksum'] as const;
  const changes: Array<{ field: string; from: unknown; to: unknown }> =
    fields.filter(k => from[k] !== to[k]).map(k => ({ field: k, from: from[k], to: to[k] }));
  const canonicalComponents = (workspace: PayPolicyWorkspace) => workspace.components.map(component => ({
    componentId: component.componentId, calculationBasis: component.calculationBasis, rateSource: component.rateSource,
    eligibilitySource: component.eligibilitySource, ruleParameters: component.ruleParameters,
    required: component.required, sortOrder: component.sortOrder,
  })).sort((a, b) => a.sortOrder - b.sortOrder || a.componentId.localeCompare(b.componentId));
  const canonicalSources = (workspace: PayPolicyWorkspace) => workspace.sourceRules.map(source => ({
    sourceType: source.sourceType, ownerRole: source.ownerRole, required: source.required,
    reconciliationKey: source.reconciliationKey, lateInputPolicy: source.lateInputPolicy,
    conflictSeverity: source.conflictSeverity, conflictOutcome: source.conflictOutcome,
  })).sort((a, b) => a.sourceType.localeCompare(b.sourceType));
  const fromComponents = canonicalComponents(fromWorkspace);
  const toComponents = canonicalComponents(toWorkspace);
  const fromSources = canonicalSources(fromWorkspace);
  const toSources = canonicalSources(toWorkspace);
  if (JSON.stringify(fromComponents) !== JSON.stringify(toComponents)) {
    changes.push({ field: 'components', from: fromComponents, to: toComponents });
  }
  if (JSON.stringify(fromSources) !== JSON.stringify(toSources)) {
    changes.push({ field: 'sourceRules', from: fromSources, to: toSources });
  }
  return { policyId, fromVersionId, toVersionId, changes };
}
