// Payslip Batches register (F-10, spec §15.5) — full-page batch register.
// Reference: mockups/payroll-enterprise/payslips.html (re-implemented to the Siomac
// standard with scoped .psb-* classes). Backed by finance/payroll/payslip-batches/list.
//
// A batch = a locked run's payslip set. Row-open deep-links to the run workspace
// (Command Center run detail), whose Payslips tab owns the generate/render/deliver
// actions — this page LISTS + filters batches and surfaces delivery progress.

import { useMemo, useState, useEffect } from 'preact/hooks';
import type { VNode } from 'preact';
import { showSection } from '@components/nav/navCore';
import { usePayslipBatches, type PayslipBatchListItem, type PayslipBatchTab } from '@api/finance/payrollPayslipBatches';
import { usePayGroups } from '@api/finance/payroll';
import './payslipBatches.css';

const TABS: { key: PayslipBatchTab; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'active',    label: 'In Progress' },
  { key: 'attention', label: 'Needs Action' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'completed', label: 'Completed' },
];
const LC_PILL = new Map<string, string>([
  ['scheduled', 'blue'], ['active', 'blue'], ['attention', 'amber'], ['completed', 'green'],
]);

const num = (n: number): string => n.toLocaleString('en-US');
const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const fmtDate = (d: string | null): string =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function openRun(runId: string): void {
  try { sessionStorage.setItem('siomac_open_payroll_run', runId); } catch { /* ignore */ }
  showSection('s-finance-payroll');
}

