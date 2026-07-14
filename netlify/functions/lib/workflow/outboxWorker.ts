// ============================================================================
// Central Workflow Engine — transactional-outbox worker (finding #2)
// ============================================================================
// Processes workflow_outbox jobs enqueued by workflow_decide_task_tx. Each job
// carries a transition the RPC committed atomically; this worker runs the parts
// that CANNOT live in Postgres — next-step resolution (resolveNext/assignees)
// and the module source mutation — then commits the workflow-side outcome via
// the fenced workflow_finalize_transition_tx RPC.
//
// Exactly-once discipline:
//   • claim   — workflow_outbox_claim (FOR UPDATE SKIP LOCKED) stamps a fencing
//               lease_token; every subsequent write presents it, so a reclaimed-
//               then-resumed worker can never clobber a newer worker's outcome.
//   • source  — modules with a receipt RPC (finance_payroll…) commit their whole
//               source mutation + receipt in ONE transaction keyed by
//               transition_id; a retry returns the stored result and writes
//               nothing. Modules not yet converted fall back to their legacy
//               adapter callback (at-least-once — tracked follow-on wave).
//   • finalize— idempotent re-entry; runs BEFORE notification delivery so a
//               notify hiccup retries delivery without re-finalizing.
//   • notify  — after finalize, via deliverEventNotifications (the RPC owns the
//               app_events row) + per-user dedupe_key idempotency in notify().
//   • complete/fail — fenced; fail applies capped backoff and dead-letters at
//               max_attempts, leaving the instance GATED for admin recovery.
//
// Invariant: an instance never reaches a terminal/advanced state unless its
// source mutation already committed (receipt path) or its adapter returned
// without throwing (legacy path).
// ============================================================================

import { sb } from '../db';
import { deliverEventNotifications, emitAppEvent } from '../appEvents';
import { resolveNext } from './transitions';
import { getWorkflowAdapter } from './adapterRegistry';
import {
  buildTaskRowForStep, workflowToContext, ownerRecipients, moduleRoute,
  type WorkflowRow,
} from './service';
import type { WorkflowTemplateDefinition } from './definitionTypes';

interface OutboxJob {
  id: string; transition_id: string; status: string; attempts: number;
  max_attempts: number; lease_token: string; locked_by: string | null;
}
interface TransitionRow {
  id: string; workflow_id: string; task_id: string | null; kind: string;
  decision: string | null; actor_id: string | null; input_hash: string; status: string;
}

// ── Source-transition dispatch ────────────────────────────────────────────────
// Modules whose terminal source mutation goes through a transactional receipt
// RPC (exactly-once). Key: `${module_key}:${workflow_type}`. Everything else
// falls back to the legacy adapter callback until its receipt RPC lands.
type ReceiptOutcome = 'approved' | 'returned' | 'rejected';
interface SourceTransitionHandler {
  /** Commit the source mutation atomically (receipt-guarded). */
  commit(args: { transitionId: string; sourceRecordId: string; actorId: string;
                 outcome: ReceiptOutcome; comment: string | null; inputHash: string }): Promise<void>;
  /** Post-commit, idempotent notification fan-out (dedupe-keyed). */
  afterCommit?(args: { sourceRecordId: string; actorId: string; outcome: ReceiptOutcome }): Promise<void>;
}

