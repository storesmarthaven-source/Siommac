/**
 * lib/hr/readinessService.ts — the typed readiness model: controls, control
 * instances and the work items used to resolve them.
 *
 * This REPLACES the superseded three-factor approximation (assignment / payroll
 * / training booleans computed inline). Readiness is now:
 *
 *   control  — the rule that determines readiness (`hr_readiness_controls`)
 *   instance — this employee's state against that rule
 *   work item— the collaboration record used to resolve a failed control
 *
 * per docs/EMPLOYEE_READINESS_COLLABORATION_NOTE.md. The three are separate
 * because the note is explicit that the system "must not treat every blocker as
 * a document-upload problem": a control declares its own `resolution_type`, and
 * the offered actions follow from that, not from the display text.
 *
 * WRITES all go through `hr_readiness_work_item_transition_tx`. Nothing in this
 * file assembles the eight required side effects in the app layer — supabase-js
 * cannot make them atomic (see the migration header).
 */

import { sb } from '../db';
import { firstNonBlank } from './employeeCore';
import { requireReadinessOwner, resolveReadinessOwners, READINESS_DOMAINS, OwnerRequiredError } from './readinessOwnership';
import type {
  ReadinessDomain, ReadinessState, ReadinessResolutionType, ReadinessDecision,
  ReadinessActionKey, ReadinessCapabilities, ReadinessControlDefinition,
  ReadinessControlMatrixEntry, ReadinessCoverage, ReadinessOwnerResolution,
  ReadinessWorkItemAction, ReadinessWorkItemDetail, ReadinessWorkItemSummary,
  ReadinessWorkItemTransitionEntry, EmployeeReadinessMatrix, AttentionSeverity,
  ProfileReadinessSummary,
} from '../../../../types/hrEmployeeProfile';
import { READINESS_SATISFIED_STATES } from '../../../../types/hrEmployeeProfile';

const SATISFIED = new Set<ReadinessState>(READINESS_SATISFIED_STATES);
const isSatisfied = (s: ReadinessState) => SATISFIED.has(s);

/** Capability keys, exactly as catalogued. */
export const READINESS_VIEW      = 'hr.employees.readiness.view';
export const READINESS_FOLLOW_UP = 'hr.employees.readiness.follow_up';
export const READINESS_REVIEW    = 'hr.employees.readiness.review';

interface ControlRow {
  id: string; control_key: string; label: string; domain: ReadinessDomain;
  resolution_type: ReadinessResolutionType; description: string | null;
  is_blocking: boolean; sort_order: number;
}

interface InstanceRow { control_id: string; state: ReadinessState; percent: number; evaluated_at: string }

interface WorkItemRow {
  id: string; employee_id: string; control_id: string; instance_id: string | null;
  owner_id: string | null; responsible_team: string | null; status: ReadinessState;
  severity: AttentionSeverity; due_date: string | null; evidence_refs: unknown;
  reviewer_id: string | null; decision: ReadinessDecision | null; decision_reason: string | null;
  correlation_id: string; workflow_id: string | null; created_by: string | null;
  created_at: string; resolved_at: string | null;
}

const CONTROL_COLS = 'id, control_key, label, domain, resolution_type, description, is_blocking, sort_order';
const WORK_ITEM_COLS =
  'id, employee_id, control_id, instance_id, owner_id, responsible_team, status, severity, due_date, '
  + 'evidence_refs, reviewer_id, decision, decision_reason, correlation_id, workflow_id, created_by, created_at, resolved_at';

function definitionOf(row: ControlRow): ReadinessControlDefinition {
  return {
    controlKey: row.control_key, label: row.label, domain: row.domain,
    resolutionType: row.resolution_type, description: row.description, isBlocking: row.is_blocking,
  };
}

/** Whole days a work item has been open — the "ageing" the blocker row shows. */
export function ageInDays(createdAt: string, now: Date = new Date()): number {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86_400_000));
}

/**
 * Who is expected to act NOW — which is not always the owner.
 *
 * While evidence is awaited the employee acts; once submitted the reviewer does.
 * The note requires every row to name this explicitly.
 */
function nextResponsibleParty(
  status: ReadinessState, owner: ReadinessOwnerResolution, employeeName: string,
): string | null {
  if (isSatisfied(status)) return null;
  if (status === 'waiting_for_information') return employeeName;
  if (status === 'submitted_for_review' || status === 'in_review') return owner.ownerLabel ?? 'Owner Required';
  return owner.ownerLabel ?? 'Owner Required';
}

