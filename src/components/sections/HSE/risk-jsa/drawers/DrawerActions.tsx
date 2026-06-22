/**
 * src/components/sections/HSE/risk-jsa/drawers/DrawerActions.tsx
 *
 * Shared workflow-action footer for the Hazard / Risk Assessment / JSA drawers.
 * Renders the status-appropriate actions (Submit · Approve/Return · Raise CAPA ·
 * Add Control · Review/Renew · Archive) and owns the dialog state so all three
 * drawers behave identically. Every action goes through an authenticated
 * endpoint via the module-service-adapter pattern.
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Modal } from '@ui';
import { useRiskJsaReview } from '@api/hse/riskJsa';
import { SubmitForReviewDialog, type WorkflowEntity } from '../dialogs/SubmitForReviewDialog';
import { ApprovalDecisionDialog } from '../dialogs/ApprovalDecisionDialog';
import { LinkCapaDialog } from '../dialogs/LinkCapaDialog';
import { ReviewRenewDialog } from '../dialogs/ReviewRenewDialog';
import { AddControlDialog } from '../dialogs/AddControlDialog';

export interface DrawerActionsProps {
  entityType: WorkflowEntity;
  entityId: string;
  entityRef: string;
  entityTitle: string;
  status: string;
  /** Close the parent drawer (after archive). */
  onClose: () => void;
}

type OpenDialog = 'none' | 'submit' | 'approve' | 'capa' | 'control' | 'review' | 'archive';

const SUBMITTABLE = ['draft', 'registered', 'returned', 'assessment_required', 'controls_required'];
const DECIDABLE   = ['submitted', 'under_review', 'hse_review'];
const REVIEWABLE  = ['approved', 'active', 'monitoring'];

export function DrawerActions({
  entityType, entityId, entityRef, entityTitle, status, onClose,
}: DrawerActionsProps): VNode {
  const [open, setOpen] = useState<OpenDialog>('none');
  const review = useRiskJsaReview();

  const archived   = status === 'archived';
  const canSubmit  = SUBMITTABLE.includes(status);
  const canDecide  = DECIDABLE.includes(status);
  const canReview  = REVIEWABLE.includes(status);

  async function archive() {
    try {
      await review.mutateAsync({ entityType, entityId, outcome: 'archive' });
      setOpen('none');
      onClose();
    } catch { /* surfaced by mutation state; keep dialog open */ }
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' }}>
        <button class="hse-btn" onClick={onClose}>Close</button>

        {!archived && (
          <button class="hse-btn" onClick={() => setOpen('control')}>
            <i class="fas fa-shield-halved" /> Add Control
          </button>
        )}
        {!archived && (
          <button class="hse-btn" onClick={() => setOpen('capa')}>
            <i class="fas fa-list-check" /> Raise CAPA
          </button>
        )}
        {canReview && (
          <button class="hse-btn" onClick={() => setOpen('review')}>
            <i class="fas fa-rotate" /> Review / Renew
          </button>
        )}
        {!archived && !canSubmit && !canDecide && !canReview && (
          <button class="hse-btn" onClick={() => setOpen('archive')}>
            <i class="fas fa-box-archive" /> Archive
          </button>
        )}
        {canSubmit && (
          <button class="hse-btn primary" onClick={() => setOpen('submit')}>
            <i class="fas fa-paper-plane" /> Submit for Review
          </button>
        )}
        {canDecide && (
          <button class="hse-btn primary" onClick={() => setOpen('approve')}>
            <i class="fas fa-clipboard-check" /> Approval Decision
          </button>
        )}
      </div>

      <SubmitForReviewDialog open={open === 'submit'} onClose={() => setOpen('none')}
        entityType={entityType} entityId={entityId} entityRef={entityRef} entityTitle={entityTitle} />
      <ApprovalDecisionDialog open={open === 'approve'} onClose={() => setOpen('none')}
        entityType={entityType} entityId={entityId} entityRef={entityRef} entityTitle={entityTitle} />
      <LinkCapaDialog open={open === 'capa'} onClose={() => setOpen('none')}
        entityType={entityType} entityRef={entityRef} entityTitle={entityTitle} />
      <ReviewRenewDialog open={open === 'review'} onClose={() => setOpen('none')}
        entityType={entityType} entityId={entityId} entityRef={entityRef} entityTitle={entityTitle} />
      <AddControlDialog open={open === 'control'} onClose={() => setOpen('none')}
        sourceType={entityType} sourceId={entityId} />

      <Modal open={open === 'archive'} title={`Archive ${entityRef}?`} icon="fa-box-archive" size="sm"
        onClose={() => setOpen('none')} onSubmit={() => void archive()}
        submitLabel="Archive" submitDisabled={review.isPending}>
        <p style={{ fontSize: '0.85rem', margin: 0 }}>
          Archiving removes <strong>{entityTitle}</strong> from active registers. It stays in the
          audit trail and can be referenced, but no further workflow actions apply.
        </p>
      </Modal>
    </>
  );
}