const RECEIPT_HANDLERS: Record<string, SourceTransitionHandler> = {
  'finance_payroll:finance_payroll_approval': {
    async commit({ transitionId, sourceRecordId, actorId, outcome, comment, inputHash }) {
      const { error } = await sb.rpc('finance_payroll_workflow_transition_tx', {
        p_transition_id: transitionId, p_run_id: sourceRecordId, p_actor_id: actorId,
        p_target_status: outcome, p_comment: comment, p_input_hash: inputHash,
      });
      if (error) throw Object.assign(new Error(`payroll source transition: ${error.message}`), { code: (error as { code?: string }).code });
    },
    async afterCommit({ sourceRecordId, actorId, outcome }) {
      if (outcome !== 'approved') return;
      // "Ready to lock" notifications (handoff intent is already in the receipt RPC).
      // Dynamic import avoids a static cycle (payrollRuns → workflow service → worker).
      const [{ getPayrollRun }, { notify }, { notifyUsersByRole }] = await Promise.all([
        import('../finance/payrollRuns.js'), import('../notify.js'), import('../finance/financeEvents.js'),
      ]);
      const run = await getPayrollRun(sourceRecordId);
      if (!run) return;
      if (run.createdBy && run.createdBy !== actorId) {
        void notify({
          userId: run.createdBy, type: 'finance.payroll.run.approved',
          title: `Payroll run ${run.runNo} approved`,
          body: `Period ${run.periodMonth.slice(0, 7)} payroll run has been approved. It is ready to lock.`,
          module: 'finance_payroll', severity: 'success',
          sourceType: 'payroll_run', sourceId: run.id,
          dedupeKey: `payroll_run.approved.${run.id}`,
        });
      }
      void notifyUsersByRole('finance_manager', {
        type: 'finance.payroll.run.approved',
        title: `Payroll run ${run.runNo} approved — ready to lock`,
        body: `Period ${run.periodMonth.slice(0, 7)} payroll run is approved. Lock the run to generate payslips.`,
        module: 'finance_payroll', severity: 'success',
        sourceType: 'payroll_run', sourceId: run.id,
        dedupeKey: `payroll_run.approved.mgr.${run.id}`,
      });
    },
  },
};

/** Run the module's source mutation for a terminal outcome — receipt RPC when
 *  registered, legacy adapter callback otherwise. MUST happen before finalize. */
async function runSourceTransition(wf: WorkflowRow, tr: TransitionRow, outcome: ReceiptOutcome, comment: string | null): Promise<SourceTransitionHandler | null> {
  const handler = RECEIPT_HANDLERS[`${wf.module_key}:${wf.workflow_type}`] ?? null;
  if (handler) {
    await handler.commit({
      transitionId: tr.id, sourceRecordId: wf.source_record_id,
      actorId: tr.actor_id ?? 'workflow', outcome, comment, inputHash: tr.input_hash,
    });
    return handler;
  }
  const adapter = getWorkflowAdapter(wf.module_key, wf.workflow_type);
  if (!adapter) return null;
  if (outcome === 'approved') await adapter.onWorkflowCompleted({ workflowId: wf.id, sourceRecordId: wf.source_record_id, finalDecision: 'approved' });
  else if (outcome === 'returned') await adapter.onWorkflowReturned({ workflowId: wf.id, sourceRecordId: wf.source_record_id, comment: comment ?? '' });
  else await adapter.onWorkflowRejected({ workflowId: wf.id, sourceRecordId: wf.source_record_id, comment: comment ?? '' });
  return null;
}

// ── Finalize helpers ──────────────────────────────────────────────────────────

async function finalize(job: OutboxJob, args: {
  finalStatus: 'in_progress' | 'completed' | 'returned' | 'rejected';
  nextStepKey?: string | null; newTasks?: Record<string, unknown>[];
  action: string; eventPayload?: Record<string, unknown>; handoffs?: Record<string, unknown>[];
}): Promise<{ eventId: string | null; alreadyFinal: boolean }> {
  const { data, error } = await sb.rpc('workflow_finalize_transition_tx', {
    p_transition_id: job.transition_id, p_lease_token: job.lease_token,
    p_final_status: args.finalStatus, p_next_step_key: args.nextStepKey ?? null,
    p_new_tasks: args.newTasks ?? [], p_action: args.action,
    p_event_payload: args.eventPayload ?? {}, p_handoffs: args.handoffs ?? [],
  });
  if (error) throw Object.assign(new Error(`finalize: ${error.message}`), { code: (error as { code?: string }).code });
  const r = (data ?? {}) as { eventId?: string | null; alreadyFinal?: boolean };
  return { eventId: r.eventId ?? null, alreadyFinal: r.alreadyFinal ?? false };
}

const TERMINAL: Record<string, { finalStatus: 'completed' | 'returned' | 'rejected'; outcome: ReceiptOutcome; action: string;
  severity: 'success' | 'warning'; title: string; verb: string; actionRequired?: boolean }> = {
  finalize_completed: { finalStatus: 'completed', outcome: 'approved', action: 'workflow.completed', severity: 'success',  title: 'Workflow approved',  verb: 'was approved' },
  finalize_returned:  { finalStatus: 'returned',  outcome: 'returned', action: 'workflow.returned',  severity: 'warning',  title: 'Workflow returned',  verb: 'was returned', actionRequired: true },
  finalize_rejected:  { finalStatus: 'rejected',  outcome: 'rejected', action: 'workflow.rejected',  severity: 'warning',  title: 'Workflow rejected',  verb: 'was rejected' },
};