export function readinessCapabilities(granted: ReadonlySet<string>): ReadinessCapabilities {
  return {
    view:     granted.has(READINESS_VIEW),
    followUp: granted.has(READINESS_FOLLOW_UP),
    review:   granted.has(READINESS_REVIEW),
  };
}

/**
 * Coverage over EVERY active blocking control — including controls the employee
 * has never been evaluated against.
 *
 * Counting only existing instance rows would report 100% for an employee with no
 * readiness record at all, which is the most dangerous possible wrong answer on
 * this surface. Mirrors `public.hr_readiness_recalculate` exactly so the read
 * path and the transaction can never disagree.
 */
export function computeCoverage(
  controls: ControlRow[],
  instances: Map<string, InstanceRow>,
  unresolvedWorkItems: number,
): ReadinessCoverage {
  const blocking = controls.filter(c => c.is_blocking);
  const blockedDomains = new Set<ReadinessDomain>();
  let ready = 0;
  for (const c of blocking) {
    const state = instances.get(c.id)?.state ?? 'open';
    if (isSatisfied(state)) ready += 1;
    else blockedDomains.add(c.domain);
  }
  return {
    percent: blocking.length === 0 ? 100 : Math.round((ready / blocking.length) * 100),
    readyControls: ready,
    totalControls: blocking.length,
    unresolvedWorkItems,
    blockedDomains: [...blockedDomains].sort(),
  };
}

async function loadControls(): Promise<ControlRow[]> {
  const { data, error } = await sb.from('hr_readiness_controls')
    .select(CONTROL_COLS).eq('is_active', true).order('sort_order');
  if (error) throw new Error(`Readiness control read failed: ${error.message}`);
  return data;
}

async function loadInstances(employeeId: string): Promise<Map<string, InstanceRow>> {
  const { data, error } = await sb.from('hr_readiness_control_instances')
    .select('control_id, state, percent, evaluated_at').eq('employee_id', employeeId);
  if (error) throw new Error(`Readiness instance read failed: ${error.message}`);
  return new Map((data as unknown as InstanceRow[]).map(r => [r.control_id, r]));
}

