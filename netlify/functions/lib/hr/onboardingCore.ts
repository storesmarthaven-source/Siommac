// lib/hr/onboardingCore.ts — shared onboarding-case start.
//
// Single source of truth for starting an onboarding case (case + tasks + handoff
// intents), reused by routes/hrOnboarding.ts (/onboarding/start) AND routes/hr.ts
// (employees/create with onboarding.create_onboarding_case). Keeping ONE
// startOnboardingCase() avoids duplicating the case/task/handoff chain.

import { sb }              from '../db';
import { emitAppEvent }    from '../appEvents';
import { nextRef }         from '../refGenerator';
import { runModuleMutation } from '../moduleServiceAdapter';
import { resolveSettingValue } from '../settings/resolveSetting';
import { writeHrAudit }    from './employeeCore';
import { loadPackagePlan } from './onboardingPackageService';
import { addCaseAction }   from './onboardingCustomActions';
import { getComplianceForEmployee } from './documentsCompliance';
import { listRequirements } from './documentsRequirements';
import { createOnboardingDocumentRequests } from './onboardingDocumentRequests';
import { notify } from '../notify';
import type { OnboardingCaseStatus, OnboardingDocumentLaunchSelection } from '../../../../types/hrOnboarding';

export interface StartOnboardingArgs {
  employeeId: string; packageKey: string; ownerId?: string | null; dueAt?: string | null;
  // v36 §10 Worker & Trigger intake (optional; persisted on the case).
  reason?: string | null; priority?: string | null; targetStartDate?: string | null;
  launchMode?: string | null; caseOwner?: string | null; workerType?: string | null;
  /** Package action-template ids the wizard's Custom Actions step included — instantiated
   *  into the case via addCaseAction after it's created. Best-effort: one failing template
   *  doesn't fail case creation (the case itself is already committed by this point). */
  includeActionTemplateIds?: string[] | null;
  /** Per-requirement document disposition selections from the Documents wizard step. */
  documentSelections?: OnboardingDocumentLaunchSelection[] | null;
  /** ISO datetime when the scheduled case should go active (Scheduled launch mode). */
  scheduledLaunchAt?: string | null;
  /** Case-type-specific intake fields (contractor company/contract dates, temporary
   *  end date/reason, etc.) — persisted on the case's metadata, not on dedicated columns. */
  workerTypeDetails?: Record<string, unknown> | null;
}
export interface StartOnboardingResult { caseId: string; caseNo: string; taskCount: number; handoffCount: number }

// ── Active statuses that indicate a case is in-flight (duplicate check) ─────
const ACTIVE_CASE_STATUSES: OnboardingCaseStatus[] = [
  'draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation',
];

/**
 * Pre-launch gate validation. Throws with status 400 on any failure.
 * Runs BEFORE writeRecord so a bad launch never even starts the mutation.
 */
