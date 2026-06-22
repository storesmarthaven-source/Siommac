/**
 * src/components/sections/HSE/risk-jsa/dialogs/SubmitForReviewDialog.tsx
 *
 * Submit a hazard / risk assessment / JSA for review. Routes to the matching
 * submit endpoint, which moves the record to "under review / submitted" and
 * creates (or advances) the review workflow.
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Modal, FormGrid, Field, TextareaInput } from '@ui';
import { useSubmitHazard, useSubmitAssessment, useSubmitJsa } from '@api/hse/riskJsa';

export type WorkflowEntity = 'hazard' | 'assessment' | 'jsa';

export interface SubmitForReviewDialogProps {
  open: boolean;
  onClose: () => void;
  entityType: WorkflowEntity;
  entityId: string;
  entityRef: string;
  entityTitle: string;
}

const LABELS: Record<WorkflowEntity, string> = {
  hazard:     'Hazard',
  assessment: 'Risk Assessment',
  jsa:        'JSA',
};

export function SubmitForReviewDialog({
  open, onClose, entityType, entityId, entityRef, entityTitle,
}: SubmitForReviewDialogProps): VNode | null {
  const [note,  setNote]  = useState('');
  const [error, setError] = useState('');

  const submitHazard     = useSubmitHazard();
  const submitAssessment = useSubmitAssessment();
  const submitJsa        = useSubmitJsa();
  const pending = submitHazard.isPending || submitAssessment.isPending || submitJsa.isPending;

  function handleClose() { setNote(''); setError(''); onClose(); }

  async function handleSubmit() {
    setError('');
    try {
      if (entityType === 'hazard')          await submitHazard.mutateAsync({ hazardId: entityId, note: note || undefined });
      else if (entityType === 'assessment') await submitAssessment.mutateAsync({ assessmentId: entityId, note: note || undefined });
      else                                  await submitJsa.mutateAsync({ jsaId: entityId, note: note || undefined });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit. Please try again.');
    }
  }

  return (
    <Modal
      open={open}
      title={`Submit ${LABELS[entityType]} for Review`}
      icon="fa-paper-plane"
      size="sm"
      onClose={handleClose}
      onSubmit={() => void handleSubmit()}
      submitLabel="Submit for Review"
      submitDisabled={pending}
    >
      <FormGrid>
        <Field label="Record" wide>
          <p style={{ margin: 0, fontSize: '0.85rem' }}><strong>{entityRef}</strong> — {entityTitle}</p>
        </Field>
        <Field label="Note to reviewer (optional)" wide>
          <TextareaInput value={note} onInput={setNote} rows={3}
            placeholder="Context for the reviewer — scope, urgency, outstanding items…" />
        </Field>
        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}

/** Shared inline error block for the workflow dialogs. */
export function DialogError({ message }: { message: string }): VNode {
  return (
    <div class="ui-field ui-field--wide">
      <p style={{
        color: 'var(--color-danger)', fontSize: '0.78rem', margin: 0,
        padding: '8px 12px', borderRadius: 'var(--radius-sm)',
        background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
      }}>
        <i class="fas fa-exclamation-triangle" style={{ marginRight: '6px' }} />{message}
      </p>
    </div>
  );
}