export function PayrollPayslipBatchesPage(): VNode {
  const [tab, setTab] = useState<PayslipBatchTab>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [payGroupId, setPayGroupId] = useState('all');
  const [offset, setOffset] = useState(0);
  const LIMIT = 25;

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const req = useMemo(() => ({
    tab, limit: LIMIT, offset,
    search: search || undefined,
    payGroupIds: payGroupId !== 'all' ? [payGroupId] : undefined,
  }), [tab, search, payGroupId, offset]);

  const q = usePayslipBatches(req);
  const payGroupsQ = usePayGroups(true);
  const result = q.data;
  const items = result?.items ?? [];
  const counts = result?.tabCounts;
  const agg = result?.aggregates;
  const payGroups = payGroupsQ.data ?? [];

  const changeTab = (t: PayslipBatchTab): void => { setTab(t); setOffset(0); };
  const total = result?.total ?? 0;

  return (
    <div class="psb">
      <header class="psb-lead">
        <div>
          <div class="psb-crumbs"><span>Payroll</span><span class="sep">›</span><b>Payslip Batches</b></div>
          <h1>Payslip Batches</h1>
          <p>Track generation, rendering and protected delivery for every locked payroll run.</p>
        </div>
        <div class="psb-lead-actions">
          <button type="button" class="psb-icon-btn" aria-label="Refresh batches" title="Refresh" onClick={() => void q.refetch()}>
            <i class="fa-solid fa-rotate" />
          </button>
        </div>
      </header>

      {/* KPI strip — real aggregates over the filtered set */}
      <section class="psb-metrics">
        <Metric ico="blue"  icon="fa-layer-group"           k="Active Batches"    v={agg?.activeBatches} loading={q.isLoading} />
        <Metric ico="green" icon="fa-file-pdf"              k="Rendered"          v={agg?.rendered}      loading={q.isLoading} />
        <Metric ico="green" icon="fa-paper-plane"           k="Delivered"         v={agg?.delivered}     loading={q.isLoading} />
        <Metric ico="red"   icon="fa-envelope-circle-check" k="Delivery Failures" v={agg?.failed}        loading={q.isLoading} />
      </section>

      <section class="psb-shell">
        <div class="psb-titlebar">
          <div><h2>Payslip Batch Register</h2><p>One governed batch per locked payroll run and template snapshot.</p></div>
          <div class="psb-count"><strong>{total}</strong> Batches</div>
        </div>

        <div class="psb-tabs" role="tablist">
          {TABS.map(t => (
            <button key={t.key} type="button" class={tab === t.key ? 'on' : ''} onClick={() => changeTab(t.key)}>
              {t.label} <span>{counts ? counts[t.key] : '—'}</span>
            </button>
          ))}
        </div>

        <div class="psb-toolbar">
          <label class="psb-search">
            <i class="fa-solid fa-magnifying-glass" />
            <input type="search" placeholder="Search batch, payroll run or pay group"
              value={searchInput} onInput={e => setSearchInput((e.target as HTMLInputElement).value)} />
          </label>
          <select class="psb-select" aria-label="Filter by pay group" value={payGroupId}
            onChange={e => { setPayGroupId((e.target as HTMLSelectElement).value); setOffset(0); }}>
            <option value="all">All Pay Groups</option>
            {payGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        <div class="psb-table-wrap">
          <table class="psb-table">
            <thead><tr>
              <th>Batch</th><th>Pay Group</th><th>Pay Date</th><th class="num">Employees</th>
              <th>Template</th><th>Delivery Progress</th><th>Lifecycle</th><th>Owner</th><th aria-label="Open" />
            </tr></thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={9} class="psb-loading"><span class="psb-skel" /></td></tr>}
              {q.isError && (
                <tr><td colSpan={9} class="psb-empty"><i class="fa-solid fa-triangle-exclamation" />
                  <strong>Could not load the batch register</strong><small>Retry, or adjust the filters.</small></td></tr>
              )}
              {!q.isLoading && !q.isError && items.length === 0 && (
                <tr><td colSpan={9} class="psb-empty"><i class="fa-regular fa-folder-open" />
                  <strong>No payslip batches match this view</strong><small>Change a filter or clear the search.</small></td></tr>
              )}
              {!q.isLoading && items.map(b => <BatchRow key={b.id} b={b} onOpen={() => openRun(b.id)} />)}
            </tbody>
          </table>
        </div>

        <footer class="psb-foot">
          <span>{items.length ? `Showing ${offset + 1}-${offset + items.length} of ${total}` : ''}</span>
          <div class="psb-pager">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))} aria-label="Previous"><i class="fa-solid fa-chevron-left" /></button>
            <button type="button" disabled={offset + items.length >= total} onClick={() => setOffset(o => o + LIMIT)} aria-label="Next"><i class="fa-solid fa-chevron-right" /></button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function BatchRow({ b, onOpen }: { b: PayslipBatchListItem; onOpen: () => void }): VNode {
  const g = b.counts.generated;
  const lc = LC_PILL.get(b.lifecycle) ?? 'grey';
  // Segments over the generated total: delivered · failed · rendered-not-delivered · not-rendered.
  const deliveredW = pct(b.counts.delivered, g);
  const failedW    = pct(b.counts.failed, g);
  const pendingW   = pct(Math.max(0, b.counts.rendered - b.counts.delivered - b.counts.failed), g);
  return (
    <tr class="psb-row" onClick={onOpen} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      <td><strong>{b.reference}</strong><small class="cap">{b.runState}</small></td>
      <td><strong>{b.payGroup.name ?? '—'}</strong></td>
      <td><strong>{fmtDate(b.payDate)}</strong></td>
      <td class="num"><strong>{num(g)}</strong><small>{b.counts.rendered} rendered</small></td>
      <td><strong>{b.template.name ?? 'Default'}</strong>{b.template.status && <small class="cap">{b.template.status}</small>}</td>
      <td>
        <div class="psb-bar" title={`${b.counts.delivered} delivered · ${b.counts.failed} failed · ${g} generated`}>
          <span class="delivered" style={{ width: `${deliveredW}%` }} />
          <span class="failed" style={{ width: `${failedW}%` }} />
          <span class="pending" style={{ width: `${pendingW}%` }} />
        </div>
        <small>{b.counts.delivered} delivered{g > 0 ? ` · ${pct(b.counts.delivered, g)}%` : ''}{b.counts.failed > 0 ? ` · ${b.counts.failed} failed` : ''}</small>
      </td>
      <td><span class={`psb-pill ${lc}`}><i class="psb-dot" />{b.lifecycleLabel}</span></td>
      <td class="psb-owner">{b.owner.name ?? '—'}</td>
      <td class="psb-open"><i class="fa-solid fa-arrow-right" /></td>
    </tr>
  );
}

function Metric({ ico, icon, k, v, loading }: { ico: string; icon: string; k: string; v?: number; loading?: boolean }): VNode {
  return (
    <div class="psb-metric">
      <div class={`psb-mico ${ico}`}><i class={`fa-solid ${icon}`} /></div>
      <div>
        <div class="psb-mk">{k}</div>
        <div class="psb-mv">{loading ? <span class="psb-skel" style={{ width: 44, height: 18 }} /> : num(v ?? 0)}</div>
      </div>
    </div>
  );
}