async function validateOnboardingLaunchGates(
  employeeId: string,
  documentSelections: OnboardingDocumentLaunchSelection[] | null | undefined,
): Promise<void> {
  // 1. Duplicate active case — real backend enforcement (not just a UI badge)
  const { data: dupes, error: dupeErr } = await sb
    .from('hr_onboarding_cases')
    .select('id, case_no, status')
    .eq('employee_id', employeeId)
    .in('status', ACTIVE_CASE_STATUSES)
    .limit(1);
  if (dupeErr) throw Object.assign(new Error(dupeErr.message), { status: 500 });
  if (dupes && dupes.length > 0) {
    const first = dupes[0] as { case_no: string; status: string };
    throw Object.assign(
      new Error(`This employee already has an active onboarding case (${first.case_no}, status: ${first.status}). Cancel or complete it before starting a new one.`),
      { status: 400 },
    );
  }

  // 2. Critical verification items — re-uses the same logic as getOnboardingIntakePreview
  const [empRes, statRes] = await Promise.all([
    sb.from('app_users')
      .select('id, email, phone, employment_type')
      .eq('id', employeeId)
      .maybeSingle<{ id: string; email: string | null; phone: string | null; employment_type: string | null }>(),
    sb.from('hr_employee_statutory')
      .select('nis_status, nis_number')
      .eq('employee_id', employeeId)
      .maybeSingle<{ nis_status: string | null; nis_number: string | null }>(),
  ]);
  const emp = empRes.data;
  if (!emp) throw Object.assign(new Error('Employee not found.'), { status: 404 });
  // Only the two `critical: true` items gate launch (profile + right-to-work)
  if (!emp.employment_type) {
    throw Object.assign(
      new Error('Right to work is not verified for this worker. Set the employment type before launching.'),
      { status: 400 },
    );
  }
  // emp existence is already guaranteed above; this is redundant but mirrors the UI gate
  // (the `profile` check would fail before we get here since we just confirmed emp exists)

  // 3. Blocking documents — any blocking requirement that is missing/expired and not
  //    satisfied by a wizard selection (use_existing or uploaded) must block launch.
  const selMap = new Map<string, OnboardingDocumentLaunchSelection>(
    (documentSelections ?? []).map(s => [s.requirementId, s]),
  );
  const [compliance, requirements] = await Promise.all([
    getComplianceForEmployee(true, employeeId),
    listRequirements(true),
  ]);
  const reqById = new Map(requirements.map(r => [r.id, r]));

  const unsatisfiedBlocking = compliance.filter(comp => {
    const req = reqById.get(comp.requirementId);
    if (!req?.blocksOnboarding) return false;
    // Already present? Not blocking.
    if (comp.state === 'present_verified' || comp.state === 'present_unverified') return false;
    // Explicitly satisfied by wizard selection?
    const sel = selMap.get(comp.requirementId);
    if (sel && (sel.action === 'use_existing' || sel.action === 'uploaded' || sel.action === 'waive')) return false;
    return true; // missing/expired, blocking, and not satisfied
  });

  if (unsatisfiedBlocking.length > 0) {
    const labels = unsatisfiedBlocking.map(c => c.label).join(', ');
    throw Object.assign(
      new Error(`The following required documents are missing and block launch: ${labels}. Attach or waive them before launching.`),
      { status: 400 },
    );
  }
}

/**
 * Enforce that the chosen package is eligible for the effective worker type, and that
 * the case-type-specific required intake fields were supplied. Frontend filtering is a
 * convenience; THIS is the authority (a direct API call can't bypass it). Throws 400.
 */
function validateWorkerTypeAndPackage(
  effectiveWorkerType: string,
  planWorkerTypes: string[],
  planLabel: string,
  details: Record<string, unknown> | null | undefined,
): void {
  // Package eligibility — the package must declare the effective worker type.
  // Empty planWorkerTypes means the package hasn't been scoped; treat as employee-only
  // (the historical default) rather than allow-all, so a mis-scoped package can't leak.
  const allowed = planWorkerTypes.length ? planWorkerTypes : ['employee'];
  if (!allowed.includes(effectiveWorkerType)) {
    throw Object.assign(
      new Error(`The "${planLabel}" package is not available for ${effectiveWorkerType} onboarding. Choose a package that supports this case type.`),
      { status: 400 },
    );
  }

  // Case-type-specific required fields.
  const d = details ?? {};
  const has = (k: string): boolean => typeof d[k] === 'string' && (d[k] as string).trim().length > 0;
  if (effectiveWorkerType === 'contractor') {
    if (!has('contractorCompany')) throw Object.assign(new Error('Contractor company / agency is required for a contractor case.'), { status: 400 });
    if (!has('contractStartDate') || !has('contractEndDate')) throw Object.assign(new Error('Contract start and end dates are required for a contractor case.'), { status: 400 });
  }
  if (effectiveWorkerType === 'temporary') {
    if (!has('temporaryEndDate')) throw Object.assign(new Error('Temporary assignment end date is required for a temporary case.'), { status: 400 });
    if (!has('temporaryReason')) throw Object.assign(new Error('Temporary assignment reason is required for a temporary case.'), { status: 400 });
  }
}

