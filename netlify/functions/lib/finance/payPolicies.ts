import { createHash } from 'node:crypto';
import { sb } from '../db';
import { decideTask, rpcHttpError } from '../workflow/service';
import type { AppUser } from '../../../../types/db';
import type {
  PayPolicyDraftInput, PayPolicyOverview, PayPolicyPreflight, PayPolicySummary,
  PayPolicyVersionDto, PayPolicyWorkspace,
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

const POLICY_TYPE_LABEL: Record<string, string> = {
  standard_salary: 'Standard salaried', hourly_shift: 'Hourly / shift',
  offshore_rotation: 'Offshore rotation', marine_voyage: 'Marine / voyage',
};
const IN_REVIEW = new Set(['draft', 'pending_approval', 'approved']);
const OVERVIEW_PREFLIGHT_CAP = 50;

const humanizeEvent = (eventType: string): string =>
  eventType.replace(/^finance\.payroll\.policy\./, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function eventTone(eventType: string): 'blue' | 'amber' | 'green' | 'red' {
  if (/activated|assigned/.test(eventType)) return 'green';
  if (/retired|assignment_ended|reject/.test(eventType)) return 'red';
  if (/submitted|pending/.test(eventType)) return 'amber';
  return 'blue';
}

// Command-center read model behind the Pay Policies dashboard. Every figure is derived
// from the live policy / version / assignment / member / event tables plus real preflight
// over the in-review versions — never static or faked (No-Band-Aids).
export async function getPayPolicyOverview(): Promise<PayPolicyOverview> {
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${today.slice(0, 4)}-01-01`;

  const [polRes, verRes, asgRes] = await Promise.all([
    sb.from('finance_pay_policies').select('*'),
    sb.from('finance_pay_policy_versions').select('*').order('version_no', { ascending: false }),
    sb.from('finance_pay_group_policy_assignments').select('policy_id,pay_group_id,status').eq('status', 'active'),
  ]);
  for (const [label, r] of [['policies', polRes], ['versions', verRes], ['assignments', asgRes]] as const) {
    if (r.error) throw Object.assign(new Error(`getPayPolicyOverview ${label}: ${r.error.message}`), { status: 500 });
  }
  const policies = (polRes.data ?? []) as Row[];
  const versions = (verRes.data ?? []) as Row[];
  const assignments = (asgRes.data ?? []) as Row[];
  const policyById = new Map(policies.map(p => [asText(p.id), p]));
  const versionsByPolicy = new Map<string, Row[]>();
  for (const v of versions) versionsByPolicy.set(asText(v.policy_id), [...(versionsByPolicy.get(asText(v.policy_id)) ?? []), v]);

  // Covered / assigned employees = distinct active members of pay groups with an active policy assignment.
  const activeGroupIds = [...new Set(assignments.map(a => asText(a.pay_group_id)))];
  const memRes = activeGroupIds.length
    ? await sb.from('finance_employee_pay_group_assignments').select('pay_group_id,employee_id,effective_from,effective_to').in('pay_group_id', activeGroupIds)
    : { data: [], error: null };
  if (memRes.error) throw Object.assign(new Error(`getPayPolicyOverview members: ${memRes.error.message}`), { status: 500 });
  const coveredEmployeeIds = new Set<string>();
  for (const m of (memRes.data ?? []) as Row[]) {
    if (asText(m.effective_from) > today) continue;
    if (m.effective_to && asText(m.effective_to) < today) continue;
    coveredEmployeeIds.add(asText(m.employee_id));
  }
  const coveredEmployees = coveredEmployeeIds.size;

  const activePolicies = policies.filter(p => asText(p.status) === 'active');
  const nonRetired = policies.filter(p => asText(p.status) !== 'retired');
  const workPatternLabels = [...new Set(activePolicies.map(p => POLICY_TYPE_LABEL[asText(p.policy_type)] ?? asText(p.policy_type)))];

  // Current active version of each active policy — used for scheduled-retirement detection.
  const currentActiveVersion = (policyId: string): Row | undefined =>
    (versionsByPolicy.get(policyId) ?? []).find(v => asText(v.status) === 'active');
  const retiringPolicies = activePolicies.filter(p => {
    const cur = currentActiveVersion(asText(p.id));
    return cur?.effective_to && asText(cur.effective_to) >= today;
  });

  // In-review versions drive the integrity panel + activation banner via real preflight.
  const inReview = versions.filter(v => IN_REVIEW.has(asText(v.status)));
  const pendingVersions = versions.filter(v => ['pending_approval', 'approved'].includes(asText(v.status))).length;
  const versionsThisYear = versions.filter(v => asText(v.created_at).slice(0, 10) >= yearStart).length;

  const preflights = (await Promise.all(inReview.slice(0, OVERVIEW_PREFLIGHT_CAP).map(async v => {
    try { return { version: v, pf: await preflightPayPolicy(asText(v.id)) }; }
    catch { return null; }
  }))).filter((x): x is { version: Row; pf: PayPolicyPreflight } => x !== null);

  const totalBlockers = preflights.reduce((s, x) => s + x.pf.blockers.length, 0);
  const blockedVersions = preflights.filter(x => x.pf.blockers.length > 0);
  const hasBlockerCode = (pf: PayPolicyPreflight, prefix: string): boolean => pf.blockers.some(b => b.code.startsWith(prefix));
  const versionsWith = (prefixes: string[]): number =>
    preflights.filter(x => prefixes.some(p => hasBlockerCode(x.pf, p))).length;
  const integrityRow = (code: string, label: string, prefixes: string[]): PayPolicyOverview['integrity'][number] => {
    if (!preflights.length) return { code, label, value: 'No pending versions', tone: 'ok' };
    const affected = versionsWith(prefixes);
    return affected === 0
      ? { code, label, value: `${preflights.length} of ${preflights.length} valid`, tone: 'ok' }
      : { code, label, value: `${affected} need attention`, tone: 'danger' };
  };
  const integrity: PayPolicyOverview['integrity'] = [
    integrityRow('components', 'Component bindings', ['component.', 'components.', 'earnings.']),
    integrityRow('statutory', 'Statutory mappings', ['statutory.', 'source.statutory_profile']),
    integrityRow('sources', 'Source ownership', ['source.payment_destination', 'source.approved_time']),
    integrityRow('costing', 'Cost & GL dimensions', ['costing.']),
  ];

  // Activation banner: the first in-review version that cannot activate.
  const owners = [...new Set(policies.map(p => asText(p.owner_id)).filter(Boolean))];
  const actorIds = new Set<string>();
  // Recent cross-policy activity feed.
  const evRes = policies.length
    ? await sb.from('app_events').select('id,event_type,actor_user_id,created_at,payload')
        .eq('source_module', 'finance_pay_policy').order('created_at', { ascending: false }).limit(12)
    : { data: [], error: null };
  if (evRes.error) throw Object.assign(new Error(`getPayPolicyOverview events: ${evRes.error.message}`), { status: 500 });
  for (const e of (evRes.data ?? []) as Row[]) if (e.actor_user_id) actorIds.add(asText(e.actor_user_id));
  const nameIds = [...new Set([...owners, ...actorIds])];
  const nameRes = nameIds.length ? await sb.from('app_users').select('id,full_name,username').in('id', nameIds) : { data: [], error: null };
  if (nameRes.error) throw Object.assign(new Error(`getPayPolicyOverview names: ${nameRes.error.message}`), { status: 500 });
  const nameOf = new Map(((nameRes.data ?? []) as Row[]).map(u => [asText(u.id), asText(u.full_name) || asText(u.username) || asText(u.id)]));

  let banner: PayPolicyOverview['banner'] = null;
  const firstBlocked = blockedVersions[0];
  if (firstBlocked) {
    const p = policyById.get(asText(firstBlocked.version.policy_id));
    const firstBlocker = firstBlocked.pf.blockers[0];
    banner = {
      policyId: asText(firstBlocked.version.policy_id),
      policyCode: asText(p?.code), policyName: asText(p?.name),
      versionId: asText(firstBlocked.version.id), versionNo: Number(firstBlocked.version.version_no),
      ownerLabel: (p && asText(p.owner_id) && nameOf.get(asText(p.owner_id))) || 'Unassigned',
      title: `${asText(p?.name)} v${Number(firstBlocked.version.version_no)} cannot activate`,
      detail: firstBlocker?.message ?? 'Configuration blockers must be resolved before activation.',
    };
  }

  // Upcoming changes: future-effective in-review versions + scheduled retirements.
  const upcoming: PayPolicyOverview['upcoming'] = [];
  for (const v of inReview) {
    const p = policyById.get(asText(v.policy_id));
    const status = asText(v.status);
    const eff = asText(v.effective_from);
    upcoming.push({
      policyId: asText(v.policy_id),
      tone: status === 'draft' ? 'blue' : 'amber',
      title: `${asText(p?.name)} v${Number(v.version_no)}`,
      detail: asText(v.change_summary) || (status === 'draft' ? 'Draft in preparation.' : 'Awaiting approval.'),
      meta: eff >= today ? eff : status === 'draft' ? 'Draft' : 'Review',
    });
  }
  for (const p of retiringPolicies) {
    const cur = currentActiveVersion(asText(p.id));
    upcoming.push({
      policyId: asText(p.id), tone: 'red',
      title: `${asText(p.name)} retirement`,
      detail: 'Policy has a scheduled effective-to date.',
      meta: asText(cur?.effective_to),
    });
  }
  upcoming.sort((a, b) => (a.meta < b.meta ? -1 : a.meta > b.meta ? 1 : 0));

  const activity: PayPolicyOverview['activity'] = ((evRes.data ?? []) as Row[]).map(e => {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const policyId = asText(payload.policyId) || asText(payload.policy_id);
    const p = policyId ? policyById.get(policyId) : undefined;
    return {
      id: asText(e.id), tone: eventTone(asText(e.event_type)),
      label: humanizeEvent(asText(e.event_type)),
      detail: [p ? asText(p.name) : null, e.actor_user_id ? nameOf.get(asText(e.actor_user_id)) : 'System'].filter(Boolean).join(' · '),
      occurredAt: asText(e.created_at),
    };
  });

  const nextEffectiveDate = inReview
    .map(v => asText(v.effective_from)).filter(d => d >= today).sort()[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    band: {
      configuredPolicies: nonRetired.length,
      coveredEmployees,
      payGroupsAssigned: activeGroupIds.length,
      draftVersions: inReview.length,
      nextEffectiveDate,
      integrityFindings: totalBlockers,
    },
    metrics: {
      activePolicies: activePolicies.length,
      retiringPolicies: retiringPolicies.length,
      pendingVersions,
      assignedEmployees: coveredEmployees,
      workPatterns: workPatternLabels.length,
      workPatternLabels,
      setupFindings: blockedVersions.length,
      blockingFindings: blockedVersions.filter(x => !x.pf.ready).length,
      versionsThisYear,
    },
    banner,
    integrity,
    upcoming: upcoming.slice(0, 8),
    activity,
  };
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
