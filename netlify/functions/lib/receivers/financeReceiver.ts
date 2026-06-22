/**
 * netlify/functions/lib/receivers/financeReceiver.ts
 *
 * Handles handoffs targeted at the Finance module.
 * Creates a finance cost entry and emits a standard event.
 */

import { runModuleMutation }             from '../moduleServiceAdapter';
import { sb }                            from '../db';
import type { ModuleReceiver, HandoffReceiveInput, HandoffReceiveResult } from '../moduleRegistry';

export const financeReceiver: ModuleReceiver = {
  module: 'finance',

  async receiveHandoff(input: HandoffReceiveInput): Promise<HandoffReceiveResult> {
    const { payload, createdBy, sourceModule, sourceEntityType, sourceEntityId } = input;

    const result = await runModuleMutation<{ id: string }>({
      context: {
        actorUserId: createdBy,
      },
      options: {
        module:      'finance',
        operation:   'handoff_receive',
        entityType:  'cost_entry',
        idempotencyKey: `handoff:${sourceModule}:${sourceEntityType}:${sourceEntityId}:finance`,
        eventType:   'finance.cost_entry.created_from_handoff',
        eventSeverity: 'info',
        notification: {
          title: `Finance cost entry from ${sourceModule.toUpperCase()} handoff`,
          body:  `New cost entry pending review from ${sourceEntityId}.`,
          actionRoute: 'finance/costs',
          type:  'finance.cost_entry.created_from_handoff',
        },
        getEntityIdentity: (record) => ({ id: record.id }),
      },
      writeRecord: async () => {
        const { data, error } = await sb
          .from('finance_cost_entries')
          .insert({
            source_module:      sourceModule,
            source_entity_type: sourceEntityType,
            source_entity_id:   sourceEntityId,
            amount:             (payload['amount'] as number | undefined) ?? 0,
            currency:           (payload['currency'] as string | undefined) ?? 'TTD',
            cost_center_id:     (payload['costCenterId'] as string | undefined) ?? null,
            status:             'pending',
            description:        (payload['description'] as string | undefined) ?? 'Generated from module handoff.',
            created_by:         createdBy,
            metadata:           payload,
          })
          .select('id')
          .single<{ id: string }>();

        if (error || !data) throw error ?? new Error('Finance cost entry insert failed');
        return data;
      },
    });

    return {
      targetEntityType: 'cost_entry',
      targetEntityId:   result.entityId,
    };
  },
};
