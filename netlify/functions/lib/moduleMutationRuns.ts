/**
 * netlify/functions/lib/moduleMutationRuns.ts
 *
 * Idempotency + progress tracking for runModuleMutation().
 * Every adapter call writes one module_mutation_runs row and advances its
 * status column through the orchestration stages so failures are recoverable
 * and observable without duplicate side-effects.
 *
 * Uses the module-level sb singleton (consistent with all other lib files).
 */

import { sb } from './db';

/**
 * When MUTATION_RUNS_STRICT is enabled, ledger write failures are re-thrown
 * instead of swallowed — turning a silent idempotency outage into a loud,
 * test-visible failure. Leave OFF in production (a ledger hiccup must never break
 * the underlying business mutation); turn ON for E2E / diagnostics, e.g.:
 *     MUTATION_RUNS_STRICT=1 npm run dev:netlify
 */
const STRICT =
  process.env.MUTATION_RUNS_STRICT === '1' ||
  process.env.MUTATION_RUNS_STRICT === 'true';

type RunWriteError = { message?: string; code?: string } | null | undefined;

/**
 * Surface a module_mutation_runs write failure. An error here means idempotency
 * + run tracking are NOT working, so it must never be swallowed silently. A
 * PGRST205 / "schema cache" error means the table is missing or unexposed; the
 * appended hint points straight at the remediation migration.
 *
 * `allowThrow` is false on the failure-recording path so a ledger write error
 * can't mask the original mutation error we were trying to record.
 */
function reportRunWriteFailure(op: string, error: RunWriteError, allowThrow = true): void {
  if (!error) return;
  const schemaCacheMiss =
    error.code === 'PGRST205' || /schema cache/i.test(error.message ?? '');
  const hint = schemaCacheMiss
    ? " — public.module_mutation_runs is missing/unexposed; apply supabase/migrations/20260629000000_expose_module_mutation_runs.sql then NOTIFY pgrst, 'reload schema';"
    : '';
  const msg = `[moduleMutationRuns] ${op} failed: ${error.message ?? 'unknown error'} [${error.code ?? 'n/a'}]${hint}`;
  console.error(msg);
  if (STRICT && allowThrow) throw new Error(msg);
}

interface StartMutationRunInput {
  idempotencyKey:  string;
  module:          string;
  operation:       string;
  entityType:      string;
  actorUserId:     string;
  requestPayload:  Record<string, unknown>;
}

interface StartMutationRunResult {
  existingCompletedResult: Record<string, unknown> | null;
}

export async function startMutationRun(input: StartMutationRunInput): Promise<StartMutationRunResult> {
  const { data: existing } = await sb
    .from('module_mutation_runs')
    .select('status, result_payload')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle<{ status: string; result_payload: Record<string, unknown> }>();

  if (existing?.status === 'completed') {
    return { existingCompletedResult: existing.result_payload };
  }

  if (!existing) {
    const { error } = await sb.from('module_mutation_runs').insert({
      idempotency_key: input.idempotencyKey,
      module:          input.module,
      operation:       input.operation,
      entity_type:     input.entityType,
      actor_user_id:   input.actorUserId,
      request_payload: input.requestPayload,
      status:          'started',
      stage:           'started',
      updated_at:      new Date().toISOString(),
    });
    reportRunWriteFailure('insert', error);
  }

  return { existingCompletedResult: null };
}

interface MarkStageInput {
  status:       string;
  stage:        string;
  entityId?:    string;
  entityRef?:   string;
  resultPatch?: Record<string, unknown>;
}

export async function markMutationRunStage(idempotencyKey: string, input: MarkStageInput): Promise<void> {
  const { data: current } = await sb
    .from('module_mutation_runs')
    .select('result_payload')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle<{ result_payload: Record<string, unknown> }>();

  const resultPayload = {
    ...(current?.result_payload ?? {}),
    ...(input.resultPatch ?? {}),
  };

  const { error } = await sb
    .from('module_mutation_runs')
    .update({
      status:     input.status,
      stage:      input.stage,
      entity_id:  input.entityId,
      entity_ref: input.entityRef,
      result_payload: resultPayload,
      updated_at: new Date().toISOString(),
    })
    .eq('idempotency_key', idempotencyKey);

  reportRunWriteFailure('markStage', error);
}

export async function completeMutationRun(idempotencyKey: string, result: Record<string, unknown>): Promise<void> {
  const { error } = await sb
    .from('module_mutation_runs')
    .update({
      status:         'completed',
      stage:          'completed',
      result_payload: result,
      updated_at:     new Date().toISOString(),
    })
    .eq('idempotency_key', idempotencyKey);

  reportRunWriteFailure('complete', error);
}

export async function failMutationRun(idempotencyKey: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown mutation failure';

  const { error: writeErr } = await sb
    .from('module_mutation_runs')
    .update({
      status:     'failed',
      stage:      'failed',
      error:      message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq('idempotency_key', idempotencyKey);

  // Log but never throw here — this runs inside the catch path, and throwing
  // would mask the original mutation error we're trying to record.
  reportRunWriteFailure('fail', writeErr, false);
}
