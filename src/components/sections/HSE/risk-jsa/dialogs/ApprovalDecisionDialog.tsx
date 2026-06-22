/**
 * src/components/sections/HSE/risk-jsa/dialogs/ApprovalDecisionDialog.tsx
 *
 * Reviewer decision on a submitted hazard / assessment / JSA: Approve or
 * Return for revision. On approval an optional next-review date may be set.
 * Submits via the canonical /risk-jsa/review endpoint (useRiskJsaReview).
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Modal, FormGrid, Field, TextInput, TextareaInput } from '@ui';
import { useRiskJsaReview } from '@api/hse/riskJsa';
import { DialogError, type WorkflowEntity } from './SubmitForReviewDialog';

export interface ApprovalDecisionDialogProps {
  open: boolean;
  onClose: () => void;
  entityType: WorkflowEntity;
  entityId: string;
  entityRef: string;
  entityTitle: string;
}

export function ApprovalDecisionDialog({
  open, onClose, entityType, entityId, entityRef, entityTitle,
}: ApprovalDecisionDialogProps): VNode | null {
  const [decision, setDecision] = useState<'approve' | 'return'>('approve');
  const [note,     setNote]     = useState('');
  const [nextDue,  setNextDue]  = useState('');
  const [error,    setError]    = useState('');

  const review = useRiskJsaReview();

  function handleClose() { setDecision('approve'); setNote(''); setNextDue(''); setError(''); onClose(); }

  async function handleSubmit() {
    if (decision === 'return' && !note.trim()) { setError('A note is required when returning for revision.'); return; }
    setError('');
    try {
      await review.mutateAsync({
        entityType, entityId,
        outcome:         decision,
        note:            note || undefined,
        nextReviewDueAt: decision === 'approve' && nextDue ? new Date(nextDue).toISOString() : undefined,
      });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record decision. Please try again.');
    }
  }

  return (
    <Modal
      open={open}
      title="Approval Decision"
      icon="fa-clipboard-check"
      size="sm"
      onClose={handleClose}
      onSubmit={() => void handleSubmit()}
      submitLabel={decision === 'approve' ? 'Approve' : 'Return for Revision'}
      submitDisabled={review.isPending}
    >
      <FormGrid>
        <Field label="Record" wide>
          <p style={{ margin: 0, fontSize: '0.85rem' }}><strong>{entityRef}</strong> — {entityTitle}</p>
        </Field>

        <Field label="Decision" wide>
          <div style={{ display: 'flex', gap: '8px' }}>
            {([['approve', 'Approve', 'fa-circle-check'], ['return', 'Return', 'fa-rotate-left']] as const).map(([val, label, icon]) => (
              <button key={val} type="button"
                class={`hse-btn${decision === val ? ' primary' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setDecision(val)}>
                <i class={`fas ${icon}`} /> {label}
              </button>
            ))}
          </div>
        </Field>

        {decision === 'approve' && (
          <Field label="Next review due (optional)">
            <TextInput value={nextDue} onInput={setNextDue} type="date" />
          </Field>
        )}

        <Field label={decision === 'return' ? 'Reason for return *' : 'Note (optional)'} wide>
          <TextareaInput value={note} onInput={setNote} rows={3}
            placeholder={decision === 'return' ? 'What must be revised before re-submission…' : 'Approval comments…'} />
        </Field>

        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}
