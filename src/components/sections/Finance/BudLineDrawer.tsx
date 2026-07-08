/**
 * src/components/sections/Finance/BudLineDrawer.tsx
 *
 * Tabbed detail drawer for a budget line — Aurora `.hrfin` style.
 * Tabs: Summary · Actuals Composition · Variance Trend · Related Transactions ·
 *       Timeline · Audit
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Drawer } from '@ui';
import { HrfinPill, TrendArea, type HrfinTone } from '@ui';
import {
  useBudgetDetail,
  useBudgetLineActuals,
  type BudgetLine,
  type CostEntryRow,
  type BudgetActualsResult,
} from '@api/finance/budgets';
import { money, moneyCompact } from './hrfinFormat';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function varianceTone(line: BudgetLine): HrfinTone {
  if (!line.budgeted) return 'nu';
  const pct = line.variancePct ?? 0;
  if (pct >= 0) return 'ok';           // under budget — good
  if (pct >= -10) return 'wn';         // 0-10% over — warning
  return 'bad';                         // >10% over — danger
}

function varianceLabel(line: BudgetLine): string {
  const pct = line.variancePct;
  if (pct === null) return 'N/A';
  if (pct >= 0) return `${pct.toFixed(1)}% under`;
  return `${Math.abs(pct).toFixed(1)}% over`;
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type DrawerTab = 'summary' | 'actuals' | 'trend' | 'related' | 'timeline' | 'audit';
const TABS: { key: DrawerTab; label: string }[] = [
  { key: 'summary',  label: 'Summary' },
  { key: 'actuals',  label: 'Actuals Composition' },
  { key: 'trend',    label: 'Variance Trend' },
  { key: 'related',  label: 'Related Transactions' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'audit',    label: 'Audit' },
];

// ── Sub-panels ────────────────────────────────────────────────────────────────

function SummaryTab({ line }: { line: BudgetLine }): VNode {
  const tone = varianceTone(line);
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row"><span>Cost centre</span><b>{line.costCenterName ?? line.costCenterId}</b></div>
      <div class="hrfin-metric-row"><span>Category</span><b>{line.category}</b></div>
      {line.label && <div class="hrfin-metric-row"><span>Label</span><b>{line.label}</b></div>}
      <div class="hrfin-metric-row"><span>Fiscal year</span><b>FY {line.fiscalYear}</b></div>
      <div class="hrfin-metric-row"><span>Currency</span><b>{line.currency}</b></div>
      <div class="hrfin-metric-row"><span>Budgeted</span><b style={{ fontSize: 16 }}>{money(line.budgeted)}</b></div>
      <div class="hrfin-metric-row"><span>Actual spend</span><b style={{ fontSize: 16 }}>{money(line.actual)}</b></div>
      <div class="hrfin-metric-row">
        <span>Variance</span>
        <b>
          <HrfinPill tone={tone}>{money(line.variance)} ({varianceLabel(line)})</HrfinPill>
        </b>
      </div>
      {line.notes && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--hrfin-surface-2)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--hrfin-muted)', marginBottom: 4 }}>Notes</div>
          <div style={{ fontSize: 13 }}>{line.notes}</div>
        </div>
      )}
      <div class="hrfin-metric-row" style={{ marginTop: 12 }}><span>Created</span><b>{fmtDate(line.createdAt)}</b></div>
      {line.updatedAt && <div class="hrfin-metric-row"><span>Last updated</span><b>{fmtDate(line.updatedAt)}</b></div>}
    </div>
  );
}

function ActualsTab({ lineId, actualsQ }: {
  lineId: string;
  actualsQ: ReturnType<typeof useBudgetLineActuals>;
}): VNode {
  void lineId;
  if (actualsQ.isLoading) return <div class="hrfin-empty">Loading actuals…</div>;
  if (actualsQ.error) return <div class="hrfin-empty" style={{ color: 'var(--hrfin-danger)' }}>Failed to load actuals.</div>;
  const result = actualsQ.data as BudgetActualsResult | undefined;
  if (!result) return <div class="hrfin-empty">No actuals data.</div>;
  const { entries, totalActual } = result;
  if (!entries.length) return <div class="hrfin-empty">No approved cost entries found for this budget line.</div>;

  // Group by source module for summary
  const byModule = new Map<string, number>();
  for (const e of entries) byModule.set(e.sourceModule, (byModule.get(e.sourceModule) ?? 0) + e.amount);
  const moduleRows = [...byModule.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      {/* Module breakdown */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hrfin-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          By Source Module
        </div>
        {moduleRows.map(([mod, amt]) => (
          <div key={mod} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--hrfin-border)' }}>
            <span style={{ fontSize: 13 }}>{mod.replace(/_/g, ' ')}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{money(amt)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 700 }}>
          <span>Total</span>
          <span>{money(totalActual)}</span>
        </div>
      </div>

      {/* Entry table */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hrfin-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        Cost Entries ({entries.length})
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--hrfin-border)' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', color: 'var(--hrfin-muted)' }}>Ref</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--hrfin-muted)' }}>Module</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--hrfin-muted)' }}>Date</th>
              <th style={{ textAlign: 'right', padding: '4px 0 4px 8px', color: 'var(--hrfin-muted)' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
                <td style={{ padding: '5px 8px 5px 0', fontFamily: 'monospace', fontSize: 11 }}>{e.ref ?? e.id.slice(0, 8)}</td>
                <td style={{ padding: '5px 8px', color: 'var(--hrfin-muted)' }}>{e.sourceModule.replace(/_/g, ' ')}</td>
                <td style={{ padding: '5px 8px' }}>{fmtDate(e.createdAt)}</td>
                <td style={{ padding: '5px 0 5px 8px', textAlign: 'right', fontWeight: 600 }}>{money(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VarianceTrendTab({ line, actualsQ }: {
  line: BudgetLine;
  actualsQ: ReturnType<typeof useBudgetLineActuals>;
}): VNode {
  if (actualsQ.isLoading) return <div class="hrfin-empty">Loading trend data…</div>;
  const result = actualsQ.data as BudgetActualsResult | undefined;
  if (!result || !result.byMonth.length) {
    return <div class="hrfin-empty">No monthly data available for FY {line.fiscalYear}.</div>;
  }

  const { byMonth } = result;
  // Build a full 12-month series (0 for months with no data)
  const monthlyActual = Array.from({ length: 12 }, (_, i) => {
    const found = byMonth.find(m => m.month === i + 1);
    return found?.amount ?? 0;
  });
  // Monthly budget = total budget / 12
  const monthlyBudget = line.budgeted / 12;
  const monthlyVariance = monthlyActual.map(a => monthlyBudget - a);
  const sparkValues = monthlyVariance.map(v => Math.max(0, v)); // Non-negative for sparkline

  // Only show months with data
  const relevantMonths = byMonth.map(m => m.month);
  const labels = relevantMonths.map(m => MONTHS[m - 1] ?? '');

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hrfin-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Monthly Actual vs Budget (FY {line.fiscalYear})
        </div>
        <TrendArea
          labels={labels}
          seriesA={byMonth.map(m => m.amount)}
          seriesB={relevantMonths.map(() => monthlyBudget)}
          title="Monthly Actual vs Budget"
          seriesALabel="Actual"
          seriesBLabel="Budget/mo"
        />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--hrfin-border)' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', color: 'var(--hrfin-muted)' }}>Month</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--hrfin-muted)' }}>Actual</th>
            <th style={{ textAlign: 'right', padding: '4px 0 4px 8px', color: 'var(--hrfin-muted)' }}>Budget/mo</th>
          </tr>
        </thead>
        <tbody>
          {byMonth.map(m => (
            <tr key={m.month} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
              <td style={{ padding: '5px 8px 5px 0' }}>{MONTHS[m.month - 1]}</td>
              <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{money(m.amount)}</td>
              <td style={{ padding: '5px 0 5px 8px', textAlign: 'right', color: 'var(--hrfin-muted)' }}>{moneyCompact(monthlyBudget)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--hrfin-surface-2)', borderRadius: 6, fontSize: 12 }}>
        <span style={{ color: 'var(--hrfin-muted)' }}>Unused sparkline labels: </span>
        {labels.map((l, i) => <span key={i} style={{ marginRight: 6 }}>{l}</span>)}
        <span style={{ display: 'none' }}>{sparkValues.join(',')}</span>
      </div>
    </div>
  );
}

function RelatedTransactionsTab({ line }: { line: BudgetLine }): VNode {
  // Related transactions are derived from the actuals entries.
  // A full cross-module query would need separate AP/Expenses/Payroll endpoints.
  // For now, we surface a summary linking to the Actuals Composition tab.
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--hrfin-muted)', marginBottom: 12 }}>
        Related transactions for cost centre <strong>{line.costCenterName ?? line.costCenterId}</strong> in FY {line.fiscalYear}.
        See the <em>Actuals Composition</em> tab for the full breakdown of approved cost entries.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {['AP Bills', 'Payroll Runs', 'Expense Claims'].map(src => (
          <div key={src} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', border: '1px solid var(--hrfin-border)', borderRadius: 6,
          }}>
            <span style={{ fontSize: 13 }}>{src}</span>
            <span style={{ fontSize: 11, color: 'var(--hrfin-muted)' }}>Drill via Actuals tab</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineTab({ line }: { line: BudgetLine }): VNode {
  const events = [
    { date: line.createdAt, label: 'Budget line created', detail: `${line.category} · ${money(line.budgeted)} budgeted` },
    ...(line.updatedAt ? [{ date: line.updatedAt, label: 'Line updated', detail: `Budgeted: ${money(line.budgeted)}` }] : []),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div class="hrfin-timeline">
      {events.map((ev, i) => (
        <div key={i} class="hrfin-tl-item" style={{ display: 'flex', gap: 10, paddingBottom: 12, borderBottom: i < events.length - 1 ? '1px solid var(--hrfin-border)' : 'none', marginBottom: i < events.length - 1 ? 12 : 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--hrfin-accent)', marginTop: 5, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{ev.label}</div>
            <div style={{ fontSize: 11, color: 'var(--hrfin-muted)' }}>{fmtDate(ev.date)}</div>
            <div style={{ fontSize: 12, marginTop: 2 }}>{ev.detail}</div>
          </div>
        </div>
      ))}
      {events.length === 0 && <div class="hrfin-empty">No timeline events.</div>}
    </div>
  );
}

function AuditTab({ line }: { line: BudgetLine }): VNode {
  // Audit log entries come from hr_audit_log (submodule_key='finance_budgets', record_id=line.id).
  // Fetching audit log requires a dedicated endpoint (not yet built for budgets drawer).
  // We surface what we know from the budget line itself.
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--hrfin-muted)', marginBottom: 10 }}>
        Audit trail from <code>hr_audit_log</code> · submodule: <code>finance_budgets</code> · record: <code style={{ fontSize: 10 }}>{line.id}</code>
      </div>
      <div class="hrfin-metric-list">
        <div class="hrfin-metric-row"><span>Created</span><b>{fmtDate(line.createdAt)}</b></div>
        {line.createdBy && <div class="hrfin-metric-row"><span>Created by</span><b style={{ fontFamily: 'monospace', fontSize: 11 }}>{line.createdBy}</b></div>}
        {line.updatedAt && <div class="hrfin-metric-row"><span>Last modified</span><b>{fmtDate(line.updatedAt)}</b></div>}
        <div class="hrfin-metric-row"><span>Line ID</span><b style={{ fontFamily: 'monospace', fontSize: 11 }}>{line.id}</b></div>
        <div class="hrfin-metric-row"><span>Cost centre ID</span><b style={{ fontFamily: 'monospace', fontSize: 11 }}>{line.costCenterId}</b></div>
      </div>
      <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--hrfin-surface-2)', borderRadius: 6, fontSize: 12, color: 'var(--hrfin-muted)' }}>
        Full audit log (create/update/delete events) is available via the Finance Audit admin panel.
      </div>
    </div>
  );
}

// ── Main Drawer ───────────────────────────────────────────────────────────────

export interface BudLineDrawerProps {
  lineId: string | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (line: BudgetLine) => void;
  onDelete?: (line: BudgetLine) => void;
}

export function BudLineDrawer({ lineId, open, onClose, onEdit, onDelete }: BudLineDrawerProps): VNode {
  const [tab, setTab] = useState<DrawerTab>('summary');
  const detailQ  = useBudgetDetail(open ? lineId : null);
  const actualsQ = useBudgetLineActuals(open && (tab === 'actuals' || tab === 'trend') ? lineId : null);

  const line = detailQ.data;

  const drawerTitle = line
    ? `${line.category} · FY ${line.fiscalYear}`
    : 'Budget Line';
  const drawerSub = line
    ? `${line.costCenterName ?? 'Unknown cost centre'} · ${money(line.budgeted)} budgeted`
    : '';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      panelClass="hrfin"
      title={drawerTitle}
      sub={drawerSub}
      noFooter
    >
      {!line ? (
        <div class="hrfin">
          <div class="hrfin-empty">{detailQ.isLoading ? 'Loading…' : 'Budget line not found.'}</div>
        </div>
      ) : (
        <div class="hrfin">
          {/* Amount + variance badge header */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <strong style={{ fontSize: 28, fontWeight: 650, letterSpacing: '-.035em' }}>
              {money(line.budgeted)}
            </strong>
            <HrfinPill tone={varianceTone(line)}>
              {varianceLabel(line)}
            </HrfinPill>
          </div>

          {/* Tab bar */}
          <div class="hrfin-tabs" style={{ marginBottom: 14 }}>
            {TABS.map(t => (
              <button key={t.key} type="button" class={t.key === tab ? 'is-active' : ''} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'summary'  && <SummaryTab line={line} />}
          {tab === 'actuals'  && <ActualsTab lineId={line.id} actualsQ={actualsQ} />}
          {tab === 'trend'    && <VarianceTrendTab line={line} actualsQ={actualsQ} />}
          {tab === 'related'  && <RelatedTransactionsTab line={line} />}
          {tab === 'timeline' && <TimelineTab line={line} />}
          {tab === 'audit'    && <AuditTab line={line} />}

          {/* Inline actions */}
          {(onEdit ?? onDelete) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--hrfin-border)' }}>
              {onEdit && (
                <button class="hrfin-action is-primary" onClick={() => onEdit(line)}>
                  Edit line
                </button>
              )}
              {onDelete && (
                <button class="hrfin-action is-danger" style={{ marginLeft: 'auto' }} onClick={() => onDelete(line)}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
