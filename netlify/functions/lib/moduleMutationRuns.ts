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
    if (error) console.warn('[moduleMutationRuns] insert failed:', error.message);
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

  if (error) console.warn('[moduleMutationRuns] markStage failed:', error.message);
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

  if (error) console.warn('[moduleMutationRuns] complete failed:', error.message);
}

export async function failMutationRun(idempotencyKey: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown mutation failure';

  await sb
    .from('module_mutation_runs')
    .update({
      status:     'failed',
      stage:      'failed',
      error:      message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq('idempotency_key', idempotencyKey);
}
