// Payroll Runs Register (F-03, spec §15.2) — full-page operational register.
// Reference design: mockups/payroll-enterprise/runs.html (re-implemented to the
// Siomac standard with scoped .prr-* classes). Backed by the merged keyset
// runs/list + run-views/* + runs/calendar routes (payrollRunsRegister API).
//
// Row-open navigates to the Command Center's full-page run detail (which owns the
// run-lifecycle actions — that is the F-04 Run Workspace slice); this page only
// LISTS + filters + saved-views + shows the pay-date calendar. "New Payroll Run"
// reuses the create-run wizard in place.

import { useMemo, useState, useEffect } from 'preact/hooks';
import type { VNode } from 'preact';
import { toast } from '@store';
import { showSection } from '@components/nav/navCore';
import {
  useRunsRegister, useRunViews, useRunCalendar, useRunViewMutations,
} from '@api/finance/payrollRunsRegister';
import { usePayGroups, type PayrollRun } from '@api/finance/payroll';
import { PayNewRunWizard } from './PayNewRunWizard';
import type {
  PayrollRunListItem, PayrollRunListTab, PayrollRunState, PayrollRunSort,
  PayrollRunView, PayrollRunViewFilters,
} from '../../../../types/payrollRuns';
import type { PayrollRunType } from '../../../../types/payrollControlCenter';
import './payrollRunsRegister.css';

// ── Presentation maps ────────────────────────────────────────────────────────
const TABS: { key: PayrollRunListTab; label: string }[] = [
  { key: 'all',          label: 'All' },
  { key: 'in_progress',  label: 'Active' },
  { key: 'attention',    label: 'Needs Action' },
  { key: 'approval',     label: 'Awaiting Approval' },
  { key: 'released',     label: 'Released' },
];
// Map (not Record): .get() is `T | undefined` for BOTH tsc (noUncheckedIndexedAccess)
// and eslint, so the fallback below is legitimately required and neither tool fights it.
const STATE_PILL = new Map<PayrollRunState, { cls: string; label: string }>([
  ['draft',              { cls: 'grey',  label: 'Draft' }],
  ['input_locked',       { cls: 'blue',  label: 'Inputs Locked' }],
  ['calculation_failed', { cls: 'red',   label: 'Failed' }],
  ['calculated',         { cls: 'amber', label: 'Calculated' }],
  ['pending_approval',   { cls: 'amber', label: 'Pending Approval' }],
  ['returned',           { cls: 'amber', label: 'Returned' }],
  ['approved',           { cls: 'blue',  label: 'Approved' }],
  ['locked',             { cls: 'green', label: 'Locked' }],
  ['released',           { cls: 'green', label: 'Released' }],
  ['exported',           { cls: 'green', label: 'Exported' }],
  ['cancelled',          { cls: 'grey',  label: 'Cancelled' }],
]);
const pillFor = (s: PayrollRunState): { cls: string; label: string } =>
  STATE_PILL.get(s) ?? { cls: 'grey', label: s };
const RUN_TYPES: { value: PayrollRunType | 'all'; label: string }[] = [
  { value: 'all',        label: 'All Run Types' },
  { value: 'scheduled',  label: 'Scheduled' },
  { value: 'off_cycle',  label: 'Off-Cycle' },
  { value: 'correction', label: 'Correction' },
  { value: 'final_pay',  label: 'Final Pay' },
];
const SORTS: { value: PayrollRunSort; label: string }[] = [
  { value: 'pay_date_desc', label: 'Pay date (newest)' },
  { value: 'pay_date_asc',  label: 'Pay date (oldest)' },
  { value: 'updated_desc',  label: 'Recently updated' },
];
// Maps the readiness STATE (not_started | in_progress | blocked | ready |
// released) to the stage-bar colour class. The old map keyed on the wrong
// vocabulary ('warning'/'blocker'), so released runs rendered blue instead of
// green and blocked runs got no red.
const READINESS_CLS = new Map<string, string>([
  ['released', 'ready'],
  ['ready', 'ready'],
  ['blocked', 'bad'],
  ['in_progress', 'warn'],
]);

