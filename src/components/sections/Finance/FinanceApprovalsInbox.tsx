/**
 * src/components/sections/Finance/FinanceApprovalsInbox.tsx
 *
 * Chunk 11 — Cross-module Finance Approvals Inbox.
 * Shows pending approvals from Bills, Expenses, Remittances, and Disbursements.
 *
 * Per spec §2 Chunk 11:
 *   - Inline Approve/Reject only where `userCanApprove` is true AND the module
 *     supports the action (SoD-checked server-side).
 *   - Where approval/reject is unavailable → "Open" only (never fake).
 *   - Reject requires a reason (via openRejectModal).
 *   - On success: invalidates overview + AP cache keys, shows toast.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { HrfinTable, HrfinPill, type HrfinColumn, type HrfinTone } from '@ui';
import {
  useApprovalsQueue,
  useActOnApproval,
  type ApprovalsQueueFilters,
  type ApprovalsQueueItemV2,
} from '@api/finance/overview';
import { openApproveModal, openRejectModal } from './FinanceApprovalActionModal';
import { money } from './hrfinFormat';

const go = (id: string): void => { window.dispatchEvent(new CustomEvent('siomac:section', { detail: id })); };

const TYPE_TONES: Record<ApprovalsQueueItemV2['type'], HrfinTone> = {
  Bill: 'nu',
  Expense: 'ok',
  Remittance: 'wn',
  Disbursement: 'nu',
};

interface Props {
  /** Initial filter for the inbox (optional — defaults to all types). */
  initialType?: ApprovalsQueueItemV2['type'];
}

export function FinanceApprovalsInbox({ initialType }: Props): VNode {
  const [filters, setFilters] = useState<ApprovalsQueueFilters>(
    initialType ? { type: initialType } : {},
  );

  const queueQ = useApprovalsQueue(filters);
  const actMut = useActOnApproval();
  const loading = queueQ.isPending;
  const items   = queueQ.data ?? [];

  const handleApprove = async (item: ApprovalsQueueItemV2): Promise<void> => {
    const res = await openApproveModal(item);
    if (!res.confirmed) return;
    try {
      const result = await actMut.mutateAsync({ id: item.id, type: item.type, action: 'approve' });
      toast(`${item.ref} approved (${result.status})`);
    } catch (e) {
      const msg = (e as { message?: string }).message ?? 'Approval failed';
      if (msg.toLowerCase().includes('segregation') || msg.toLowerCase().includes('same')) {
        toast.error('SoD violation: you cannot approve a record you submitted.');
      } else {
        toast.error(msg);
      }
    }
  };

  const handleReject = async (item: ApprovalsQueueItemV2): Promise<void> => {
    const res = await openRejectModal(item);
    if (!res.confirmed) return;
    try {
      const result = await actMut.mutateAsync({ id: item.id, type: item.type, action: 'reject', reason: res.reason });
      toast(`${item.ref} rejected (${result.status})`);
    } catch (e) {
      const msg = (e as { message?: string }).message ?? 'Rejection failed';
      toast.error(msg);
    }
  };

  const cols: HrfinColumn<ApprovalsQueueItemV2>[] = [
    {
      key: 'type',
      label: 'TYPE',
      render: r => <HrfinPill tone={TYPE_TONES[r.type]}>{r.type}</HrfinPill>,
    },
    { key: 'ref',    label: 'REFERENCE',         render: r => r.ref },
    { key: 'party',  label: 'VENDOR / CLAIMANT', render: r => r.party },
    { key: 'amount', label: 'AMOUNT',             render: r => money(r.amount) },
    {
      key: 'age',
      label: 'AGE',
      render: r => (
        <span class={r.ageDays > 2 ? 'hrfin-text-danger' : undefined}>{r.ageDays}d</span>
      ),
    },
    {
      key: 'actions',
      label: 'ACTIONS',
      render: r => (
        <span onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {r.userCanApprove ? (
            <button
              type="button"
              class="hrfin-action is-primary"
              style={{ minHeight: 32 }}
              disabled={actMut.isPending}
              onClick={() => handleApprove(r)}
            >
              Approve
            </button>
          ) : null}
          {r.userCanApprove && r.canReject ? (
            <button
              type="button"
              class="hrfin-action is-danger"
              style={{ minHeight: 32 }}
              disabled={actMut.isPending}
              onClick={() => handleReject(r)}
            >
              Reject
            </button>
          ) : null}
          <button
            type="button"
            class="hrfin-action"
            style={{ minHeight: 32 }}
            onClick={() => go(r.route)}
          >
            Open
          </button>
        </span>
      ),
    },
  ];

  return (
    <div class="hrfin-approvals-inbox">
      {/* Filter strip */}
      <div class="hrfin-filter-strip" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span class="hrfin-label">Filter:</span>
        {(['All', 'Bill', 'Expense', 'Remittance', 'Disbursement'] as const).map(t => (
          <button
            key={t}
            type="button"
            class={`hrfin-chip${(!filters.type && t === 'All') || filters.type === t ? ' is-active' : ''}`}
            onClick={() => setFilters(f => ({ ...f, type: t === 'All' ? undefined : t }))}
          >
            {t}
          </button>
        ))}
        <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span class="hrfin-label">High value only</span>
          <input
            type="checkbox"
            checked={filters.priority === 'high'}
            onChange={e => setFilters(f => ({ ...f, priority: (e.currentTarget).checked ? 'high' : undefined }))}
          />
        </label>
      </div>

      {queueQ.isError && (
        <div class="hrfin-empty">
          {(queueQ.error as { message?: string })?.message ?? 'Failed to load approvals.'}
        </div>
      )}

      <HrfinTable<ApprovalsQueueItemV2>
        tabs={[{ key: 'inbox', label: 'Approvals inbox' }]}
        activeTab="inbox"
        columns={cols}
        rows={items}
        rowKey={r => r.id}
        onRowClick={r => go(r.route)}
        page={0} pageCount={1}
        total={items.length}
        pageSize={100}
        onPage={() => {}}
        noun="approvals"
        loading={loading}
        emptyMessage="No pending approvals match the current filter."
      />
    </div>
  );
}