async function loadOpenWorkItems(employeeId: string): Promise<WorkItemRow[]> {
  const { data, error } = await sb.from('hr_readiness_work_items')
    .select(WORK_ITEM_COLS).eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Readiness work item read failed: ${error.message}`);
  // WORK_ITEM_COLS is assembled from constants, so supabase-js cannot infer the
  // projection and falls back to GenericStringError[]; narrow it once here.
  return data as unknown as WorkItemRow[];
}

async function employeeDisplayName(employeeId: string): Promise<string> {
  const { data, error } = await sb.from('app_users')
    .select('display_name, full_name, username').eq('id', employeeId)
    .maybeSingle<{ display_name: string | null; full_name: string | null; username: string | null }>();
  if (error) throw new Error(`Readiness employee read failed: ${error.message}`);
  return firstNonBlank(data?.display_name, data?.full_name, data?.username) ?? employeeId;
}

/**
 * The Readiness tab's whole dataset: every active control, this employee's state
 * against it, its resolved owner, and any open work item.
 *
 * The owner is resolved for EVERY row, including the `owner_required` case, so
 * an unconfigured domain renders as **Owner Required** rather than blank.
 */
export async function getReadinessMatrix(
  employeeId: string, granted: ReadonlySet<string>,
): Promise<EmployeeReadinessMatrix> {
  const [controls, instances, workItems, employeeName] = await Promise.all([
    loadControls(), loadInstances(employeeId), loadOpenWorkItems(employeeId), employeeDisplayName(employeeId),
  ]);

  const domains = [...new Set(controls.map(c => c.domain))];
  const owners = await resolveReadinessOwners(domains.length ? domains : READINESS_DOMAINS);

  const openByControl = new Map<string, WorkItemRow>();
  for (const w of workItems) {
    if (isSatisfied(w.status)) continue;
    if (!openByControl.has(w.control_id)) openByControl.set(w.control_id, w);
  }

  const ownerLabels = await resolveOwnerUserLabels(workItems);
  const now = new Date();

  const entries: ReadinessControlMatrixEntry[] = controls.map(control => {
    const instance = instances.get(control.id);
    const owner = owners.get(control.domain)
      ?? { domain: control.domain, status: 'owner_required' as const, ownerType: null, ownerId: null, ownerLabel: null, recipientUserIds: [], reason: `No owner is configured for the ${control.domain} readiness area.` };
    const item = openByControl.get(control.id);
    const state = instance?.state ?? 'open';

    const workItem: ReadinessWorkItemSummary | null = item ? {
      id: item.id,
      status: item.status,
      severity: item.severity,
      dueDate: item.due_date,
      ageDays: ageInDays(item.created_at, now),
      // A named owner recorded on the row wins over the configured owner: it is
      // who the work was actually routed to.
      ownerLabel: (item.owner_id ? ownerLabels.get(item.owner_id) : null) ?? owner.ownerLabel,
      responsibleTeam: item.responsible_team,
      nextResponsibleParty: nextResponsibleParty(item.status, owner, employeeName),
    } : null;

    return {
      control: definitionOf(control),
      state,
      percent: instance?.percent ?? 0,
      evaluatedAt: instance?.evaluated_at ?? null,
      owner,
      workItem,
    };
  });

  const unresolved = workItems.filter(w => !isSatisfied(w.status)).length;

  return {
    employeeId,
    coverage: computeCoverage(controls, instances, unresolved),
    controls: entries,
    capabilities: readinessCapabilities(granted),
  };
}

/** Resolve every recorded owner/reviewer id to a name in one pass. */
async function resolveOwnerUserLabels(rows: WorkItemRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap(r => [r.owner_id, r.reviewer_id, r.created_by]).filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const { data, error } = await sb.from('app_users')
    .select('id, display_name, full_name, username').in('id', ids);
  if (error) throw new Error(`Readiness actor resolution failed: ${error.message}`);
  return new Map((data as { id: string; display_name: string | null; full_name: string | null; username: string | null }[])
    .map(u => [u.id, firstNonBlank(u.display_name, u.full_name, u.username) ?? u.id]));
}

/**
 * The gauge summary the profile shell shows, built from the SAME typed controls
 * as the matrix.
 *
 * This is what replaced `readinessSummary()`'s three-factor guess. The drawer
 * gauge and the Readiness tab now cannot disagree, because both count real
 * control instances rather than re-deriving readiness from different signals.
 *
 * `payrollStatus`/`trainingStatus` remain in the contract as genuine domain
 * signals read from their canonical sources — they are reported, not used to
 * synthesise the score.
 */
export async function getReadinessSummary(
  employeeId: string,
  payrollStatus: ProfileReadinessSummary['payrollStatus'],
  trainingStatus: ProfileReadinessSummary['trainingStatus'],
): Promise<ProfileReadinessSummary> {
  const [controls, instances, workItems] = await Promise.all([
    loadControls(), loadInstances(employeeId), loadOpenWorkItems(employeeId),
  ]);

  const unresolved = workItems.filter(w => !isSatisfied(w.status));
  const coverage = computeCoverage(controls, instances, unresolved.length);

  // Latest evaluation across all of this employee's control instances.
  let lastReviewedAt: string | null = null;
  for (const instance of instances.values()) {
    if (!lastReviewedAt || instance.evaluated_at > lastReviewedAt) lastReviewedAt = instance.evaluated_at;
  }

  // The next date something is actually expected — the earliest outstanding due
  // date, not a synthetic "review cycle".
  let nextReviewAt: string | null = null;
  for (const item of unresolved) {
    if (item.due_date && (!nextReviewAt || item.due_date < nextReviewAt)) nextReviewAt = item.due_date;
  }

  // Coordinating owner = owner of the blocked domain carrying the most urgent
  // work. With nothing blocked there is no one to name, and inventing one would
  // imply an accountability that does not exist.
  let reviewOwnerLabel: string | null = null;
  if (coverage.blockedDomains.length) {
    const owners = await resolveReadinessOwners(coverage.blockedDomains);
    const severityRank: Record<AttentionSeverity, number> = { critical: 3, warning: 2, info: 1 };
    const controlById = new Map(controls.map(c => [c.id, c]));
    const ranked = [...unresolved].sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
    const leadDomain = (ranked.length ? controlById.get(ranked[0].control_id)?.domain : undefined)
      ?? coverage.blockedDomains[0];
    const owner = owners.get(leadDomain);
    // An unconfigured owner surfaces as Owner Required, never as a blank.
    reviewOwnerLabel = owner?.status === 'resolved' ? owner.ownerLabel : 'Owner Required';
  }

  return {
    percent: coverage.percent,
    readyControls: coverage.readyControls,
    totalControls: coverage.totalControls,
    unresolvedWorkItems: coverage.unresolvedWorkItems,
    payrollStatus,
    trainingStatus,
    blockedDomains: coverage.blockedDomains,
    lastReviewedAt,
    reviewOwnerLabel,
    nextReviewAt,
  };
}

// ── Offered actions ─────────────────────────────────────────────────────────

/**
 * The two or three valid next actions for THIS control, status and actor.
 *
 * Deliberately derived from the control's `resolution_type` and the actor's
 * capabilities — never from the display text, and never a fixed list. HR
 * coordination (remind / request information) is separated from specialist
 * review (approve / return): holding `follow_up` must not confer the authority
 * to accept a Payroll or Training result.
 */
export function availableActions(
  control: ReadinessControlDefinition,
  status: ReadinessState,
  capabilities: ReadinessCapabilities,
): ReadinessWorkItemAction[] {
  if (isSatisfied(status)) return [];
  const actions: ReadinessWorkItemAction[] = [];

  const coordination = control.resolutionType === 'department_verification'
    || control.resolutionType === 'external_system_confirmation';

  if (capabilities.followUp) {
    actions.push({
      action: 'send_reminder', label: 'Send Reminder',
      effect: coordination
        ? 'Notifies the owning team that this control is still outstanding. It does not change the control state.'
        : 'Notifies the current owner that this control is still outstanding. It does not change the control state.',
      requiresReason: false, targetStatus: status,
    });

    if (status !== 'waiting_for_information'
        && (control.resolutionType === 'field_correction' || control.resolutionType === 'document_evidence')) {
      actions.push({
        action: 'request_information', label: 'Request Information',
        effect: 'Asks the employee to supply the missing information or evidence, and moves the item to Waiting For Information.',
        requiresReason: true, targetStatus: 'waiting_for_information',
      });
    }
  }

  if (capabilities.review) {
    if (status === 'submitted_for_review' || status === 'in_review') {
      actions.push({
        action: 'approve', label: 'Approve And Complete',
        effect: 'Accepts the submitted result, makes this control ready, and recalculates the employee’s readiness.',
        requiresReason: false, targetStatus: 'ready',
      });
      actions.push({
        action: 'return', label: 'Return For Correction',
        effect: 'Returns the submission with your feedback and reopens the task for correction. This is not a terminal outcome.',
        requiresReason: true, targetStatus: 'waiting_for_information',
      });
    }
    actions.push({
      action: 'approve_exception', label: 'Approve Exception',
      effect: 'Records an approved exception for this control. Readiness counts it as satisfied and the reason is audited.',
      requiresReason: true, targetStatus: 'exception_approved',
    });
    actions.push({
      action: 'mark_not_applicable', label: 'Mark Not Applicable',
      effect: 'Records that this control does not apply to this employee. It stops counting against readiness.',
      requiresReason: true, targetStatus: 'not_applicable',
    });
  }

  return actions;
}

// ── Work-item detail ────────────────────────────────────────────────────────

export async function getWorkItemDetail(
  workItemId: string, granted: ReadonlySet<string>,
): Promise<ReadinessWorkItemDetail> {
  const { data, error } = await sb.from('hr_readiness_work_items')
    .select(WORK_ITEM_COLS).eq('id', workItemId).maybeSingle<WorkItemRow>();
  if (error) throw new Error(`Readiness work item read failed: ${error.message}`);
  if (!data) throw Object.assign(new Error('Readiness work item not found.'), { status: 404 });

  const [controlRes, transitionRes, employeeName, labels] = await Promise.all([
    sb.from('hr_readiness_controls').select(CONTROL_COLS).eq('id', data.control_id).maybeSingle<ControlRow>(),
    sb.from('hr_readiness_work_item_transitions')
      .select('id, from_status, to_status, actor_id, note, created_at')
      .eq('work_item_id', workItemId).order('created_at', { ascending: false }),
    employeeDisplayName(data.employee_id),
    resolveOwnerUserLabels([data]),
  ]);
  if (controlRes.error) throw new Error(`Readiness control read failed: ${controlRes.error.message}`);
  if (!controlRes.data) throw Object.assign(new Error('Readiness control not found.'), { status: 404 });
  if (transitionRes.error) throw new Error(`Readiness history read failed: ${transitionRes.error.message}`);

  const control = definitionOf(controlRes.data);
  const owners = await resolveReadinessOwners([control.domain]);
  // resolveReadinessOwners always yields an entry per requested domain, but the
  // fail-closed shape is reconstructed here rather than asserted non-null.
  const owner = owners.get(control.domain)
    ?? { domain: control.domain, status: 'owner_required' as const, ownerType: null, ownerId: null,
         ownerLabel: null, recipientUserIds: [], reason: `No owner is configured for the ${control.domain} readiness area.` };

  const transitionRows = transitionRes.data as {
    id: string; from_status: ReadinessState | null; to_status: ReadinessState;
    actor_id: string | null; note: string | null; created_at: string;
  }[];
  const actorLabels = await resolveActorLabels(transitionRows.map(t => t.actor_id));

  const history: ReadinessWorkItemTransitionEntry[] = transitionRows.map(t => ({
    id: t.id, fromStatus: t.from_status, toStatus: t.to_status,
    actorName: t.actor_id ? (actorLabels.get(t.actor_id) ?? null) : null,
    note: t.note, occurredAt: t.created_at,
  }));

  const capabilities = readinessCapabilities(granted);

  return {
    id: data.id,
    employeeId: data.employee_id,
    employeeName,
    control,
    status: data.status,
    severity: data.severity,
    dueDate: data.due_date,
    ageDays: ageInDays(data.created_at),
    owner,
    ownerLabel: (data.owner_id ? labels.get(data.owner_id) : null) ?? owner.ownerLabel,
    responsibleTeam: data.responsible_team,
    coordinatorLabel: data.created_by ? (labels.get(data.created_by) ?? null) : null,
    reviewerName: data.reviewer_id ? (labels.get(data.reviewer_id) ?? null) : null,
    decision: data.decision,
    decisionReason: data.decision_reason,
    evidenceRefs: Array.isArray(data.evidence_refs) ? data.evidence_refs : [],
    correlationId: data.correlation_id,
    workflowId: data.workflow_id,
    createdAt: data.created_at,
    resolvedAt: data.resolved_at,
    history,
    availableActions: availableActions(control, data.status, capabilities),
  };
}

async function resolveActorLabels(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const { data, error } = await sb.from('app_users')
    .select('id, display_name, full_name, username').in('id', unique);
  if (error) throw new Error(`Readiness actor resolution failed: ${error.message}`);
  return new Map((data as { id: string; display_name: string | null; full_name: string | null; username: string | null }[])
    .map(u => [u.id, firstNonBlank(u.display_name, u.full_name, u.username) ?? u.id]));
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * Which module owns the work once it leaves HR.
 *
 * A handoff is created only when another module must act in ITS OWN workspace —
 * the employee profile never exposes the protected Finance acceptance action.
 * HR-owned resolution types create no handoff, because there is nowhere to hand
 * off to.
 */
const HANDOFF_TARGET: Partial<Record<ReadinessDomain, { targetModule: string; targetEntityType: string }>> = {
  payroll:  { targetModule: 'finance', targetEntityType: 'employee_bank_verification' },
  training: { targetModule: 'hse',     targetEntityType: 'training_evidence_review' },
  access:   { targetModule: 'admin',   targetEntityType: 'account_support_request' },
};

export interface TransitionInput {
  actorId: string;
  employeeId: string;
  controlKey: string;
  workItemId?: string | null;
  action: ReadinessActionKey;
  toStatus: ReadinessState;
  severity?: AttentionSeverity | null;
  dueDate?: string | null;
  decision?: ReadinessDecision | null;
  decisionReason?: string | null;
  note?: string | null;
  correlationId: string;
}

export interface TransitionResult {
  workItemId: string;
  instanceId: string;
  employeeId: string;
  controlKey: string;
  domain: ReadinessDomain;
  fromStatus: ReadinessState | null;
  status: ReadinessState;
  workflowId: string | null;
  eventId: string;
  handoffId: string | null;
  notified: number;
  coverage: ReadinessCoverage;
  correlationId: string;
}

/**
 * Resolve the published template version for the configured owner kind.
 *
 * Two definitions exist because the workflow primitive fixes the assignee FORM
 * in the definition and refuses a task carrying both a user and a role.
 */
async function templateVersionFor(ownerType: 'role' | 'user'): Promise<string | null> {
  const key = ownerType === 'role' ? 'hr_readiness_review_role' : 'hr_readiness_review_user';
  const { data: tpl, error: tplError } = await sb.from('workflow_templates')
    .select('id').eq('template_key', key).maybeSingle<{ id: string }>();
  if (tplError) throw new Error(`Readiness workflow template read failed: ${tplError.message}`);
  if (!tpl) return null;
  const { data: version, error: versionError } = await sb.from('workflow_template_versions')
    .select('id').eq('template_id', tpl.id).eq('version_status', 'published')
    .order('version_no', { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  if (versionError) throw new Error(`Readiness workflow version read failed: ${versionError.message}`);
  return version?.id ?? null;
}

/** RPC error → HTTP-shaped error, preserving the database's own message. */
function rpcFailure(prefix: string, error: { message: string; code?: string }): never {
  const status = error.code === '22023' ? 422 : error.code === 'P0002' ? 404
    : error.code === 'WF422' ? 422 : error.code === 'WF404' ? 404 : error.code === 'WF409' ? 409 : 500;
  throw Object.assign(new Error(`${prefix}: ${error.message}`), { status });
}

/**
 * Perform a readiness transition.
 *
 * Ownership is resolved FIRST and fails closed: `requireReadinessOwner` throws
 * `OwnerRequiredError` before the transaction opens, so a work item is never
 * created with nowhere to go.
 *
 * Everything else — control instance, work item, transition row, recalculation,
 * app_events, audit_logs, hr_audit_log, the workflow instance and its task,
 * notifications and the handoff — commits inside
 * `hr_readiness_work_item_transition_tx` under ONE correlation id.
 */
export async function transitionWorkItem(input: TransitionInput): Promise<TransitionResult> {
  const { data: control, error: controlError } = await sb.from('hr_readiness_controls')
    .select('domain, resolution_type').eq('control_key', input.controlKey).eq('is_active', true)
    .maybeSingle<{ domain: ReadinessDomain; resolution_type: ReadinessResolutionType }>();
  if (controlError) throw new Error(`Readiness control read failed: ${controlError.message}`);
  if (!control) throw Object.assign(new Error(`Readiness control ${input.controlKey} not found or inactive.`), { status: 404 });

  // Fail closed BEFORE any write.
  const owner = await requireReadinessOwner(control.domain);

  const terminal = isSatisfied(input.toStatus);
  // requireReadinessOwner only returns a RESOLVED owner, so ownerType is present;
  // this narrows it without an assertion and keeps the fail-closed path explicit.
  const ownerType = owner.ownerType;
  if (!ownerType) throw new OwnerRequiredError(control.domain, owner.reason ?? 'No valid owner is configured.');
  const templateVersionId = terminal ? null : await templateVersionFor(ownerType);

  // Notify the routed owner, except on a terminal resolution, where the
  // coordinator who has been chasing it is the one who needs to know.
  const recipients = terminal
    ? [...new Set([...owner.recipientUserIds, input.actorId])]
    : owner.recipientUserIds;

  const handoff = terminal ? null : (HANDOFF_TARGET[control.domain] ?? null);

  const result = await sb.rpc('hr_readiness_work_item_transition_tx', {
    p_actor_id:            input.actorId,
    p_employee_id:         input.employeeId,
    p_control_key:         input.controlKey,
    p_work_item_id:        input.workItemId ?? null,
    p_action:              input.action,
    p_to_status:           input.toStatus,
    p_owner_type:          ownerType,
    p_owner_id:            owner.ownerId,
    p_owner_label:         owner.ownerLabel,
    p_recipient_ids:       recipients,
    p_responsible_team:    ownerType === 'role' ? owner.ownerLabel : null,
    p_severity:            input.severity ?? null,
    p_due_date:            input.dueDate ?? null,
    p_decision:            input.decision ?? null,
    p_decision_reason:     input.decisionReason ?? null,
    p_note:                input.note ?? null,
    p_template_version_id: templateVersionId,
    p_handoff:             handoff,
    p_correlation_id:      input.correlationId,
  }) as unknown as { data: unknown; error: { message: string; code?: string } | null };

  if (result.error) rpcFailure('Readiness transition failed', result.error);
  return result.data as TransitionResult;
}
