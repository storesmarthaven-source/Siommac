/**
 * netlify/functions/lib/moduleServiceAdapter.ts
 *
 * Standard orchestration layer for every module mutation.
 * Replaces the manual record→event→workflow→handoff chain that was
 * duplicated in every route handler. Modules call runModuleMutation()
 * and declare options; the adapter handles sequencing and tracking.
 *
 * Pattern:
 *   route → requirePermission → runModuleMutation → response
 *
 * Every call writes a module_mutation_runs row so progress is observable,
 * failures are traceable, and duplicate requests are safely short-circuited.
 */

import { emitAppEvent }       from './appEvents';
import { createWorkflow }     from './workflowEngine';
import { createHandoff }      from './handoffBus';
import {
  startMutationRun,
  markMutationRunStage,
  completeMutationRun,
  failMutationRun,
} from './moduleMutationRuns';
import type { EventSeverity } from './appEvents';

// ── Public types ──────────────────────────────────────────────────────────────

export type ModuleKey =
  | 'hse' | 'hr' | 'payroll' | 'finance'
  | 'operations' | 'tickets' | 'messages' | 'reports';

export type WorkflowPriority = 'low' | 'medium' | 'high' | 'critical';

export type ModuleMutationOperation =
  | 'create' | 'update' | 'submit' | 'approve' | 'reject'
  | 'close' | 'cancel' | 'verify' | 'handoff_receive' | 'export';

export interface ModuleMutationContext {
  actorUserId:    string;
  siteId?:        string | null;
  departmentId?:  string | null;
}

export interface ModuleEntityIdentity {
  id:    string;
  ref?:  string;
}

export interface ModuleHandoffRequest {
  targetModule:      ModuleKey;
  targetEntityType?: string;
  payload:           Record<string, unknown>;
  /** When false the handoff is skipped. Omit or true to always create. */
  condition?:        boolean;
}

export interface ModuleWorkflowRequest {
  templateKey:    string;
  priority:       WorkflowPriority;
  ownerUserId?:   string | null;
  reason?:        string;
  /** When false the workflow is skipped. Omit or true to always create. */
  condition?:     boolean;
  metadata?:      Record<string, unknown>;
}

export interface ModuleMutationOptions<TRecord> {
  module:      ModuleKey;
  operation:   ModuleMutationOperation;
  entityType:  string;

  /** Unique key for idempotency — duplicate calls with same key are no-ops. */
  idempotencyKey: string;

  eventType:       string;
  eventSeverity?:  EventSeverity;
  eventPayload?:   Record<string, unknown>;
  notification?: {
    title:        string;
    body?:        string;
    actionRoute?: string;
    type?:        string;
  };
  explicitRecipients?: Array<{ userId: string; reason: 'assignee' | 'owner' | 'reporter' | 'supervisor' }>;

  workflow?:  ModuleWorkflowRequest;
  handoffs?:  ModuleHandoffRequest[];

  getEntityIdentity: (record: TRecord) => ModuleEntityIdentity;
  buildEventPayload?: (record: TRecord) => Record<string, unknown>;

  /** Called after all side-effects are complete — use for back-link updates. */
  afterCommit?: (result: ModuleMutationResult<TRecord>) => Promise<void>;
}

export interface ModuleMutationResult<TRecord> {
  record:      TRecord;
  entityId:    string;
  entityRef?:  string;
  eventId?:    string;
  workflowId?: string;
  handoffIds:  string[];
}

// ── Main adapter ──────────────────────────────────────────────────────────────

