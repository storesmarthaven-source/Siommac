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
import { writeHrAudit }    from './employeeCore';
import { ONBOARDING_PACKAGES } from './onboardingPackages';

export interface StartOnboardingArgs { employeeId: string; packageKey: string; ownerId?: string | null; dueAt?: string | null }
export interface StartOnboardingResult { caseId: string; caseNo: string; taskCount: number; handoffCount: number }

/**
 * Start an onboarding case from a package: case → tasks (assignee resolved where
 * unambiguous) → cross-module handoff intents (delivery is a later phase). Routed
 * through runModuleMutation (idempotency keyed by employee+package). THROWS on
 * failure (errors carry a `status` for the route layer).
 */
export async function startOnboardingCase(actorId: string, args: StartOnboardingArgs): Promise<StartOnboardingResult> {
  const pkg = ONBOARDING_PACKAGES[args.packageKey];
  if (!pkg) throw Object.assign(new Error('Unknown onboarding package.'), { status: 400 });

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
      const caseNo = await nextRef('ONB');
      const { data: kase, error: cErr } = await sb.from('hr_onboarding_cases').insert({
        case_no: caseNo, employee_id: emp.id, worker_type: emp.contractor_flag ? 'contractor' : 'employee',
        package_key: pkg.key, status: 'in_progress', owner_id: ownerId, due_at: args.dueAt ?? null, started_by: actorId,
      }).select('id, case_no').single<{ id: string; case_no: string }>();
      if (cErr) throw Object.assign(new Error(cErr.message), { status: 500 });

      const taskRows = pkg.tasks.map(t => ({
        case_id: kase.id, task_key: t.taskKey, task_title: t.taskTitle, owner_role: t.ownerRole, module_key: t.moduleKey,
        assigned_to: t.ownerRole === 'hr' ? ownerId : t.ownerRole === 'supervisor' ? emp.supervisor_id : null,
        status: 'pending',
      }));
      const { error: tErr } = await sb.from('hr_onboarding_tasks').insert(taskRows);
      if (tErr) { await sb.from('hr_onboarding_cases').delete().eq('id', kase.id); throw Object.assign(new Error(tErr.message), { status: 500 }); }

      if (pkg.handoffs.length) {
        const { error: hErr } = await sb.from('hr_onboarding_handoffs').insert(
          pkg.handoffs.map(h => ({ case_id: kase.id, target_module: h.targetModule, handoff_type: h.handoffType, status: 'pending', payload: { employeeId: emp.id, caseNo } })),
        );
        if (hErr) { await sb.from('hr_onboarding_cases').delete().eq('id', kase.id); throw Object.assign(new Error(hErr.message), { status: 500 }); }
      }

      await writeHrAudit({ employeeId: emp.id, submoduleKey: 'onboarding', recordId: kase.id, actorId,
        action: 'hr.onboarding.started', newState: { caseNo, packageKey: pkg.key, taskCount: taskRows.length } });
      return { id: kase.id, caseNo: kase.case_no, taskCount: taskRows.length, handoffCount: pkg.handoffs.length };
    },
  });

  // Handoff intents recorded above; surface the domain event for each (delivery is a later phase).
  for (const h of pkg.handoffs) {
    void emitAppEvent({ eventType: 'onboarding.handoff.created', sourceModule: 'hr', sourceEntityType: 'onboarding_case',
      sourceEntityId: result.entityId, actorUserId: actorId, severity: 'info', payload: { targetModule: h.targetModule, handoffType: h.handoffType } });
  }
  return { caseId: result.entityId, caseNo: result.record.caseNo, taskCount: result.record.taskCount, handoffCount: result.record.handoffCount };
}