/**
 * Start an onboarding case from a package: case → tasks (assignee resolved where
 * unambiguous) → cross-module handoff intents (delivery is a later phase). Routed
 * through runModuleMutation (idempotency keyed by employee+package). THROWS on
 * failure (errors carry a `status` for the route layer).
 */
export async function startOnboardingCase(actorId: string, args: StartOnboardingArgs): Promise<StartOnboardingResult> {
  // Settings gates (resolveSettingValue falls back to the safe value when the catalog
  // isn't synced yet, so behaviour is unchanged until an admin publishes/sets them).
  const sScope = { moduleKey: 'hr_onboarding' };
  const enabled = await resolveSettingValue<unknown>(sb, 'hr_onboarding.enabled', sScope, true);
  if (enabled === false || enabled === 'false') throw Object.assign(new Error('Onboarding is disabled in settings.'), { status: 403 });
  // Every case gets an owner — an explicit ownerId/caseOwner if the caller supplied one,
  // otherwise the actor who started it (the create-employee path and the standalone start
  // both rely on this default; an admin/HR manager shouldn't have to hand-pick an owner on
  // every case — they can reassign in the onboarding module). The require-owner setting
  // therefore gates on the EFFECTIVE owner (post-default), so it only ever blocks a
  // genuinely ownerless start — never a create that would have defaulted to the actor.
  const effectiveOwner = args.ownerId ?? args.caseOwner ?? actorId;
  const requireOwner = await resolveSettingValue<unknown>(sb, 'hr_onboarding.require_owner_on_start', sScope, false);
  if ((requireOwner === true || requireOwner === 'true') && !effectiveOwner) {
    throw Object.assign(new Error('A case owner is required to start onboarding (per settings).'), { status: 400 });
  }

  const plan = await loadPackagePlan(args.packageKey);
  if (!plan) throw Object.assign(new Error('Unknown or retired onboarding package.'), { status: 400 });

  const { data: emp } = await sb.from('app_users').select('id, supervisor_id, contractor_flag')
    .eq('id', args.employeeId).maybeSingle<{ id: string; supervisor_id: string | null; contractor_flag: boolean | null }>();
  if (!emp) throw Object.assign(new Error('Employee not found.'), { status: 404 });
  const ownerId = args.ownerId ?? actorId;

  // Effective worker type = explicit selection, else derived from the employee's contractor flag.
  const effectiveWorkerType = args.workerType?.trim() || (emp.contractor_flag ? 'contractor' : 'employee');
  // Package must be eligible for the worker type + the case-type's required fields must be present.
  validateWorkerTypeAndPackage(effectiveWorkerType, plan.workerTypes, plan.label, args.workerTypeDetails);

  // Gate validation — throws 400 with a clear message on any failure.
  // Run BEFORE runModuleMutation so we never start a half-committed case.
  await validateOnboardingLaunchGates(args.employeeId, args.documentSelections);

  // Determine initial status — 'draft' for scheduled starts so the case is not
  // actively tracked until the scheduled date; 'in_progress' for immediate starts.
  const isScheduled = args.launchMode === 'Scheduled' && !!args.scheduledLaunchAt;
  const initialStatus: OnboardingCaseStatus = isScheduled ? 'draft' : 'in_progress';

  // Pre-load compliance + requirements so the document-requests write inside
  // writeRecord does not need to re-query them (avoiding redundant DB calls).
  const [complianceForCase, allRequirements] = await Promise.all([
    getComplianceForEmployee(true, args.employeeId),
    listRequirements(true),
  ]);

  const result = await runModuleMutation<{ id: string; caseNo: string; taskCount: number; handoffCount: number; documentRequestCount: number }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'create', entityType: 'onboarding_case',
      idempotencyKey: `hr.onboarding.start:${args.employeeId}:${args.packageKey}`,
      eventType: 'onboarding.started', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.caseNo }),
      buildEventPayload: (r) => ({ employeeId: args.employeeId, packageKey: args.packageKey, taskCount: r.taskCount, handoffCount: r.handoffCount, documentRequestCount: r.documentRequestCount }),
    },
    writeRecord: async () => {
      const prefixRaw = await resolveSettingValue<unknown>(sb, 'hr_onboarding.case_no_prefix', sScope, 'ONB');
      const casePrefix = (typeof prefixRaw === 'string' && prefixRaw.trim()) ? prefixRaw.trim() : 'ONB';
      const caseNo = await nextRef(casePrefix);
      const { data: kase, error: cErr } = await sb.from('hr_onboarding_cases').insert({
        case_no: caseNo, employee_id: emp.id,
        worker_type: args.workerType?.trim() || (emp.contractor_flag ? 'contractor' : 'employee'),
        package_key: plan.key, status: initialStatus, owner_id: ownerId, due_at: args.dueAt ?? null, started_by: actorId,
        reason: args.reason?.trim() || null, priority: args.priority?.trim() || null,
        target_start_date: args.targetStartDate || null, launch_mode: args.launchMode?.trim() || null,
        case_owner: args.caseOwner?.trim() || null,
        scheduled_launch_at: isScheduled ? args.scheduledLaunchAt : null,
        metadata: (args.workerTypeDetails && Object.keys(args.workerTypeDetails).length)
          ? { workerTypeDetails: args.workerTypeDetails } : {},
      }).select('id, case_no').single<{ id: string; case_no: string }>();
      if (cErr) throw Object.assign(new Error(cErr.message), { status: 500 });

      const taskRows = plan.tasks.map(t => ({
        case_id: kase.id, task_key: t.taskKey, task_title: t.taskTitle, owner_role: t.ownerRole, module_key: t.moduleKey,
        assigned_to: t.ownerRole === 'hr' ? ownerId : t.ownerRole === 'supervisor' ? emp.supervisor_id : null,
        status: 'pending', is_blocking: t.isBlocking, requires_evidence: t.requiresEvidence, sort_order: t.sortOrder, dependency_keys: t.dependencyKeys,
      }));
      const { error: tErr } = await sb.from('hr_onboarding_tasks').insert(taskRows);
      if (tErr) { await sb.from('hr_onboarding_cases').delete().eq('id', kase.id); throw Object.assign(new Error(tErr.message), { status: 500 }); }

      if (plan.handoffs.length) {
        const { error: hErr } = await sb.from('hr_onboarding_handoffs').insert(
          plan.handoffs.map(h => ({ case_id: kase.id, handoff_key: h.handoffKey, target_module: h.targetModule, handoff_type: h.handoffType, status: 'pending', payload: { ...h.payloadTemplate, employeeId: emp.id, caseNo } })),
        );
        if (hErr) { await sb.from('hr_onboarding_cases').delete().eq('id', kase.id); throw Object.assign(new Error(hErr.message), { status: 500 }); }
      }

      // Case-specific document requests — one row per required document. Failure
      // compensates by deleting the case (same pattern as task/handoff failures).
      let documentRequestCount = 0;
      try {
        const docResult = await createOnboardingDocumentRequests({
          caseId: kase.id,
          employeeId: emp.id,
          actorId,
          compliance: complianceForCase,
          requirements: allRequirements,
          documentSelections: args.documentSelections,
        });
        documentRequestCount = docResult.documentRequestCount;
      } catch (docErr) {
        await sb.from('hr_onboarding_cases').delete().eq('id', kase.id);
        throw docErr;
      }

      // Persist probation_end_date on the worker when the package has a probation period
      // and the wizard provided a target start date. This is a satellite write within the
      // same writeRecord block — failure compensates by deleting the case (same pattern
      // as the task/handoff insert failures above).
      const probationEndDate: string | null = (() => {
        if (!args.targetStartDate || !plan.probationDays) return null;
        const start = new Date(args.targetStartDate);
        if (isNaN(start.getTime())) return null;
        start.setDate(start.getDate() + plan.probationDays);
        return start.toISOString().slice(0, 10); // 'YYYY-MM-DD'
      })();
      if (probationEndDate) {
        const { error: pErr } = await sb.from('app_users')
          .update({ probation_end_date: probationEndDate })
          .eq('id', emp.id);
        if (pErr) {
          await sb.from('hr_onboarding_cases').delete().eq('id', kase.id);
          throw Object.assign(new Error(pErr.message), { status: 500 });
        }
      }

      await writeHrAudit({ employeeId: emp.id, submoduleKey: 'onboarding', recordId: kase.id, actorId,
        action: 'hr.onboarding.started', newState: { caseNo, packageKey: plan.key, taskCount: taskRows.length, probationEndDate: probationEndDate ?? undefined, documentRequestCount, scheduledLaunchAt: args.scheduledLaunchAt ?? null } });
      return { id: kase.id, caseNo: kase.case_no, taskCount: taskRows.length, handoffCount: plan.handoffs.length, documentRequestCount };
    },
  });

  // Handoff intents recorded above; surface the domain event for each (delivery is a later phase).
  for (const h of plan.handoffs) {
    void emitAppEvent({ eventType: 'onboarding.handoff.created', sourceModule: 'hr', sourceEntityType: 'onboarding_case',
      sourceEntityId: result.entityId, actorUserId: actorId, severity: 'info', payload: { targetModule: h.targetModule, handoffType: h.handoffType } });
  }

  // Notifications — fire-and-forget via notify() (it never throws).
  // Notify the case owner (if different from actor) and, where cheaply derivable, the worker's supervisor.
  const caseNo = result.record.caseNo;
  const notifTitle = `Onboarding case ${caseNo} started`;
  const notifBody = `A new onboarding case has been launched for employee ${args.employeeId} using the ${plan.label} package.`;
  // Owner notification (skip if owner is the actor — they already know)
  if (ownerId && ownerId !== actorId) {
    void notify({
      userId: ownerId,
      type: 'hr.onboarding.started',
      title: notifTitle,
      body: notifBody,
      module: 'hr',
      severity: 'info',
      sourceType: 'onboarding_case',
      sourceId: result.entityId,
      dedupeKey: `hr.onboarding.started:${result.entityId}:${ownerId}`,
    });
  }
  // Supervisor notification — only when cheaply derivable (emp.supervisor_id is already loaded)
  if (emp.supervisor_id && emp.supervisor_id !== ownerId && emp.supervisor_id !== actorId) {
    void notify({
      userId: emp.supervisor_id,
      type: 'hr.onboarding.started',
      title: notifTitle,
      body: notifBody,
      module: 'hr',
      severity: 'info',
      sourceType: 'onboarding_case',
      sourceId: result.entityId,
      dedupeKey: `hr.onboarding.started:${result.entityId}:${emp.supervisor_id}`,
    });
  }

  // Instantiate any package action templates the wizard's Custom Actions step included.
  // Best-effort per template — the case is already committed, so one bad template must not
  // undo the whole start; addCaseAction does its own real insert + event + audit per action.
  for (const templateId of args.includeActionTemplateIds ?? []) {
    try { await addCaseAction(actorId, { caseId: result.entityId, sourceTemplateId: templateId }); }
    catch (e) { console.error('[onboarding] failed to instantiate action template at case start', { templateId, caseId: result.entityId, error: e instanceof Error ? e.message : e }); }
  }

  return { caseId: result.entityId, caseNo: result.record.caseNo, taskCount: result.record.taskCount, handoffCount: result.record.handoffCount };
}
