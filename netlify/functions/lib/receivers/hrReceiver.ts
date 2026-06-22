/**
 * netlify/functions/lib/receivers/hrReceiver.ts
 *
 * Handles handoffs targeted at the HR module.
 * Creates an HR case record and emits a standard event via the adapter.
 */

import { runModuleMutation }             from '../moduleServiceAdapter';
import { nextRef }                       from '../refGenerator';
import { sb }                            from '../db';
import type { ModuleReceiver, HandoffReceiveInput, HandoffReceiveResult } from '../moduleRegistry';

export const hrReceiver: ModuleReceiver = {
  module: 'hr',

  async receiveHandoff(input: HandoffReceiveInput): Promise<HandoffReceiveResult> {
    const { payload, createdBy, sourceModule, sourceEntityType, sourceEntityId } = input;

    const result = await runModuleMutation<{ id: string; ref: string }>({
      context: {
        actorUserId: createdBy,
      },
      options: {
        module:      'hr',
        operation:   'handoff_receive',
        entityType:  'case',
        idempotencyKey: `handoff:${sourceModule}:${sourceEntityType}:${sourceEntityId}:hr`,
        eventType:   'hr.case.created_from_handoff',
        eventSeverity: 'warning',
        notification: {
          title: `HR case created from ${sourceModule.toUpperCase()} handoff`,
          body:  `New HR case received from ${sourceEntityId}. Review and assign.`,
          actionRoute: 'hr/cases',
          type:  'hr.case.created_from_handoff',
        },
        getEntityIdentity: (record) => ({ id: record.id, ref: record.ref }),
      },
      writeRecord: async () => {
        const ref = await nextRef('HRC');

        const { data, error } = await sb
          .from('hr_cases')
          .insert({
            ref,
            source_module:      sourceModule,
            source_entity_type: sourceEntityType,
            source_entity_id:   sourceEntityId,
            case_type:          (payload['caseType'] as string | undefined) ?? 'hse_lost_time',
            employee_user_id:   (payload['employeeUserId'] as string | undefined) ?? null,
            title:              (payload['title'] as string | undefined) ?? `HR case from ${sourceEntityId}`,
            description:        (payload['description'] as string | undefined) ?? 'Generated from module handoff.',
            status:             'open',
            created_by:         createdBy,
            metadata:           payload,
          })
          .select('id, ref')
          .single<{ id: string; ref: string }>();

        if (error || !data) throw error ?? new Error('HR case insert failed');
        return data;
      },
    });

    return {
      targetEntityType: 'case',
      targetEntityId:   result.entityId,
      targetEntityRef:  result.entityRef,
    };
  },
};