const money = (n: number | null): string =>
  n == null ? 'Not available' : `TTD ${Math.round(n).toLocaleString('en-US')}`;
const fmtDate = (d: string | null): string =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
const dayNum = (d: string): string => String(new Date(`${d}T00:00:00`).getUTCDate()).padStart(2, '0');

const DEFAULT_FILTERS: PayrollRunViewFilters = { sort: 'pay_date_desc' };

export function PayrollRunRegisterPage(): VNode {
  const [wizOpen, setWizOpen] = useState(false);

  const [tab, setTab]           = useState<PayrollRunListTab>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]     = useState('');
  const [runType, setRunType]   = useState<PayrollRunType | 'all'>('all');
  const [payGroupId, setPayGroupId] = useState<string>('all');
  const [sort, setSort]         = useState<PayrollRunSort>('pay_date_desc');
  const [cursor, setCursor]     = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  // Debounce the search box → the applied `search` filter.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); resetPage(); }, 300);
    return () => clearTimeout(t);
     
  }, [searchInput]);

  function resetPage(): void { setCursor(undefined); setCursorStack([]); }

  const req = useMemo(() => ({
    tab,
    search:      search || undefined,
    runTypes:    runType !== 'all' ? [runType] : undefined,
    payGroupIds: payGroupId !== 'all' ? [payGroupId] : undefined,
    sort,
    cursor,
    limit: 25,
  }), [tab, search, runType, payGroupId, sort, cursor]);

  const listQ     = useRunsRegister(req);
  const payGroupsQ = usePayGroups(true);
  const viewsQ    = useRunViews();
  const viewMut   = useRunViewMutations();

  const today = new Date();
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const calFrom = iso(today);
  const calTo   = iso(new Date(today.getTime() + 60 * 86_400_000));
  const calendarQ = useRunCalendar({ from: calFrom, to: calTo });

  const result   = listQ.data;
  const items    = result?.items ?? [];
  const counts   = result?.tabCounts;
  const agg      = result?.aggregates;
  const payGroups = payGroupsQ.data ?? [];
  const views    = viewsQ.data ?? [];
  const fundedPct = agg && agg.fundingRequired.amount > 0
    ? `${Math.round((agg.fundingConfirmed.amount / agg.fundingRequired.amount) * 100)}% funded`
    : 'Fully funded';

  // ── Filter / paging handlers ───────────────────────────────────────────────
  const changeTab = (t: PayrollRunListTab): void => { setTab(t); resetPage(); };
  const changeRunType = (v: PayrollRunType | 'all'): void => { setRunType(v); resetPage(); };
  const changePayGroup = (v: string): void => { setPayGroupId(v); resetPage(); };
  const changeSort = (v: PayrollRunSort): void => { setSort(v); resetPage(); };
  const nextPage = (): void => {
    if (!result?.nextCursor) return;
    setCursorStack(s => [...s, cursor]);
    setCursor(result.nextCursor);
  };
  const prevPage = (): void => {
    setCursorStack(s => { const c = [...s]; const prev = c.pop(); setCursor(prev); return c; });
  };

  const openRun = (id: string): void => {
    try { sessionStorage.setItem('siomac_open_payroll_run', id); } catch { /* ignore */ }
    showSection('s-finance-payroll');
  };
  const onCreated = (run: PayrollRun): void => { setWizOpen(false); openRun(run.id); };

  // ── Saved views ────────────────────────────────────────────────────────────
  const applyView = (v: PayrollRunView): void => {
    setActiveViewId(v.id);
    const f = v.filters;
    setRunType(f.runTypes?.[0] ?? 'all');
    setPayGroupId(f.payGroupIds?.[0] ?? 'all');
    setSort(f.sort ?? 'pay_date_desc');
    setSearch(f.search ?? ''); setSearchInput(f.search ?? '');
    resetPage();
  };
  const applyDefaultView = (): void => {
    setActiveViewId(''); setRunType('all'); setPayGroupId('all'); setSort('pay_date_desc');
    setSearch(''); setSearchInput(''); resetPage();
  };
  const saveView = async (): Promise<void> => {
    const name = saveName.trim();
    if (!name) { toast('Enter a name for the view.'); return; }
    const filters: PayrollRunViewFilters = {
      ...DEFAULT_FILTERS,
      sort,
      ...(search ? { search } : {}),
      ...(runType !== 'all' ? { runTypes: [runType] } : {}),
      ...(payGroupId !== 'all' ? { payGroupIds: [payGroupId] } : {}),
    };
    try {
      const v = await viewMut.create.mutateAsync({ name, scope: 'personal', filters });
      setActiveViewId(v.id); setSaveOpen(false); setSaveName('');
      toast(`Saved view “${name}”.`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save the view.'); }
  };
  const deleteActiveView = async (): Promise<void> => {
    const v = views.find(x => x.id === activeViewId);
    if (!v?.isOwn) return;
    try { await viewMut.remove.mutateAsync(v.id); applyDefaultView(); toast('View deleted.'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not delete the view.'); }
  };

  // ── Create-run wizard replaces the page in place ───────────────────────────
  if (wizOpen) return <PayNewRunWizard onClose={() => setWizOpen(false)} onCreated={onCreated} />;

  const nextCal = calendarQ.data?.instances[0] ?? null;

  return (
    <div class="prr">
      <header class="prr-lead">
        <div>
          <div class="prr-crumbs"><span>Payroll</span><span class="sep">›</span><b>Payroll Runs</b></div>
          <h1>Payroll Runs</h1>
          <p>Every scheduled, off-cycle, correction and final-pay run from one operational register.</p>
        </div>
        <div class="prr-lead-actions">
          <button type="button" class="prr-btn primary" onClick={() => setWizOpen(true)}>
            <i class="fa-solid fa-plus" /> New Payroll Run
          </button>
        </div>
      </header>

      {/* ── KPI strip (derived from real tab counts + calendar; nothing fabricated) ── */}
      <section class="prr-metrics">
        <Metric ico="blue" icon="fa-spinner" k="Active Runs"       v={counts?.in_progress} loading={listQ.isLoading} />
        <Metric ico="red"  icon="fa-triangle-exclamation" k="Need Action"       v={counts?.attention}   loading={listQ.isLoading} />
        <Metric ico="amber" icon="fa-user-check" k="Awaiting Approval" v={counts?.approval}   loading={listQ.isLoading} />
        <Metric ico="green" icon="fa-circle-check" k="Released"          v={counts?.released}    loading={listQ.isLoading} />
        <Metric ico="amber" icon="fa-building-columns" k="Funding Gap"
          text={agg ? money(agg.fundingGap.amount) : '—'} sub={agg ? fundedPct : undefined}
          loading={listQ.isLoading} />
        <Metric ico="green" icon="fa-lock" k="Closed Net"
          text={agg ? money(agg.closedNet.amount) : '—'} sub={agg ? 'Released & exported' : undefined}
          loading={listQ.isLoading} />
        <Metric ico="blue" icon="fa-calendar-day" k="Next Pay Date"
          text={nextCal ? fmtDate(nextCal.payDate) : (calendarQ.isLoading ? '' : '—')}
          sub={nextCal ? nextCal.payGroup.name : undefined} loading={calendarQ.isLoading && !nextCal} />
      </section>

      {/* ── Register shell ── */}
      <section class="prr-shell">
        <div class="prr-titlebar">
          <div><h2>Run Register</h2><p>Lifecycle status, approved values and the run's readiness.</p></div>
          <div class="prr-count"><strong>{result?.total ?? 0}</strong> Runs</div>
        </div>

        <div class="prr-tabs" role="tablist">
          {TABS.map(t => (
            <button key={t.key} type="button" class={tab === t.key ? 'on' : ''} onClick={() => changeTab(t.key)}>
              {t.label} <span>{counts ? counts[t.key] : '—'}</span>
            </button>
          ))}
        </div>

        <div class="prr-toolbar">
          <label class="prr-search">
            <i class="fa-solid fa-magnifying-glass" />
            <input type="search" placeholder="Search run or pay group"
              value={searchInput} onInput={e => setSearchInput((e.target as HTMLInputElement).value)} />
          </label>
          <select class="prr-select" aria-label="Filter by run type"
            value={runType} onChange={e => changeRunType((e.target as HTMLSelectElement).value as PayrollRunType | 'all')}>
            {RUN_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select class="prr-select" aria-label="Filter by pay group"
            value={payGroupId} onChange={e => changePayGroup((e.target as HTMLSelectElement).value)}>
            <option value="all">All Pay Groups</option>
            {payGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select class="prr-select" aria-label="Sort" value={sort}
            onChange={e => changeSort((e.target as HTMLSelectElement).value as PayrollRunSort)}>
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <div class="prr-view">
            <select class="prr-select" aria-label="Saved view" value={activeViewId}
              onChange={e => {
                const id = (e.target as HTMLSelectElement).value;
                if (!id) { applyDefaultView(); return; }
                const v = views.find(x => x.id === id); if (v) applyView(v);
              }}>
              <option value="">Default register</option>
              {views.map(v => <option key={v.id} value={v.id}>{v.name}{v.scope === 'team' ? ' (team)' : ''}</option>)}
            </select>
            <button type="button" class="prr-icon-btn" title="Save current view" aria-label="Save current view"
              onClick={() => { setSaveOpen(o => !o); setSaveName(''); }}>
              <i class="fa-regular fa-bookmark" />
            </button>
            {activeViewId && views.find(x => x.id === activeViewId)?.isOwn && (
              <button type="button" class="prr-icon-btn" title="Delete saved view" aria-label="Delete saved view"
                onClick={() => void deleteActiveView()}>
                <i class="fa-regular fa-trash-can" />
              </button>
            )}
          </div>
        </div>

        {saveOpen && (
          <div class="prr-saverow">
            <input type="text" placeholder="View name (e.g. Weekly runs needing action)" value={saveName}
              onInput={e => setSaveName((e.target as HTMLInputElement).value)} maxLength={80} />
            <button type="button" class="prr-btn primary" disabled={viewMut.create.isPending} onClick={() => void saveView()}>
              Save personal view
            </button>
            <button type="button" class="prr-btn" onClick={() => setSaveOpen(false)}>Cancel</button>
          </div>
        )}

        <div class="prr-table-wrap">
          <table class="prr-table">
            <thead><tr>
              <th>Run</th><th>Pay Group</th><th>Period &amp; Pay Date</th>
              <th class="num">Net Payroll</th><th>Lifecycle</th><th>Status</th><th>Owner</th><th aria-label="Open" />
            </tr></thead>
            <tbody>
              {listQ.isLoading && (
                <tr><td colSpan={8} class="prr-loading"><span class="prr-skel" /></td></tr>
              )}
              {listQ.isError && (
                <tr><td colSpan={8} class="prr-empty"><i class="fa-solid fa-triangle-exclamation" />
                  <strong>Could not load the register</strong><small>Retry, or adjust the filters.</small></td></tr>
              )}
              {!listQ.isLoading && !listQ.isError && items.length === 0 && (
                <tr><td colSpan={8} class="prr-empty"><i class="fa-regular fa-folder-open" />
                  <strong>No payroll runs match this view</strong><small>Change a filter or clear the search.</small></td></tr>
              )}
              {!listQ.isLoading && items.map(r => <RunRow key={r.id} r={r} onOpen={() => openRun(r.id)} />)}
            </tbody>
          </table>
        </div>

        <footer class="prr-foot">
          <span>{items.length ? `Showing ${items.length} of ${result?.total ?? items.length} runs` : ''}</span>
          <div class="prr-pager">
            <button type="button" disabled={cursorStack.length === 0} onClick={prevPage} aria-label="Previous page">
              <i class="fa-solid fa-chevron-left" />
            </button>
            <button type="button" disabled={!result?.nextCursor} onClick={nextPage} aria-label="Next page">
              <i class="fa-solid fa-chevron-right" />
            </button>
          </div>
        </footer>
      </section>

      {/* ── Upcoming pay-date calendar ── */}
      <section class="prr-shell">
        <div class="prr-titlebar">
          <div><h2>Upcoming Payroll Calendar</h2><p>Schedule-derived pay-date workload for the next 60 days.</p></div>
        </div>
        <div class="prr-cal">
          {calendarQ.isLoading && <span class="prr-skel" style={{ height: 72 }} />}
          {!calendarQ.isLoading && (calendarQ.data?.instances.length ?? 0) === 0 && (
            <div class="prr-empty small"><i class="fa-regular fa-calendar" /><strong>No scheduled pay dates in the window</strong></div>
          )}
          {(calendarQ.data?.instances ?? []).slice(0, 8).map(inst => (
            <article class="prr-cal-card" key={inst.key}>
              <div class="prr-cal-head"><strong>{fmtDate(inst.payDate)}</strong>
                <span>{inst.run ? pillFor(inst.run.state).label : 'Not created'}</span></div>
              <div class="prr-cal-run">
                <span class="prr-cal-day">{dayNum(inst.payDate)}</span>
                <div><strong>{inst.payGroup.name}</strong>
                  <small>{inst.period.startsOn} → {inst.period.endsOn}</small></div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────
function RunRow({ r, onOpen }: { r: PayrollRunListItem; onOpen: () => void }): VNode {
  const pill = pillFor(r.state);
  const rc = READINESS_CLS.get(r.readiness.state) ?? '';
  return (
    <tr class="prr-row" onClick={onOpen} tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      <td>
        <strong>{r.reference}</strong>
        <small class="cap">{r.runType.replace('_', ' ')}</small>
        {r.correctionOf && <a class="prr-chain" onClick={e => { e.stopPropagation(); onOpen(); }}>
          <i class="fa-solid fa-code-branch" /> Corrects {r.correctionOf.reference}</a>}
      </td>
      <td><strong>{r.payGroup.name ?? '—'}</strong>
        <small class="cap">{r.payGroup.frequency ?? ''} · {r.population.included} incl.</small></td>
      <td><strong>{r.period.startsOn} → {r.period.endsOn}</strong>
        <small>Pay date {fmtDate(r.period.payDate)}</small></td>
      <td class="num"><strong>{money(r.totals.net)}</strong>
        <small>Gross {money(r.totals.gross)}</small></td>
      <td>
        <div class={`prr-stage ${rc}`} style={{ '--p': `${r.readiness.percent ?? 0}%` }}>
          <span /><b>{r.readiness.percent != null ? `${r.readiness.percent}%` : '—'}</b>
        </div>
        <small>{r.readiness.label}{r.readiness.blockers > 0 ? ` · ${r.readiness.blockers} blocker${r.readiness.blockers === 1 ? '' : 's'}` : ''}</small>
      </td>
      <td><span class={`prr-pill ${pill.cls}`}><i class="prr-dot" />{pill.label}</span></td>
      <td class="prr-owner">{r.owner.name ?? '—'}</td>
      <td class="prr-open"><i class="fa-solid fa-arrow-right" /></td>
    </tr>
  );
}

// ── KPI metric card ───────────────────────────────────────────────────────────
function Metric({ ico, icon, k, v, text, sub, loading }:
  { ico: string; icon: string; k: string; v?: number; text?: string; sub?: string; loading?: boolean }): VNode {
  return (
    <div class="prr-metric">
      <div class={`prr-mico ${ico}`}><i class={`fa-solid ${icon}`} /></div>
      <div>
        <div class="prr-mk">{k}</div>
        <div class="prr-mv">{loading ? <span class="prr-skel" style={{ width: 40, height: 18 }} />
          : (text ?? v ?? 0)}</div>
        {sub && <div class="prr-ms">{sub}</div>}
      </div>
    </div>
  );
}
