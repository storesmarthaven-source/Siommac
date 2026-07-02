// lib/hr/offboardingCore.ts — start an offboarding case from a standard exit plan.
//
// The plan (tasks + cross-module handoff intents) is code-defined for now — real,
// deterministic clearance/asset-return/access-removal/exit-interview/final-pay steps
// (a DB package registry is a later enhancement, mirroring onboarding packages).
// Routed through runModuleMutation for idempotency; THROWS on failure (errors carry
// a `status` for the route layer). Handoff DELIVERY is a later phase — recorded
// 'pending', emitted as an event, never faked.

import { sb }                 from '../db';
import { emitAppEvent }       from '../appEvents';
import { nextRef }            from '../refGenerator';
import { runModuleMutation }  from '../moduleServiceAdapter';
import { writeHrAudit }       from './employeeCore';
import type { StartOffboardingArgs, StartOffboardingResult, OffboardingReason } from '../../../../types/hrOffboarding';

interface PlanTask { taskKey: string; taskTitle: string; ownerRole: string; moduleKey: string | null; isBlocking: boolean; sortOrder: number }
interface PlanHandoff { handoffKey: string; targetModule: string; handoffType: string; payload: Record<string, unknown> }

const STANDARD_EXIT_TASKS: PlanTask[] = [
  { taskKey: 'clearance_checklist', taskTitle: 'Complete exit clearance checklist', ownerRole: 'hr',       moduleKey: 'hr',      isBlocking: true,  sortOrder: 1 },
  { taskKey: 'asset_return',        taskTitle: 'Collect company assets (laptop, phone, keys)', ownerRole: 'it', moduleKey: 'it',  isBlocking: true,  sortOrder: 2 },
  { taskKey: 'access_removal',      taskTitle: 'Remove system & building access',   ownerRole: 'it',       moduleKey: 'it',      isBlocking: true,  sortOrder: 3 },
  { taskKey: 'ppe_return',          taskTitle: 'Return issued PPE',                  ownerRole: 'hse',      moduleKey: 'hse',     isBlocking: false, sortOrder: 4 },
  { taskKey: 'exit_interview',      taskTitle: 'Conduct exit interview',            ownerRole: 'hr',       moduleKey: 'hr',      isBlocking: false, sortOrder: 5 },
  { taskKey: 'final_pay_review',    taskTitle: 'Review final pay & entitlements',   ownerRole: 'finance',  moduleKey: 'finance', isBlocking: true,  sortOrder: 6 },
  { taskKey: 'final_documents',     taskTitle: 'Issue final documents (letter, references)', ownerRole: 'hr', moduleKey: 'hr',  isBlocking: false, sortOrder: 7 },
];

const STANDARD_EXIT_HANDOFFS: PlanHandoff[] = [
  { handoffKey: 'it_access_removal', targetModule: 'it',      handoffType: 'access_removal', payload: {} },
  { handoffKey: 'finance_final_pay', targetModule: 'finance', handoffType: 'final_pay',      payload: {} },
  { handoffKey: 'hse_ppe_return',    targetModule: 'hse',     handoffType: 'ppe_return',     payload: {} },
];

/** Start an offboarding case: case → tasks → cross-module handoff intents. Idempotent
 *  on (employee, reason). THROWS on failure. */
export async function startOffboardingCase(actorId: string, args: StartOffboardingArgs): Promise<StartOffboardingResult> {
  const { data: emp } = await sb.from('app_users').select('id, supervisor_id')
    .eq('id', args.employeeId).maybeSingle<{ id: string; supervisor_id: string | null }>();
  if (!emp) throw Object.assign(new Error('Employee not found.'), { status: 404 });
  const ownerId = args.ownerId ?? actorId;
  const reason = args.reason as OffboardingReason;

  const result = await runModuleMutation<{ id: string; caseNo: string; taskCount: number; handoffCount: number }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'create', entityType: 'offboarding_case',
      idempotencyKey: `hr.offboarding.start:${args.employeeId}:${reason}`,
      eventType: 'offboarding.started', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.caseNo }),
      buildEventPayload: (r) => ({ employeeId: args.employeeId, reason, taskCount: r.taskCount, handoffCount: r.handoffCount }),
    },
    writeRecord: async () => {
      const caseNo = await nextRef('OFB');
      const { data: kase, error: cErr } = await sb.from('hr_offboarding_cases').insert({
        case_no: caseNo, employee_id: emp.id, reason, package_key: args.packageKey?.trim() || 'standard_exit',
        status: 'in_progress', owner_id: ownerId, last_working_day: args.lastWorkingDay ?? null,
        notice_period_days: args.noticePeriodDays ?? null, started_by: actorId,
      }).select('id, case_no').single<{ id: string; case_no: string }>();
      if (cErr) throw Object.assign(new Error(cErr.message), { status: 500 });

      const taskRows = STANDARD_EXIT_TASKS.map(t => ({
        case_id: kase.id, task_key: t.taskKey, task_title: t.taskTitle, owner_role: t.ownerRole, module_key: t.moduleKey,
        assigned_to: t.ownerRole === 'hr' ? ownerId : null, status: 'pending', is_blocking: t.isBlocking, sort_order: t.sortOrder,
      }));
      const { error: tErr } = await sb.from('hr_offboarding_tasks').insert(taskRows);
      if (tErr) { await sb.from('hr_offboarding_cases').delete().eq('id', kase.id); throw Object.assign(new Error(tErr.message), { status: 500 }); }

      const { error: hErr } = await sb.from('hr_offboarding_handoffs').insert(
        STANDARD_EXIT_HANDOFFS.map(h => ({ case_id: kase.id, handoff_key: h.handoffKey, target_module: h.targetModule, handoff_type: h.handoffType, status: 'pending', payload: { ...h.payload, employeeId: emp.id, caseNo } })),
      );
      if (hErr) { await sb.from('hr_offboarding_cases').delete().eq('id', kase.id); throw Object.assign(new Error(hErr.message), { status: 500 }); }

      await writeHrAudit({ employeeId: emp.id, submoduleKey: 'offboarding', recordId: kase.id, actorId,
        action: 'hr.offboarding.started', newState: { caseNo, reason, taskCount: taskRows.length } });
      return { id: kase.id, caseNo: kase.case_no, taskCount: taskRows.length, handoffCount: STANDARD_EXIT_HANDOFFS.length };
    },
  });

  for (const h of STANDARD_EXIT_HANDOFFS) {
    void emitAppEvent({ eventType: 'offboarding.handoff.created', sourceModule: 'hr', sourceEntityType: 'offboarding_case',
      sourceEntityId: result.entityId, actorUserId: actorId, severity: 'info', payload: { targetModule: h.targetModule, handoffType: h.handoffType } });
  }

  return { caseId: result.entityId, caseNo: result.record.caseNo, taskCount: result.record.taskCount, handoffCount: result.record.handoffCount };
}
