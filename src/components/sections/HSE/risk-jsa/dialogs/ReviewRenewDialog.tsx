/**
 * src/components/sections/HSE/risk-jsa/dialogs/ReviewRenewDialog.tsx
 *
 * Periodic review / renewal of an approved hazard, assessment or JSA. Confirms
 * the record is still valid, records an effectiveness rating, and sets the next
 * review date. Submits via /risk-jsa/review (outcome=approve + nextReviewDueAt).
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Modal, FormGrid, Field, TextInput, SelectInput, TextareaInput } from '@ui';
import { useRiskJsaReview } from '@api/hse/riskJsa';
import { DialogError, type WorkflowEntity } from './SubmitForReviewDialog';

export interface ReviewRenewDialogProps {
  open: boolean;
  onClose: () => void;
  entityType: WorkflowEntity;
  entityId: string;
  entityRef: string;
  entityTitle: string;
}

const EFFECTIVENESS = [
  { value: 'effective',           label: 'Controls effective' },
  { value: 'partially_effective', label: 'Partially effective' },
  { value: 'ineffective',         label: 'Ineffective — re-assess' },
];

export function ReviewRenewDialog({
  open, onClose, entityType, entityId, entityRef, entityTitle,
}: ReviewRenewDialogProps): VNode | null {
  const [nextDue,       setNextDue]       = useState('');
  const [effectiveness, setEffectiveness] = useState('effective');
  const [note,          setNote]          = useState('');
  const [error,         setError]         = useState('');

  const review = useRiskJsaReview();
  const isValid = nextDue.length > 0;

  function handleClose() { setNextDue(''); setEffectiveness('effective'); setNote(''); setError(''); onClose(); }

  async function handleSubmit() {
    if (!isValid) { setError('Set the next review date to renew.'); return; }
    setError('');
    try {
      await review.mutateAsync({
        entityType, entityId,
        outcome:             'approve',
        note:                note || undefined,
        nextReviewDueAt:     new Date(nextDue).toISOString(),
        effectivenessResult: effectiveness as 'effective' | 'partially_effective' | 'ineffective',
      });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to renew. Please try again.');
    }
  }

  return (
    <Modal
      open={open}
      title="Review & Renew"
      icon="fa-rotate"
      size="sm"
      onClose={handleClose}
      onSubmit={() => void handleSubmit()}
      submitLabel="Confirm Review"
      submitDisabled={review.isPending || !isValid}
    >
      <FormGrid>
        <Field label="Record" wide>
          <p style={{ margin: 0, fontSize: '0.85rem' }}><strong>{entityRef}</strong> — {entityTitle}</p>
        </Field>

        <Field label="Control effectiveness *">
          <SelectInput value={effectiveness} onInput={setEffectiveness} options={EFFECTIVENESS} />
        </Field>

        <Field label="Next review due *">
          <TextInput value={nextDue} onInput={setNextDue} type="date" />
        </Field>

        <Field label="Review note (optional)" wide>
          <TextareaInput value={note} onInput={setNote} rows={3}
            placeholder="Findings of the periodic review — changes, new hazards, control status…" />
        </Field>

        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}
