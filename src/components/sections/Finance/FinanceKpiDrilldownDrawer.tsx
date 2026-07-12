/**
 * src/components/sections/Finance/FinanceKpiDrilldownDrawer.tsx
 *
 * Chunk 10 — KPI Drill-through drawer.
 * Opens when a KPI card is clicked; fetches the matching row set and shows
 * a filtered register with links back to the source module.
 *
 * The KpiCard component itself is NOT modified (kept generic per spec).
 * FinanceOverview wraps each card in a clickable element that drives this drawer.
 */

import { type VNode } from 'preact';
import { HrfinTable, type HrfinColumn } from '@ui';
import { useKpiDrilldown, type KpiType, type KpiDrilldownRow } from '@api/finance/overview';
import { money } from './hrfinFormat';

const go = (id: string): void => { window.dispatchEvent(new CustomEvent('siomac:section', { detail: id })); };

const KPI_LABELS: Record<KpiType, string> = {
  'spend':              'Spend MTD — all sources',
  'pending-approvals':  'Pending approvals',
  'budget-variance':    'Budget variance — cost centres',
  'cash-out':           'Cash out MTD — disbursements',
};

const KPI_MODULES: Record<KpiType, { label: string; route: string }> = {
  'spend':              { label: 'View Payables', route: 's-finance-payables' },
  'pending-approvals':  { label: 'View Payables', route: 's-finance-payables' },
  'budget-variance':    { label: 'View Budgets', route: 's-finance-budgets' },
  'cash-out':           { label: 'View Disbursements', route: 's-finance-disbursements' },
};

const drilldownCols: HrfinColumn<KpiDrilldownRow>[] = [
  { key: 'type',   label: 'TYPE',    render: r => r.type },
  { key: 'ref',    label: 'REF',     render: r => r.ref },
  { key: 'party',  label: 'PARTY',   render: r => r.party },
  { key: 'amount', label: 'AMOUNT',  render: r => money(r.amount) },
  { key: 'date',   label: 'DATE',    render: r => r.date },
  { key: 'status', label: 'STATUS',  render: r => r.status },
  { key: 'open',   label: '',        render: r => (
    <button type="button" class="hrfin-action" onClick={e => { e.stopPropagation(); go(r.route); }}>
      Open
    </button>
  ) },
];

interface Props {
  kpiType: KpiType | null;
  period?: string;
  onClose: () => void;
}

export function FinanceKpiDrilldownDrawer({ kpiType, period = 'mtd', onClose }: Props): VNode | null {
  const q = useKpiDrilldown(kpiType, period);
  const data = q.data;
  const loading = q.isPending;
  const mod = kpiType ? KPI_MODULES[kpiType] : null;

  if (!kpiType) return null;

  return (
    <div class="hrfin-drawer-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside class="hrfin-drawer" role="dialog" aria-modal="true" aria-label={KPI_LABELS[kpiType]}>
        <div class="hrfin-drawer-head">
          <div>
            <h3>{KPI_LABELS[kpiType]}</h3>
            {data && <span class="hrfin-chip">{data.total} record{data.total === 1 ? '' : 's'}</span>}
          </div>
          <button type="button" class="hrfin-dialog-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div class="hrfin-drawer-body">
          {q.isError && (
            <div class="hrfin-empty">
              {(q.error as { message?: string })?.message ?? 'Failed to load drill-through data.'}
            </div>
          )}

          <HrfinTable<KpiDrilldownRow>
            tabs={[{ key: 'drill', label: data?.title ?? KPI_LABELS[kpiType] }]}
            activeTab="drill"
            columns={drilldownCols}
            rows={data?.rows ?? []}
            rowKey={r => r.id}
            onRowClick={r => go(r.route)}
            page={0} pageCount={1}
            total={data?.rows.length ?? 0}
            pageSize={100}
            onPage={() => { /* noop */ }}
            noun="records"
            loading={loading}
            emptyMessage="No records found for this KPI and period."
          />
        </div>

        {mod && (
          <div class="hrfin-drawer-footer">
            <button type="button" class="hrfin-btn" onClick={onClose}>Close</button>
            <button type="button" class="hrfin-btn is-primary" onClick={() => { go(mod.route); onClose(); }}>
              {mod.label} →
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
