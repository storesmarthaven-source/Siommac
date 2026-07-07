/**
 * src/components/sections/Finance/ApStatusFilterMenu.tsx
 *
 * Quick status facet for the AP bills register — a small popover of status
 * options (incl. the computed "Overdue" facet). Controlled: the caller owns the
 * selected value and re-queries the server. Portalled with hrfin tokens in scope.
 */

import { type VNode } from 'preact';
import { createPortal } from 'preact/compat';
import { useOverlayA11y } from '@ui/lib/useOverlayA11y';
import { HrfinIcon } from '@ui';
import type { ApBillFilterStatus } from '@api/finance/accountsPayable';

export type BillStatusFacet = ApBillFilterStatus | 'all';

export const BILL_STATUS_LABEL: Record<BillStatusFacet, string> = {
  all: 'All', draft: 'Draft', submitted: 'Submitted', approved: 'Approved',
  overdue: 'Overdue', partially_paid: 'Partial', paid: 'Paid', rejected: 'Rejected', void: 'Void',
};

const OPTIONS: BillStatusFacet[] = ['all', 'draft', 'submitted', 'approved', 'overdue', 'partially_paid', 'paid', 'rejected', 'void'];

export function ApStatusFilterMenu({ open, value, onChange, onClose }: {
  open: boolean; value: BillStatusFacet; onChange: (v: BillStatusFacet) => void; onClose: () => void;
}): VNode | null {
  const ref = useOverlayA11y<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return createPortal(
    <div
      class="hrfin"
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,23,52,.28)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '92px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref} role="menu" aria-label="Filter bills by status"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 12px 32px rgba(16,24,64,.18)', width: '244px', padding: '6px' }}
      >
        <div style={{ padding: '8px 10px 6px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Filter by status</div>
        {OPTIONS.map(o => {
          const active = value === o;
          return (
            <button
              key={o} type="button" role="menuitemradio" aria-checked={active}
              onClick={() => { onChange(o); onClose(); }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 10px', border: 'none', background: active ? 'var(--page-bg)' : 'transparent', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text)', textAlign: 'left' }}
            >
              <span>{BILL_STATUS_LABEL[o]}</span>
              {active && <HrfinIcon name="check" />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