/** Terminal path: source mutation → fenced finalize (with durable handoff intent)
 *  → notification delivery. `kindOverride` lets resolve_approved_step reuse this
 *  when resolveNext says the workflow completes. */
async function processTerminal(job: OutboxJob, wf: WorkflowRow, tr: TransitionRow, kind: string, comment: string | null): Promise<void> {
  const t = TERMINAL[kind];
  if (!t) throw new Error(`unknown terminal kind ${kind}`);

  const handler = await runSourceTransition(wf, tr, t.outcome, comment);

  // Handoffs declared on the template fire on completion (parity with the legacy
  // runWorkflowHandoffs, which only ran for 'workflow.completed').
  const handoffs = t.finalStatus !== 'completed' ? [] :
    ((wf.template_snapshot.handoffs ?? []).filter(h => h.event === 'workflow.completed').map(h => ({
      target_module: h.targetModule, action: h.action, fieldMap: h.fieldMap ?? {},
      payload: { ...wf.source_snapshot, action: h.action, mappedFields: h.fieldMap ?? {} },
    })));

  const { eventId, alreadyFinal } = await finalize(job, {
    finalStatus: t.finalStatus, action: t.action,
    eventPayload: { moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, decision: tr.decision, comment },
    handoffs,
  });

  if (!alreadyFinal || eventId) {
    // Delivery is idempotent (per-user dedupe keys) — safe on retry.
    await deliverEventNotifications({
      eventType: t.action, sourceModule: 'workflow', sourceEntityType: 'workflow',
      sourceEntityId: wf.workflow_no ?? wf.id, actorUserId: tr.actor_id, severity: t.severity,
      explicitRecipients: ownerRecipients(wf),
      notification: {
        title: t.title,
        body: `${wf.workflow_no ?? ''} — ${wf.source_record_ref ?? wf.source_record_id} ${t.verb}${comment ? `: ${comment}` : ''}.`,
        actionRoute: moduleRoute(wf.module_key), type: t.action,
        ...(t.actionRequired ? { actionRequired: true } : {}),
      },
    } as Parameters<typeof deliverEventNotifications>[0], eventId);
    await handler?.afterCommit?.({ sourceRecordId: wf.source_record_id, actorId: tr.actor_id ?? 'workflow', outcome: t.outcome });
  }
}

/** Advance path: resolveNext in TS; either the workflow completes (→ terminal)
 *  or the next step's tasks are resolved and committed via finalize. */
async function processAdvance(job: OutboxJob, wf: WorkflowRow, tr: TransitionRow, comment: string | null): Promise<void> {
  const stepKey = await taskStepKey(tr);
  const { nextSteps, complete } = resolveNext(
    wf.template_snapshot as WorkflowTemplateDefinition, stepKey, 'approved',
    { workflow: wf, recordData: wf.source_snapshot },
  );

  if (complete || nextSteps.length === 0) {
    await processTerminal(job, wf, tr, 'finalize_completed', comment);
    return;
  }

  const context = workflowToContext(wf);
  const newTasks = nextSteps.map(step => buildTaskRowForStep(step, context));
  await finalize(job, {
    finalStatus: 'in_progress', nextStepKey: nextSteps[0]!.stepKey, newTasks,
    action: 'workflow.step.advanced',
    eventPayload: { fromStep: stepKey, toStep: nextSteps[0]!.stepKey, moduleKey: wf.module_key },
  });
}

async function taskStepKey(tr: TransitionRow): Promise<string> {
  if (!tr.task_id) throw new Error('transition has no task');
  const { data, error } = await sb.from('workflow_tasks').select('step_key, decision_comment').eq('id', tr.task_id).single<{ step_key: string; decision_comment: string | null }>();
  if (error || !data) throw new Error(`task ${tr.task_id} not found for transition ${tr.id}`);
  return data.step_key;
}

// ── The worker ────────────────────────────────────────────────────────────────

export interface OutboxRunSummary { claimed: number; completed: number; failed: number; deadLettered: number }

