// workflow-outbox-worker.ts — Netlify scheduled function
//
// Every-minute recovery pass over the workflow transactional outbox
// (lib/workflow/outboxWorker.ts). The decide route processes its own transition
// in-request on the happy path — this schedule exists for the unhappy ones:
//
//   • jobs whose in-request processing failed (status='pending', backoff elapsed)
//   • jobs whose worker crashed mid-run (status='processing', lease expired —
//     workflow_outbox_claim reclaims those with a FRESH fencing lease_token, so
//     the crashed worker can never resume and clobber the outcome)
//
// Failures re-schedule with capped exponential backoff; at max_attempts the job
// dead-letters (workflow stays GATED via active_transition_id until an admin
// replays it) and a critical workflow.transition_failed notification is emitted
// — all handled inside processWorkflowOutbox.

import './lib/bootstrapEnv'; // must be first — see that module for why
import { schedule } from '@netlify/functions';
import { registerModulesOnce } from './lib/registerModules';
import { processWorkflowOutbox } from './lib/workflow/outboxWorker';

interface ScheduleEvent { headers?: Record<string, string | undefined> }

export const handler = schedule('* * * * *', async (event: ScheduleEvent) => {
  if (event.headers?.['x-netlify-event'] !== 'schedule') {
    return { statusCode: 403, body: 'scheduled invocation only' };
  }
  // Terminal transitions without a receipt RPC fall back to module adapter
  // callbacks — the same registration api.ts uses (idempotent).
  registerModulesOnce();
  const summary = await processWorkflowOutbox('scheduled', 20);
  if (summary.claimed > 0) {
    console.info(`[workflow-outbox-worker] claimed=${summary.claimed} completed=${summary.completed} failed=${summary.failed} deadLettered=${summary.deadLettered}`);
  }
  return { statusCode: 200, body: JSON.stringify(summary) };
});
