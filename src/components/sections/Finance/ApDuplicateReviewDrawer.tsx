/**
 * src/components/sections/Finance/ApDuplicateReviewDrawer.tsx
 *
 * Duplicate-risk review queue drawer. Lists pending duplicate reviews and
 * lets an authorised user resolve each one:
 *   - Mark as duplicate → voids the newer (duplicate) bill.
 *   - Mark as distinct → resolves with a reason, keeps both bills.
 * Perm: finance.ap.duplicate.resolve.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { Drawer, HrfinPill, HrfinIcon } from '@ui';
import { useApDuplicateRisks, useResolveDuplicateRisk, type ApDuplicateReview } from '@api/finance/accountsPayable';
import { openActionModal } from '@/components/common/actions';

const MATCH_LABEL: Record<string, string> = {
  exact_invoice:    'Same invoice number',
  amount_date:      'Same amount + date',
  similar_invoice:  'Similar invoice number',
  attachment_hash:  'Duplicate attachment',
};

const CONF_TONE: Record<string, 'bad' | 'wn' | 'nu'> = {
  high: 'bad', medium: 'wn', low: 'nu',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenBill?: (billId: string) => void;
}

export function ApDuplicateReviewDrawer({ open, onClose, onOpenBill }: Props): VNode {
  const canResolve = can('finance.ap.duplicate.resolve');
  const risksQ = useApDuplicateRisks();
  const resolve = useResolveDuplicateRisk();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [noteError, setNoteError] = useState('');

  const risks = risksQ.data ?? [];
  const active = activeId ? risks.find(r => r.id === activeId) : null;

  async function handleResolve(review: ApDuplicateReview, resolution: 'resolved_duplicate' | 'resolved_distinct'): Promise<void> {
    if (resolution === 'resolved_duplicate' && !resolveNote.trim()) {
      setNoteError('A resolution note is required when marking as duplicate.');
      return;
    }
    const r = await openActionModal({
      title: resolution === 'resolved_duplicate' ? 'Mark as duplicate' : 'Mark as distinct',
      subtitle: review.originalBillNo ?? '',
      tone: resolution === 'resolved_duplicate' ? 'danger' : 'success',
      icon: resolution === 'resolved_duplicate' ? 'ban' : 'check',
      record: {
        title: resolution === 'resolved_duplicate'
          ? `Void ${review.duplicateBillNo ?? 'duplicate bill'}`
          : `Keep both bills`,
        subtitle: MATCH_LABEL[review.matchType] ?? review.matchType,
      },
      warning: resolution === 'resolved_duplicate'
        ? 'This will void the duplicate (newer) bill. This action cannot be undone.'
        : undefined,
      confirmLabel: resolution === 'resolved_duplicate' ? 'Void duplicate' : 'Mark distinct',
    });
    if (!r.confirmed) return;
    try {
      await resolve.mutateAsync({ reviewId: review.id, resolution, resolutionNote: resolveNote.trim() || undefined });
      toast(resolution === 'resolved_duplicate' ? 'Duplicate bill voided.' : 'Bills marked as distinct.');
      setActiveId(null);
      setResolveNote('');
      setNoteError('');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <Drawer
      open={open} onClose={onClose} panelClass="hrfin"
      title="Duplicate risk review" sub={`${risks.length} pending`}
    >
      {risksQ.isLoading && (
        <div class="hrfin-empty">Loading...</div>
      )}
      {!risksQ.isLoading && risks.length === 0 && (
        <div class="hrfin-empty"><HrfinIcon name="check" /> No duplicate risks pending.</div>
      )}

      {!active && risks.map(r => (
        <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.originalBillNo ?? 'Bill'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{MATCH_LABEL[r.matchType] ?? r.matchType}</div>
            </div>
            <HrfinPill tone={CONF_TONE[r.confidence] ?? 'nu'}>{r.confidence}</HrfinPill>
          </div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            Matches: <b>{r.duplicateBillNo ?? '—'}</b>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" class="hrfin-action is-primary" style={{ fontSize: 12 }} onClick={() => { setActiveId(r.id); setResolveNote(''); setNoteError(''); }}>
              Review
            </button>
            {onOpenBill && r.duplicateBillId && (
              <button type="button" class="hrfin-action" style={{ fontSize: 12 }} onClick={() => { onOpenBill(r.duplicateBillId!); }}>
                Open match
              </button>
            )}
          </div>
        </div>
      ))}

      {active && (
        <div>
          <button type="button" class="hrfin-action" style={{ marginBottom: 12 }} onClick={() => setActiveId(null)}>
            <HrfinIcon name="close" /> Back to list
          </button>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div class="hrfin-metric-row"><span>Original bill</span><b>{active.originalBillNo ?? '—'}</b></div>
            <div class="hrfin-metric-row"><span>Match bill</span><b>{active.duplicateBillNo ?? '—'}</b></div>
            <div class="hrfin-metric-row"><span>Match type</span><b>{MATCH_LABEL[active.matchType] ?? active.matchType}</b></div>
            <div class="hrfin-metric-row"><span>Confidence</span><HrfinPill tone={CONF_TONE[active.confidence] ?? 'nu'}>{active.confidence}</HrfinPill></div>
          </div>

          <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
            Resolution note {active.matchType !== 'amount_date' ? '' : '(required to mark duplicate)'}
          </label>
          <textarea
            class="hrfin-input"
            rows={3}
            placeholder="Explain why this is or isn't a duplicate..."
            value={resolveNote}
            onInput={e => { setResolveNote((e.target as HTMLTextAreaElement).value); setNoteError(''); }}
            style={{ width: '100%', marginBottom: 4, resize: 'vertical' }}
          />
          {noteError && <p style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{noteError}</p>}

          {canResolve && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                type="button" class="hrfin-action is-danger"
                disabled={resolve.isPending}
                onClick={() => void handleResolve(active, 'resolved_duplicate')}
              >
                Mark as duplicate (void)
              </button>
              <button
                type="button" class="hrfin-action is-primary"
                disabled={resolve.isPending}
                onClick={() => void handleResolve(active, 'resolved_distinct')}
              >
                Mark as distinct
              </button>
            </div>
          )}
          {!canResolve && (
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>You do not have permission to resolve duplicate risks.</p>
          )}
        </div>
      )}
    </Drawer>
  );
}
