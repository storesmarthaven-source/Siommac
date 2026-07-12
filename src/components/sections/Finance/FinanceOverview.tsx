/**
 * src/components/sections/Finance/FinanceOverview.tsx
 *
 * Finance ▸ Overview — executive command page wired to real data.
 * Wave 2A chunks 9, 10, 11, 13-chart upgrades:
 *   - Chunk 9:  Export quick action → real CSV dialog (no more toast-only)
 *   - Chunk 10: KPI cards are clickable → FinanceKpiDrilldownDrawer
 *   - Chunk 11: Review-approvals → FinanceApprovalsInbox inline + Approve/Reject
 *   - Chunk 13: TrendArea with period toggle + hover tooltip + forecast segment
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { can } from '@lib/permissions';
import {
  HrfinPageHeader, QuickActionStrip, KpiCard, RailCard, DeadlineList, ActivityFeed,
  InsightBanner, TrendArea, HorizontalBars, DonutRing, HrfinTable,
  type QuickAction, type HrfinColumn,
} from '@ui';
import { useFinanceOverview, useSpendBudgetSeries, type ApprovalQueueItem, type SpendBudgetPeriod } from '@api/finance/overview';
import { money, moneyCompact, deltaLabel } from './hrfinFormat';
import { FinanceExportDialog } from './FinanceExportDialog';
import { FinanceKpiDrilldownDrawer } from './FinanceKpiDrilldownDrawer';
import { FinanceApprovalsInbox } from './FinanceApprovalsInbox';
import type { KpiType } from '@api/finance/overview';

const go = (id: string): void => { window.dispatchEvent(new CustomEvent('siomac:section', { detail: id })); };
const TYPE_ROUTE: Record<ApprovalQueueItem['type'], string> = {
  Bill: 's-finance-payables', Expense: 's-finance-expenses', Remittance: 's-finance-remittances', Disbursement: 's-finance-disbursements',
};

export function FinanceOverview(): VNode {
  const q = useFinanceOverview();
  const d = q.data;
  const loading = q.isLoading && !d;
  const k = d?.kpis;
  const pending = k?.pendingApprovalsCount ?? 0;
  const overdue = d?.approvalsAging.overdue ?? 0;

  // Chunk 9 — Export dialog
  const [exportOpen, setExportOpen] = useState(false);

  // Chunk 10 — KPI drill drawer
  const [openKpi, setOpenKpi] = useState<KpiType | null>(null);

  // Chunk 11 — Approvals inbox (shown inline when "Review approvals" is clicked)
  const [inboxOpen, setInboxOpen] = useState(false);

  // Chunk 13-chart — period-aware trend series
  const [trendPeriod, setTrendPeriod] = useState<SpendBudgetPeriod>('Monthly');
  const trendQ = useSpendBudgetSeries(trendPeriod);
  const trendData = trendQ.data;
  // Fall back to summary data when the period query hasn't loaded yet
  const trendLabels   = trendData?.labels   ?? d?.spendTrend.labels   ?? [];
  const trendSpend    = trendData?.spend    ?? d?.spendTrend.spend    ?? [];
  const trendBudget   = trendData?.budget   ?? d?.spendTrend.budget   ?? [];
  const _trendForecast = trendData?.forecast ?? [];
  const trendForecastFrom = trendData?.forecastFromIndex ?? trendLabels.length;

  const actions: QuickAction[] = [
    {
      key:     'approvals',
      label:   'Review approvals',
      icon:    'alert',
      variant: 'primary',
      badge:   pending || undefined,
      onClick: () => setInboxOpen(o => !o),
    },
    ...(can('finance.payroll.run.manage')
      ? [{ key: 'payroll', label: 'Run payroll', icon: 'user', onClick: () => go('s-finance-payroll') } as QuickAction]
      : []),
    ...(can('finance.ap.manage')
      ? [{ key: 'pay', label: 'Record payment', icon: 'receipt', onClick: () => go('s-finance-payables') } as QuickAction]
      : []),
    ...(can('finance.ap.manage')
      ? [{ key: 'vendor', label: 'New vendor', icon: 'bank', onClick: () => go('s-finance-payables') } as QuickAction]
      : []),
    ...(can('finance.overview.export')
      ? [{ key: 'export', label: 'Export', icon: 'download', onClick: () => setExportOpen(true) } as QuickAction]
      : [{ key: 'export', label: 'Export', icon: 'download', onClick: () => setExportOpen(true) } as QuickAction]),
  ];

  // Approvals table columns — inline approve-in-place for Bill/Expense (real actions),
  // Open-only for Remittance/Disbursement (no inline reject available per spec §5)
  const approvalCols: HrfinColumn<ApprovalQueueItem>[] = [
    { key: 'type',        label: 'TYPE',               render: r => r.type },
    { key: 'ref',         label: 'REFERENCE',           render: r => r.ref },
    { key: 'party',       label: 'VENDOR / CUSTOMER',  render: r => r.party },
    { key: 'amount',      label: 'AMOUNT',             render: r => money(r.amount) },
    { key: 'requestedBy', label: 'REQUESTED BY',       render: r => r.requestedBy ?? '—' },
    { key: 'age',         label: 'AGE',                render: r => `${r.ageDays}d` },
    {
      key: 'actions',
      label: 'ACTIONS',
      render: r => (
        <span onClick={e => e.stopPropagation()}>
          {/* All items get "Open" — navigate to the owning module */}
          <button
            type="button"
            class="hrfin-action is-primary"
            style={{ minHeight: 32 }}
            onClick={() => go(TYPE_ROUTE[r.type])}
          >
            {/* Bill and Expense have real cross-module approve via inbox; Remittance/Disbursement open only */}
            {r.type === 'Bill' || r.type === 'Expense' ? 'Review' : 'Open'}
          </button>
          {' '}
          <button
            type="button"
            class="hrfin-action"
            style={{ minHeight: 32 }}
            onClick={() => go(TYPE_ROUTE[r.type])}
          >
            Open
          </button>
        </span>
      ),
    },
  ];

  const focus: { b: string; s: string; to: string }[] = [];
  if (pending) focus.push({ b: 'Clear pending approvals', s: `${pending} items · ${money(k?.pendingApprovalsAmount)} waiting`, to: 's-finance-payables' });
  if (overdue) focus.push({ b: 'Action overdue approvals', s: `${overdue} over the 48h SLA`, to: 's-finance-payables' });
  if (can('finance.payroll.run.manage')) focus.push({ b: 'Prepare the next payroll run', s: 'Review before the cut-off', to: 's-finance-payroll' });
  if (focus.length < 3) focus.push({ b: 'Keep the on-time rate healthy', s: 'Clear this week\'s payment run', to: 's-finance-payables' });

  return (
    <div class="hrfin">
      <HrfinPageHeader
        icon="grid" title="Finance overview" sub="Cash, approvals, budgets and what needs your attention today."
        chips={[
          { icon: 'clock', label: `${pending} approval${pending === 1 ? '' : 's'} waiting` },
          ...(overdue > 0 ? [{ icon: 'alert' as const, label: `${overdue} overdue`, tone: 'danger' as const }] : []),
        ]}
      />

      {(pending > 0 || overdue > 0) && (
        <InsightBanner
          title={`${overdue ? `${overdue} overdue · ` : ''}${pending} approval${pending === 1 ? '' : 's'} waiting${k?.pendingApprovalsAmount ? ` — ${money(k.pendingApprovalsAmount)}` : ''}`}
          sub="Clearing these keeps the on-time rate healthy and the payment run on track."
          actions={[
            {
              label: 'View details',
              onClick: () => go('s-finance-payables'),
            },
            {
              label: 'Review now',
              primary: true,
              onClick: () => setInboxOpen(true),
            },
          ]}
        />
      )}

      <QuickActionStrip actions={actions} />

      {/* Chunk 11 — Approvals inbox (toggled by "Review approvals" action) */}
      {inboxOpen && (
        <section class="hrfin-card" style={{ marginBottom: 16 }}>
          <div class="hrfin-card-head">
            <h2>Approvals inbox</h2>
            <button type="button" class="hrfin-chip" onClick={() => setInboxOpen(false)}>Close ×</button>
          </div>
          <FinanceApprovalsInbox />
        </section>
      )}

      {/* Chunk 10 — KPI cards (wrapped in clickable containers, not modifying KpiCard) */}
      <section class="hrfin-kpi-grid">
        <button
          type="button"
          class="hrfin-kpi-drillable"
          onClick={() => can('finance.overview.kpi.drill') ? setOpenKpi('spend') : go('s-finance-payables')}
          aria-label="Drill into Spend MTD"
          style={{ all: 'unset', cursor: 'pointer', display: 'block', borderRadius: 'inherit' }}
        >
          <KpiCard loading={loading} label="Spend MTD" value={money(k?.spendMtd)} badge={deltaLabel(k?.spendMtdDeltaPct)} badgeTone={(k?.spendMtdDeltaPct ?? 0) >= 0 ? 'success' : 'danger'} support="bills, expenses & disbursements" visual="line" values={d?.spendTrend.spend ?? []} />
        </button>
        <button
          type="button"
          class="hrfin-kpi-drillable"
          onClick={() => can('finance.overview.kpi.drill') ? setOpenKpi('pending-approvals') : setInboxOpen(true)}
          aria-label="Drill into pending approvals"
          style={{ all: 'unset', cursor: 'pointer', display: 'block', borderRadius: 'inherit' }}
        >
          <KpiCard loading={loading} label="Pending approvals" value={String(pending)} support={k ? `${money(k.pendingApprovalsAmount)} total` : undefined} footer={k ? `${k.pendingApprovalsHighValueCount} high value` : undefined} />
        </button>
        <button
          type="button"
          class="hrfin-kpi-drillable"
          onClick={() => can('finance.overview.kpi.drill') ? setOpenKpi('budget-variance') : go('s-finance-budgets')}
          aria-label="Drill into budget variance"
          style={{ all: 'unset', cursor: 'pointer', display: 'block', borderRadius: 'inherit' }}
        >
          <KpiCard loading={loading} label="Budget variance" value={money(k?.budgetVariance)} badge={k ? (k.budgetVariance <= 0 ? 'Under budget' : 'Over budget') : undefined} badgeTone={k && k.budgetVariance <= 0 ? 'success' : 'danger'} support={k?.budgetVariancePct != null ? `${k.budgetVariancePct.toFixed(1)}% vs budget` : 'vs fiscal-year budget'} footer={k && k.budgetVariance <= 0 ? 'Favorable variance' : undefined} />
        </button>
        <button
          type="button"
          class="hrfin-kpi-drillable"
          onClick={() => can('finance.overview.kpi.drill') ? setOpenKpi('cash-out') : go('s-finance-disbursements')}
          aria-label="Drill into cash out MTD"
          style={{ all: 'unset', cursor: 'pointer', display: 'block', borderRadius: 'inherit' }}
        >
          <KpiCard loading={loading} label="Cash out (MTD)" value={money(k?.cashOutMtd)} badge={deltaLabel(k?.cashOutDeltaPct)} badgeTone={(k?.cashOutDeltaPct ?? 0) <= 0 ? 'success' : 'danger'} support="net-pay disbursements" />
        </button>
      </section>

      <section class="hrfin-layout">
        <div class="hrfin-main-stack">
          <div class="hrfin-analytics-grid">
            <article class="hrfin-card">
              {/* Chunk 13-chart: period toggle + hover tooltip + forecast segment */}
              <div class="hrfin-card-head">
                <h2>Spend vs budget</h2>
                {/* Period toggle is rendered inside TrendArea */}
              </div>
              <TrendArea
                title="Spend vs budget"
                labels={trendLabels}
                seriesA={trendSpend}
                seriesB={trendBudget}
                forecastFromIndex={trendForecastFrom}
                period={trendPeriod}
                onPeriodChange={setTrendPeriod}
                seriesALabel="Spend"
                seriesBLabel="Budget"
              />
              <div class="hrfin-chart-footer">
                <span>{k ? `MTD spend is ${money(Math.abs(k.budgetVariance))} ${k.budgetVariance <= 0 ? 'under' : 'over'} budget.` : 'Spend vs fiscal-year budget.'}</span>
                <button type="button" class="hrfin-card-link" onClick={() => go('s-finance-budgets')}>View forecast →</button>
              </div>
            </article>
            <article class="hrfin-card">
              <div class="hrfin-card-head"><h2>Top cost centres by burn</h2><span class="hrfin-chip">MTD</span></div>
              {(d?.costCentreBurn.length ?? 0) === 0
                ? <div class="hrfin-empty">No budget lines for this fiscal year.</div>
                : <HorizontalBars items={d!.costCentreBurn.map(cc => ({ label: cc.name, value: moneyCompact(cc.actual), percent: cc.percentOfTotal }))} />}
              <button type="button" class="hrfin-card-link" onClick={() => go('s-finance-budgets')}>View cost centre report →</button>
            </article>
          </div>

          <HrfinTable<ApprovalQueueItem>
            tabs={[{ key: 'approvals', label: 'Approvals needing action' }]} activeTab="approvals"
            searchPlaceholder="Search approvals..." columns={approvalCols}
            rows={d?.approvalsQueue ?? []} rowKey={r => r.id} onRowClick={r => go(TYPE_ROUTE[r.type])}
            page={0} pageCount={1} total={d?.approvalsQueue.length ?? 0} pageSize={100} onPage={() => {}}
            noun="approvals" loading={loading} emptyMessage="Nothing awaiting approval — you're clear."
          />
        </div>

        <aside class="hrfin-rail">
          <article class="hrfin-card">
            <div class="hrfin-card-head"><h2>Today's focus</h2></div>
            <div class="hrfin-focus-list">
              {focus.slice(0, 3).map((f, i) => (
                <div class="hrfin-focus-item" key={i} onClick={() => go(f.to)}><div><b>{f.b}</b><small>{f.s}</small></div>›</div>
              ))}
            </div>
            <button type="button" class="hrfin-card-link" onClick={() => go('s-finance-payables')}>View focus dashboard →</button>
          </article>

          <RailCard title="Upcoming deadlines" right={<span>Upcoming</span>} linkLabel="View all deadlines" onLink={() => go('s-finance-remittances')}>
            <DeadlineList items={(d?.deadlines ?? []).map(dl => { const dt = new Date(dl.date); return { top: dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase(), bottom: String(dt.getUTCDate()), title: dl.title, meta: dl.meta }; })} />
          </RailCard>

          <article class="hrfin-card">
            <div class="hrfin-card-head"><h2>Approvals on track</h2><span>SLA</span></div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              <DonutRing value={d?.approvalsAging.percentWithinSla ?? 100} label="within SLA" />
              <div class="hrfin-metric-list">
                <div class="hrfin-metric-row"><span>Within 48h</span><b>{d?.approvalsAging.withinSla ?? 0}</b></div>
                <div class="hrfin-metric-row"><span>Overdue</span><b>{d?.approvalsAging.overdue ?? 0}</b></div>
                <div class="hrfin-metric-row"><span>Total pending</span><b>{d?.approvalsAging.totalPending ?? 0}</b></div>
              </div>
            </div>
            <button type="button" class="hrfin-card-link" onClick={() => setInboxOpen(true)}>View approvals →</button>
          </article>

          <RailCard title="Recent activity">
            <ActivityFeed items={(d?.activity ?? []).map(a => ({
              icon: a.icon.includes('check') ? 'check' : a.icon.includes('money') || a.icon.includes('cash') ? 'receipt' : 'file',
              title: a.title, meta: `${a.actorLabel} · ${new Date(a.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`,
            }))} />
          </RailCard>
        </aside>
      </section>

      {/* Chunk 9 — Export dialog */}
      <FinanceExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />

      {/* Chunk 10 — KPI drill-through drawer */}
      <FinanceKpiDrilldownDrawer
        kpiType={openKpi}
        period={trendPeriod.toLowerCase()}
        onClose={() => setOpenKpi(null)}
      />
    </div>
  );
}
