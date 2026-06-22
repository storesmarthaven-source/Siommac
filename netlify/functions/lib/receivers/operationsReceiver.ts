/**
 * netlify/functions/lib/receivers/operationsReceiver.ts
 *
 * Handles handoffs targeted at the Operations module.
 * Creates a work order with assignment workflow and emits a standard event.
 */

import { runModuleMutation }             from '../moduleServiceAdapter';
import { nextRef }                       from '../refGenerator';
import { sb }                            from '../db';
import type { ModuleReceiver, HandoffReceiveInput, HandoffReceiveResult } from '../moduleRegistry';

export const operationsReceiver: ModuleReceiver = {
  module: 'operations',

  async receiveHandoff(input: HandoffReceiveInput): Promise<HandoffReceiveResult> {
    const { payload, createdBy, sourceModule, sourceEntityType, sourceEntityId } = input;
    const priority = (payload['priority'] as string | undefined) ?? 'medium';

    const result = await runModuleMutation<{ id: string; ref: string }>({
      context: {
        actorUserId: createdBy,
      },
      options: {
        module:      'operations',
        operation:   'handoff_receive',
        entityType:  'work_order',
        idempotencyKey: `handoff:${sourceModule}:${sourceEntityType}:${sourceEntityId}:operations`,
        eventType:   'operations.work_order.created_from_handoff',
        eventSeverity: priority === 'critical' ? 'critical' : 'warning',
        notification: {
          title: `Work order from ${sourceModule.toUpperCase()} handoff`,
          body:  `New work order requires assignment from ${sourceEntityId}.`,
          actionRoute: 'operations/work-orders',
          type:  'operations.work_order.created_from_handoff',
        },
        workflow: {
          templateKey: 'ops_work_order_assignment',
          priority:    priority === 'critical' ? 'critical' : 'medium',
          reason:      `Work order generated from ${sourceModule} handoff: ${sourceEntityId}`,
          condition:   true,
        },
        getEntityIdentity: (record) => ({ id: record.id, ref: record.ref }),
      },
      writeRecord: async () => {
        const ref = await nextRef('OWO');

        const { data, error } = await sb
          .from('ops_work_orders')
          .insert({
            ref,
            source_module:      sourceModule,
            source_entity_type: sourceEntityType,
            source_entity_id:   sourceEntityId,
            site_id:            (payload['siteId'] as string | undefined) ?? null,
            asset_id:           (payload['assetId'] as string | undefined) ?? null,
            title:              (payload['title'] as string | undefined) ?? `Work order from ${sourceEntityId}`,
            description:        (payload['description'] as string | undefined) ?? 'Generated from module handoff.',
            status:             'open',
            priority,
            due_at:             (payload['dueAt'] as string | undefined) ?? null,
            created_by:         createdBy,
            metadata:           payload,
          })
          .select('id, ref')
          .single<{ id: string; ref: string }>();

        if (error || !data) throw error ?? new Error('Work order insert failed');
        return data;
      },
    });

    return {
      targetEntityType: 'work_order',
      targetEntityId:   result.entityId,
      targetEntityRef:  result.entityRef,
    };
  },
};
