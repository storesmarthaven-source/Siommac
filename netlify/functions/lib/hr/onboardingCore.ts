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

export interface StartOnboardingArgs {
  employeeId: string; packageKey: string; ownerId?: string | null; dueAt?: string | null;
  // v36 §10 Worker & Trigger intake (optional; persisted on the case).
  reason?: string | null; priority?: string | null; targetStartDate?: string | null;
  launchMode?: string | null; caseOwner?: string | null; workerType?: string | null;
  /** Package action-template ids the wizard's Custom Actions step included — instantiated
   *  into the case via addCaseAction after it's created. Best-effort: one failing template
   *  doesn't fail case creation (the case itself is already committed by this point). */
  includeActionTemplateIds?: string[] | null;
}
export interface StartOnboardingResult { caseId: string; caseNo: string; taskCount: number; handoffCount: number }

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

  const result = await runModuleMutation<{ id: string; caseNo: string; taskCount: number; handoffCount: number }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'create', entityType: 'onboarding_case',
      idempotencyKey: `hr.onboarding.start:${args.employeeId}:${args.packageKey}`,
      eventType: 'onboarding.started', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.caseNo }),
      buildEventPayload: (r) => ({ employeeId: args.employeeId, packageKey: args.packageKey, taskCount: r.taskCount, handoffCount: r.handoffCount }),
    },
    writeRecord: async () => {
      const prefixRaw = await resolveSettingValue<unknown>(sb, 'hr_onboarding.case_no_prefix', sScope, 'ONB');
      const casePrefix = (typeof prefixRaw === 'string' && prefixRaw.trim()) ? prefixRaw.trim() : 'ONB';
      const caseNo = await nextRef(casePrefix);
      const { data: kase, error: cErr } = await sb.from('hr_onboarding_cases').insert({
        case_no: caseNo, employee_id: emp.id,
        worker_type: args.workerType?.trim() || (emp.contractor_flag ? 'contractor' : 'employee'),
        package_key: plan.key, status: 'in_progress', owner_id: ownerId, due_at: args.dueAt ?? null, started_by: actorId,
        reason: args.reason?.trim() || null, priority: args.priority?.trim() || null,
        target_start_date: args.targetStartDate || null, launch_mode: args.launchMode?.trim() || null,
        case_owner: args.caseOwner?.trim() || null,
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

      await writeHrAudit({ employeeId: emp.id, submoduleKey: 'onboarding', recordId: kase.id, actorId,
        action: 'hr.onboarding.started', newState: { caseNo, packageKey: plan.key, taskCount: taskRows.length } });
      return { id: kase.id, caseNo: kase.case_no, taskCount: taskRows.length, handoffCount: plan.handoffs.length };
    },
  });

  // Handoff intents recorded above; surface the domain event for each (delivery is a later phase).
  for (const h of plan.handoffs) {
    void emitAppEvent({ eventType: 'onboarding.handoff.created', sourceModule: 'hr', sourceEntityType: 'onboarding_case',
      sourceEntityId: result.entityId, actorUserId: actorId, severity: 'info', payload: { targetModule: h.targetModule, handoffType: h.handoffType } });
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