/** Claim + process up to `limit` outbox jobs. Never throws — every job outcome
 *  is recorded on the job itself (completed / retry-scheduled / dead_letter).
 *  `onlyTransitionId` targets a single transition's job (the in-request happy path),
 *  so a busy global queue can't starve the caller's own decision. */
export async function processWorkflowOutbox(workerId: string, limit = 10, onlyTransitionId?: string): Promise<OutboxRunSummary> {
  const summary: OutboxRunSummary = { claimed: 0, completed: 0, failed: 0, deadLettered: 0 };

  const { data: jobs, error: claimErr } = await sb.rpc('workflow_outbox_claim', {
    p_worker_id: workerId, p_limit: limit, p_transition_id: onlyTransitionId ?? null,
  });
  if (claimErr) { console.error('[wf-outbox] claim failed:', claimErr.message); return summary; }

  for (const job of (jobs ?? []) as OutboxJob[]) {
    summary.claimed++;
    try {
      const { data: tr } = await sb.from('workflow_transitions').select('*').eq('id', job.transition_id).single<TransitionRow>();
      if (!tr) throw new Error(`transition ${job.transition_id} not found`);
      const { data: wf } = await sb.from('workflow_instances').select('*').eq('id', tr.workflow_id).single<WorkflowRow>();
      if (!wf) throw new Error(`workflow ${tr.workflow_id} not found`);
      const comment = tr.task_id
        ? (await sb.from('workflow_tasks').select('decision_comment').eq('id', tr.task_id).maybeSingle<{ decision_comment: string | null }>()).data?.decision_comment ?? null
        : null;

      if (tr.kind === 'resolve_approved_step') await processAdvance(job, wf, tr, comment);
      else if (tr.kind === 'finalize_returned' || tr.kind === 'finalize_rejected') await processTerminal(job, wf, tr, tr.kind, comment);
      else throw new Error(`unexpected transition kind ${tr.kind}`);

      const { error: doneErr } = await sb.rpc('workflow_outbox_complete', { p_transition_id: job.transition_id, p_lease_token: job.lease_token });
      if (doneErr) throw Object.assign(new Error(`outbox complete: ${doneErr.message}`), { code: (doneErr as { code?: string }).code });
      summary.completed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // WF409 here = our lease is stale (a newer worker owns the job) — do NOT
      // fail the job; the current lease-holder owns the outcome.
      if ((e as { code?: string }).code === 'WF409') { console.warn('[wf-outbox] stale lease, skipping:', job.transition_id); continue; }
      const { data: failRes, error: failErr } = await sb.rpc('workflow_outbox_fail', {
        p_transition_id: job.transition_id, p_lease_token: job.lease_token, p_error: msg,
      });
      if (failErr) { console.error('[wf-outbox] fail-record failed:', failErr.message); continue; }
      summary.failed++;
      const f = (failRes ?? {}) as { deadLetter?: boolean; attempts?: number };
      if (f.deadLetter) {
        summary.deadLettered++;
        // Dead-letter ops surface: durable critical event + admin notification.
        void emitAppEvent({
          eventType: 'workflow.transition_failed', sourceModule: 'workflow',
          sourceEntityType: 'workflow_transition', sourceEntityId: job.transition_id,
          severity: 'critical',
          payload: { transitionId: job.transition_id, attempts: f.attempts, error: msg.slice(0, 500) },
          dedupeKey: `workflow.transition_failed:${job.transition_id}`,
          notification: {
            title: 'Workflow transition failed — manual recovery required',
            body: `A workflow transition exhausted its retries and is dead-lettered. The workflow stays gated until replayed. (${msg.slice(0, 160)})`,
            actionRoute: 'admin/workflows', type: 'workflow.transition_failed', actionRequired: true,
          },
        } as Parameters<typeof emitAppEvent>[0]);
      }
    }
  }
  return summary;
}

/** Process until a specific transition settles (used by the in-request happy
 *  path after decide). Returns true when the transition reached 'completed'. */
export async function processTransitionInline(transitionId: string): Promise<boolean> {
  await processWorkflowOutbox(`inline:${transitionId.slice(0, 8)}`, 1, transitionId);
  const { data } = await sb.from('workflow_transitions').select('status').eq('id', transitionId).maybeSingle<{ status: string }>();
  return data?.status === 'completed';
}