export async function runModuleMutation<TRecord>(args: {
  context:     ModuleMutationContext;
  options:     ModuleMutationOptions<TRecord>;
  writeRecord: () => Promise<TRecord>;
}): Promise<ModuleMutationResult<TRecord>> {
  const { context, options } = args;
  const { actorUserId } = context;

  const run = await startMutationRun({
    idempotencyKey: options.idempotencyKey,
    module:         options.module,
    operation:      options.operation,
    entityType:     options.entityType,
    actorUserId,
    requestPayload: {
      eventType:     options.eventType,
      eventSeverity: options.eventSeverity ?? 'info',
      workflow:      options.workflow ?? null,
      handoffs:      options.handoffs ?? [],
    },
  });

  if (run.existingCompletedResult) {
    return run.existingCompletedResult as unknown as ModuleMutationResult<TRecord>;
  }

  try {
    // Stage 1: write the business record
    const record   = await args.writeRecord();
    const identity = options.getEntityIdentity(record);

    await markMutationRunStage(options.idempotencyKey, {
      status:    'record_written',
      stage:     'record_written',
      entityId:  identity.id,
      entityRef: identity.ref,
    });

    // Stage 2: emit event + notifications
    const eventPayload: Record<string, unknown> = {
      ...(options.eventPayload ?? {}),
      ...(options.buildEventPayload ? options.buildEventPayload(record) : {}),
      entityRef:  identity.ref,
      operation:  options.operation,
    };

    const eventResult = await emitAppEvent({
      eventType:          options.eventType,
      sourceModule:       options.module,
      sourceEntityType:   options.entityType,
      sourceEntityId:     identity.id,
      actorUserId,
      siteId:             context.siteId ?? null,
      departmentId:       context.departmentId ?? null,
      severity:           options.eventSeverity ?? 'info',
      payload:            eventPayload,
      dedupeKey:          `${options.idempotencyKey}:event`,
      notification:       options.notification,
      ...(options.explicitRecipients ? { explicitRecipients: options.explicitRecipients } : {}),
    } as Parameters<typeof emitAppEvent>[0]);

    await markMutationRunStage(options.idempotencyKey, {
      status:      'event_emitted',
      stage:       'event_emitted',
      resultPatch: { eventId: eventResult.eventId },
    });

    // Stage 3: create workflow (if requested and condition not false)
    let workflowId: string | undefined;

    if (options.workflow && options.workflow.condition !== false) {
      const wfResult = await createWorkflow({
        templateKey:      options.workflow.templateKey,
        sourceModule:     options.module,
        sourceEntityType: options.entityType,
        sourceEntityId:   identity.id,
        priority:         options.workflow.priority,
        ownerUserId:      options.workflow.ownerUserId ?? undefined,
        createdBy:        actorUserId,
        reason:           options.workflow.reason,
        metadata:         options.workflow.metadata,
      });

      workflowId = wfResult.workflowId;

      await markMutationRunStage(options.idempotencyKey, {
        status:      'workflow_created',
        stage:       'workflow_created',
        resultPatch: { workflowId },
      });
    }

    // Stage 4: create handoffs (conditional)
    const handoffIds: string[] = [];

    for (const handoff of options.handoffs ?? []) {
      if (handoff.condition === false) continue;

      const hResult = await createHandoff({
        sourceModule:      options.module,
        targetModule:      handoff.targetModule,
        sourceEntityType:  options.entityType,
        sourceEntityId:    identity.id,
        targetEntityType:  handoff.targetEntityType,
        payload:           {
          ...handoff.payload,
          sourceRef:     identity.ref,
          sourceEventId: eventResult.eventId,
        },
        createdBy: actorUserId,
      });

      if (hResult.ok && hResult.handoffId) handoffIds.push(hResult.handoffId);
    }

    if (handoffIds.length > 0) {
      await markMutationRunStage(options.idempotencyKey, {
        status:      'handoffs_created',
        stage:       'handoffs_created',
        resultPatch: { handoffIds },
      });
    }

    const result: ModuleMutationResult<TRecord> = {
      record,
      entityId:   identity.id,
      entityRef:  identity.ref,
      eventId:    eventResult.eventId,
      workflowId,
      handoffIds,
    };

    // Stage 5: afterCommit (back-link updates, status transitions, etc.)
    if (options.afterCommit) {
      await options.afterCommit(result);
    }

    await completeMutationRun(options.idempotencyKey, result as unknown as Record<string, unknown>);

    return result;
  } catch (error) {
    await failMutationRun(options.idempotencyKey, error);
    throw error;
  }
}
