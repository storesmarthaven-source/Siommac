/**
 * netlify/functions/lib/handoffBus.ts
 *
 * Cross-module handoff with reliable-delivery semantics.
 *
 * Calling route inserts a pending row into handoff_outbox.
 * The target module's /api/<module>/intake route queries handoff_inbox
 * (a view or direct outbox query) and marks rows processed.
 *
 * On permanent failure (attempts ≥ 3), status → 'manual_review' and
 * an admin notification is emitted.
 *
 * NEVER throws.
 */

import { sb }           from './db';
import { nextRef }      from './refGenerator';
import { emitAppEvent } from './appEvents';

export interface CreateHandoffInput {
  sourceModule:      string;
  targetModule:      string;
  sourceEntityType:  string;
  sourceEntityId:    string;
  targetEntityType?: string;
  payload:           Record<string, unknown>;
  createdBy?:        string;
}

export interface CreateHandoffResult {
  ok:        boolean;
  handoffId?: string;
}

export async function createHandoff(input: CreateHandoffInput): Promise<CreateHandoffResult> {
  try {
    const { data, error } = await sb
      .from('handoff_outbox')
      .insert({
        source_module:      input.sourceModule,
        target_module:      input.targetModule,
        source_entity_type: input.sourceEntityType,
        source_entity_id:   input.sourceEntityId,
        target_entity_type: input.targetEntityType ?? null,
        payload:            input.payload,
        status:             'pending',
        created_by:         input.createdBy ?? null,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) {
      console.error('[handoffBus] insert failed:', error?.message);
      return { ok: false };
    }

    // Emit handoff.created event (best-effort, silent — no notification)
    void emitAppEvent({
      eventType:        'handoff.created',
      sourceModule:     input.sourceModule,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId:   input.sourceEntityId,
      actorUserId:      input.createdBy ?? null,
      severity:         'info',
      payload:          { targetModule: input.targetModule, handoffId: data.id },
    });

    return { ok: true, handoffId: data.id };
  } catch (e) {
    console.error('[handoffBus] createHandoff failed:', e);
    return { ok: false };
  }
}

/**
 * Mark a handoff as completed by the target module's intake handler.
 */
export async function completeHandoff(handoffId: string, targetEntityId?: string): Promise<void> {
  await sb.from('handoff_outbox').update({
    status:           'completed',
    target_entity_id: targetEntityId ?? null,
    processed_at:     new Date().toISOString(),
  }).eq('id', handoffId).then(({ error }) => {
    if (error) console.warn('[handoffBus] completeHandoff failed:', error.message);
  });
}

/**
 * Mark a handoff as failed. After 3 attempts, escalate to manual_review.
 */
export async function failHandoff(handoffId: string, errorMessage: string): Promise<void> {
  try {
    const { data } = await sb
      .from('handoff_outbox')
      .select('attempts, source_module, target_module, source_entity_id, created_by')
      .eq('id', handoffId)
      .maybeSingle<{ attempts: number; source_module: string; target_module: string; source_entity_id: string; created_by: string | null }>();

    if (!data) return;

    const newAttempts = (data.attempts ?? 0) + 1;
    const newStatus = newAttempts >= 3 ? 'manual_review' : 'failed';

    await sb.from('handoff_outbox').update({
      status:   newStatus,
      attempts: newAttempts,
      error:    errorMessage.slice(0, 1000),
    }).eq('id', handoffId);

    if (newStatus === 'manual_review') {
      void emitAppEvent({
        eventType:        'handoff.failed',
        sourceModule:     data.source_module,
        sourceEntityType: 'handoff',
        sourceEntityId:   handoffId,
        actorUserId:      data.created_by,
        severity:         'critical',
        payload:          { targetModule: data.target_module, sourceEntityId: data.source_entity_id, error: errorMessage, attempts: newAttempts },
        notification: {
          title: 'Handoff failed — manual review required',
          body:  `Failed to deliver handoff from ${data.source_module} to ${data.target_module} for ${data.source_entity_id} (${newAttempts} attempts).`,
          actionRoute: 'admin/handoffs',
          type:  'handoff.failed',
        },
      });
    }
  } catch (e) {
    console.error('[handoffBus] failHandoff failed:', e);
  }
}

/**
 * List pending handoffs for a target module (used by intake handlers).
 */
export async function getPendingHandoffs(targetModule: string): Promise<PendingHandoff[]> {
  const { data } = await sb
    .from('handoff_outbox')
    .select('id, source_module, source_entity_type, source_entity_id, payload, attempts, created_at')
    .eq('target_module', targetModule)
    .in('status', ['pending', 'failed'])
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(50) as { data: PendingHandoff[] | null };

  return data ?? [];
}

export interface PendingHandoff {
  id:                 string;
  source_module:      string;
  source_entity_type: string;
  source_entity_id:   string;
  payload:            Record<string, unknown>;
  attempts:           number;
  created_at:         string;
}
