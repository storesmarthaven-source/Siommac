// Payroll Approvals & Exceptions (F-06/F-07, spec §15.3) — the unified work-queue page.
// Reference: mockups/payroll-enterprise/exceptions.html + approval.html (re-implemented
// to the Siomac standard, scoped .pxq-*). ONE tabbed queue over the merged §15.3 backend
// (findings/work-queue keyset union of findings + open approval workflow-tasks).
//
// Approval-kind rows are REVIEW-ONLY (DEC-EXC-004): "Review" deep-links to the run
// workspace's Approvals tab (the central workflow decision path); approve/return/reject
// never happen here. Finding rows open a detail drawer with the activity feed + the
// version-guarded lifecycle actions the row/actor allows.
//
// Triage aids (all backed by the real read model): pay-date on every row, a run filter
// (RPC p_run_ids), and bulk reassign/waive over the selected open findings — the bulk
// path loops the same version-guarded, idempotent single-finding commands (no new endpoint,
// per-item optimistic-concurrency guard preserved, partial failure surfaced honestly).

import { useMemo, useState, useEffect } from 'preact/hooks';
import type { VNode } from 'preact';
import { toast } from '@store';
import { showSection } from '@components/nav/navCore';
import {
  useWorkQueue, useWorkQueueMutations,
  type PayrollFindingQueueItem, type PayrollFindingDetail, type PayrollWorkQueueTab,
  type PayrollWorkQueueSort,
  type PayrollFindingQueueSeverity, type PayrollFindingAllowedAction, type PayrollFindingActivityType,
} from '@api/finance/payrollExceptions';
import { useRunsRegister } from '@api/finance/payrollRunsRegister';
import { openHrEmployee } from '../HR/hrDeepLink';
import { EmployeePicker } from './_shared/pickers';
import { Modal } from '@ui/components/Modal';
import './payrollExceptions.css';

// ── Presentation maps ─────────────────────────────────────────────────────────
const TABS: { key: PayrollWorkQueueTab; label: string }[] = [
  { key: 'all',       label: 'All Open' },
  { key: 'approvals', label: 'My Approvals' },
  { key: 'blockers',  label: 'Blockers' },
  { key: 'warnings',  label: 'Warnings' },
  { key: 'resolved',  label: 'Resolved' },
];
const SEV_CLS = new Map<PayrollFindingQueueSeverity, string>([
  ['critical', 'crit'], ['high', 'high'], ['medium', 'med'], ['low', 'low'],
]);
const KIND_ICON = new Map<string, string>([
  ['approval', 'fa-user-check'], ['blocker', 'fa-ban'], ['warning', 'fa-triangle-exclamation'],
]);
const ACT_ICON = new Map<PayrollFindingActivityType, { icon: string; tone: string }>([
  ['created', { icon: 'fa-plus', tone: 'blue' }],
  ['assign', { icon: 'fa-user-pen', tone: 'blue' }],
  ['escalate', { icon: 'fa-arrow-up-right-dots', tone: 'amber' }],
  ['comment', { icon: 'fa-comment', tone: 'blue' }],
  ['resolve', { icon: 'fa-circle-check', tone: 'green' }],
  ['waive', { icon: 'fa-shield-halved', tone: 'amber' }],
  ['reopen', { icon: 'fa-rotate-left', tone: 'red' }],
]);

// Grouped-section headers (mirror the mockup's queue-section grouping by kind).
type SectionKey = 'approval' | 'blocker' | 'warning' | 'resolved';
const SECTION_META: Record<SectionKey, { label: string; sub: string; icon: string; tone: string }> = {
  approval: { label: 'Decisions Requiring Your Approval', sub: 'Ordered by due time',            icon: 'fa-user-check',           tone: 'amber' },
  blocker:  { label: 'Release-Blocking Findings',         sub: 'Must be closed before submission', icon: 'fa-ban',                  tone: 'red' },
  warning:  { label: 'Warnings Requiring Certification',  sub: 'Evidence and note required',       icon: 'fa-triangle-exclamation', tone: 'amber' },
  resolved: { label: 'Resolved Today',                    sub: 'Immutable resolution evidence retained', icon: 'fa-circle-check',   tone: 'green' },
};
const SECTION_ORDER: SectionKey[] = ['approval', 'blocker', 'warning'];

// Server-side sort options (the RPC's p_sort). 'priority' is the default triage order.
const SORT_OPTS: { key: PayrollWorkQueueSort; label: string }[] = [
  { key: 'priority', label: 'Priority (severity)' },
  { key: 'pay_date', label: 'Pay date — soonest' },
  { key: 'due_date', label: 'Due date — soonest' },
  { key: 'newest',   label: 'Newest first' },
  { key: 'oldest',   label: 'Oldest first' },
];

// Client-side grouping of the current page's rows into the mockup's labelled sections.
// 'resolved' tab collapses to one section; open tabs group by finding kind.
function groupQueue(items: PayrollFindingQueueItem[], tab: PayrollWorkQueueTab): { key: SectionKey; rows: PayrollFindingQueueItem[] }[] {
  if (tab === 'resolved') return items.length ? [{ key: 'resolved', rows: items }] : [];
  const byKind = new Map<string, PayrollFindingQueueItem[]>();
  for (const it of items) { const arr = byKind.get(it.kind) ?? []; arr.push(it); byKind.set(it.kind, arr); }
  const out: { key: SectionKey; rows: PayrollFindingQueueItem[] }[] = [];
  for (const k of SECTION_ORDER) { const rows = byKind.get(k); if (rows?.length) out.push({ key: k, rows }); }
  return out;
}

// KPI strip — every value comes from the real tabCounts; no fabricated metrics.
const METRICS: { key: PayrollWorkQueueTab; label: string; sub: string; icon: string; tone: string }[] = [
  { key: 'all',       label: 'Open Items',         sub: 'Across all runs',        icon: 'fa-layer-group',          tone: 'blue' },
  { key: 'approvals', label: 'Assigned Approvals', sub: 'Awaiting your decision', icon: 'fa-user-check',           tone: 'amber' },
  { key: 'blockers',  label: 'Blocking Findings',  sub: 'Release-blocking',       icon: 'fa-ban',                  tone: 'red' },
  { key: 'warnings',  label: 'Open Warnings',      sub: 'Need certification',     icon: 'fa-triangle-exclamation', tone: 'amber' },
  { key: 'resolved',  label: 'Resolved Today',     sub: 'Evidence retained',      icon: 'fa-circle-check',         tone: 'green' },
];

const fmtTTD = (n: number | null): string => (n == null ? '—' : `TTD ${Math.round(n).toLocaleString('en-US')}`);
const fmtPayDate = (iso: string | null): string =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No pay date';
const fmtDue = (iso: string | null): string => {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  return `Due ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
const isOverdue = (iso: string | null): boolean => (iso ? new Date(iso).getTime() < Date.now() : false);
const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const initials = (s: string): string => s.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '—';

// A row that carries lifecycle actions (open/in-progress finding) can be bulk-selected;
// approval rows are review-only and resolved/waived rows expose no bulk verbs.
const isBulkable = (row: PayrollFindingQueueItem): boolean =>
  row.kind !== 'approval' && row.allowedActions.includes('assign');

// Open a payroll run in the workspace (register's deep-link contract). An optional
// target tab deep-links straight to the relevant section (DEC-EXC-004): approval
// review → Approvals, finding evidence → Exceptions.
function openRun(runId: string, tab?: 'approvals' | 'exceptions'): void {
  try {
    sessionStorage.setItem('siomac_open_payroll_run', runId);
    if (tab) sessionStorage.setItem('siomac_open_payroll_run_tab', tab);
    else sessionStorage.removeItem('siomac_open_payroll_run_tab');
  } catch { /* ignore */ }
  showSection('s-finance-payroll');
}

export function PayrollExceptionQueuePage(): VNode {
  const [tab, setTab]     = useState<PayrollWorkQueueTab>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [ownerMe, setOwnerMe] = useState(false);
  const [sort, setSort] = useState<PayrollWorkQueueSort>('priority');
  const [runFilter, setRunFilter] = useState('');   // '' = all runs; else a run id → req.runIds
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);
  const [action, setAction] = useState<{ type: PayrollFindingAllowedAction; finding: PayrollFindingDetail } | null>(null);
  // Bulk selection is scoped to the current view (ids + versions from the visible page),
  // so the optimistic-concurrency guard is always fresh. Cleared on any scope change.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'assign' | 'waive' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); resetPage(); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Deep-link hint from the Command Center Review button: {tab, search}. One-shot.
  useEffect(() => {
    let hint: { tab?: string; search?: string } | null = null;
    try {
      const raw = sessionStorage.getItem('siomac_open_payroll_exceptions');
      if (raw) { hint = JSON.parse(raw) as { tab?: string; search?: string }; sessionStorage.removeItem('siomac_open_payroll_exceptions'); }
    } catch { /* ignore */ }
    if (hint?.tab && TABS.some(t => t.key === hint.tab)) setTab(hint.tab as PayrollWorkQueueTab);
    if (hint?.search) { setSearchInput(hint.search); setSearch(hint.search); }
  }, []);

  function resetPage(): void { setCursor(undefined); setCursorStack([]); setPicked(new Set()); }

  const req = useMemo(() => ({
    tab,
    sort,
    limit: 25,
    search: search || undefined,
    ownerId: ownerMe ? 'me' : undefined,
    runIds: runFilter ? [runFilter] : undefined,
    selectedId,
    cursor,
  }), [tab, sort, search, ownerMe, runFilter, selectedId, cursor]);

  const q       = useWorkQueue(req);
  const result  = q.data;
  const items   = result?.items ?? [];
  const counts  = result?.tabCounts;
  const selected = result?.selected ?? null;
  const mut     = useWorkQueueMutations();
  const groups  = useMemo(() => groupQueue(items, tab), [items, tab]);

  // Run options for the filter — a modest, cheap list keyed off the register read model.
  const runsQ = useRunsRegister({ tab: 'all', limit: 50 });
  const runOptions = runsQ.data?.items ?? [];

  // The selectable rows currently in view, and the live selection resolved to targets.
  const bulkableRows = useMemo(() => items.filter(isBulkable), [items]);
  const pickedRows   = useMemo(() => bulkableRows.filter(r => picked.has(r.id)), [bulkableRows, picked]);
  const allWaivable  = pickedRows.length > 0 && pickedRows.every(r => r.kind === 'warning');

  const changeTab = (t: PayrollWorkQueueTab): void => { setTab(t); setSelectedId(undefined); resetPage(); };
  const nextPage = (): void => { if (!result?.nextCursor) return; setCursorStack(s => [...s, cursor]); setCursor(result.nextCursor); setPicked(new Set()); };
  const prevPage = (): void => { setCursorStack(s => { const c = [...s]; const prev = c.pop(); setCursor(prev); return c; }); setPicked(new Set()); };

  const togglePick = (id: string): void => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = (): void => setPicked(prev => (prev.size >= bulkableRows.length && bulkableRows.length > 0 ? new Set() : new Set(bulkableRows.map(r => r.id))));

  const onRowOpen = (row: PayrollFindingQueueItem): void => {
    if (row.kind === 'approval') { openRun(row.run.id, 'approvals'); return; }  // review-only → workflow/approvals path
    setSelectedId(row.id);
  };

  return (
    <div class="pxq">
      <header class="pxq-lead">
        <div>
          <div class="pxq-crumbs"><span>Payroll</span><span class="sep">›</span><b>Approvals &amp; Exceptions</b></div>
          <h1>Approvals &amp; Exceptions</h1>
          <p>One work queue for payroll decisions, blocking controls and warnings — ordered by pay-date impact and due time.</p>
        </div>
        <div class="pxq-lead-actions">
          <button type="button" class="pxq-icon-btn" aria-label="Refresh queue" title="Refresh"
            onClick={() => void q.refetch()}><i class="fa-solid fa-rotate" /></button>
        </div>
      </header>

      <section class="pxq-metrics" aria-label="Work queue summary">
        {METRICS.map(m => (
          <button type="button" class={`pxq-metric${tab === m.key ? ' on' : ''}`} key={m.key}
            onClick={() => changeTab(m.key)} aria-pressed={tab === m.key} title={`Show ${m.label.toLowerCase()}`}>
            <div class={`pxq-mico ${m.tone}`}><i class={`fa-solid ${m.icon}`} /></div>
            <div class="pxq-m-body">
              <div class="pxq-m-k">{m.label}</div>
              <div class="pxq-m-v">{counts ? counts[m.key] : <span class="pxq-m-dash">—</span>}</div>
              <div class="pxq-m-s">{m.sub}</div>
            </div>
          </button>
        ))}
      </section>

      <div class="pxq-grid">
        {/* ── Queue board ── */}
        <section class="pxq-board">
          <div class="pxq-titlebar">
            <div><h2>Payroll Work Queue</h2><p>Critical items first; warnings need evidence to clear.</p></div>
            <div class="pxq-count"><strong>{result?.total ?? 0}</strong> Items</div>
          </div>

          <div class="pxq-tabs" role="tablist">
            {TABS.map(t => (
              <button key={t.key} type="button" class={tab === t.key ? 'on' : ''} onClick={() => changeTab(t.key)}>
                {t.label} <span>{counts ? counts[t.key] : '—'}</span>
              </button>
            ))}
          </div>

          <div class="pxq-toolbar">
            <label class="pxq-search">
              <i class="fa-solid fa-magnifying-glass" />
              <input type="search" placeholder="Search finding, run or employee"
                value={searchInput} onInput={e => setSearchInput((e.target as HTMLInputElement).value)} />
            </label>
            <label class="pxq-filter">
              <i class="fa-solid fa-filter" aria-hidden="true" />
              <select class="pxq-select" value={runFilter} aria-label="Filter by run"
                onChange={e => { setRunFilter((e.target as HTMLSelectElement).value); resetPage(); }}>
                <option value="">All runs</option>
                {runOptions.map(r => <option key={r.id} value={r.id}>{r.reference}</option>)}
              </select>
            </label>
            <label class="pxq-filter">
              <i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true" />
              <select class="pxq-select" value={sort} aria-label="Sort order"
                onChange={e => { setSort((e.target as HTMLSelectElement).value as PayrollWorkQueueSort); resetPage(); }}>
                {SORT_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
            <label class="pxq-owner">
              <input type="checkbox" checked={ownerMe} onChange={e => { setOwnerMe((e.target as HTMLInputElement).checked); resetPage(); }} />
              Assigned to me
            </label>
            {(runFilter || ownerMe || search) && (
              <button type="button" class="pxq-clear" onClick={() => { setRunFilter(''); setOwnerMe(false); setSearchInput(''); setSearch(''); resetPage(); }}>
                <i class="fa-solid fa-xmark" /> Clear filters
              </button>
            )}
          </div>

          {(runFilter || ownerMe) && (
            <div class="pxq-chips" aria-label="Active filters">
              {runFilter && <span class="pxq-chip">Run: {runOptions.find(r => r.id === runFilter)?.reference ?? runFilter}
                <button type="button" aria-label="Clear run filter" onClick={() => { setRunFilter(''); resetPage(); }}><i class="fa-solid fa-xmark" /></button></span>}
              {ownerMe && <span class="pxq-chip">Assigned to me
                <button type="button" aria-label="Clear owner filter" onClick={() => { setOwnerMe(false); resetPage(); }}><i class="fa-solid fa-xmark" /></button></span>}
            </div>
          )}

          {/* Bulk action bar — appears only when open findings are selected in view. */}
          {picked.size > 0 && (
            <div class="pxq-bulkbar" role="region" aria-label="Bulk actions">
              <label class="pxq-check"><input type="checkbox"
                checked={picked.size >= bulkableRows.length && bulkableRows.length > 0}
                onChange={toggleAll} aria-label="Select all in view" /></label>
              <strong>{picked.size} selected</strong>
              <div class="pxq-bulk-actions sp">
                <button type="button" class="pxq-btn" onClick={() => setBulk('assign')}>
                  <i class="fa-solid fa-user-pen" /> Reassign
                </button>
                <button type="button" class="pxq-btn" disabled={!allWaivable}
                  title={allWaivable ? undefined : 'Only warnings can be waived — deselect any blockers.'}
                  onClick={() => setBulk('waive')}>
                  <i class="fa-solid fa-shield-halved" /> Waive
                </button>
                <button type="button" class="pxq-btn" onClick={() => setPicked(new Set())}>Clear</button>
              </div>
            </div>
          )}

          <div class="pxq-list">
            {q.isLoading && <div class="pxq-skel" />}
            {q.isError && (
              <div class="pxq-empty"><i class="fa-solid fa-triangle-exclamation" />
                <strong>Could not load the work queue</strong><small>Retry, or adjust the filters.</small></div>
            )}
            {!q.isLoading && !q.isError && items.length === 0 && (
              <div class="pxq-empty"><i class="fa-regular fa-circle-check" />
                <strong>No queue items match this view</strong><small>Change a filter or clear the search.</small></div>
            )}
            {!q.isLoading && groups.map(g => {
              const m = SECTION_META[g.key];
              return (
                <div class="pxq-section" key={g.key}>
                  <div class={`pxq-section-head ${m.tone}`}>
                    <i class={`fa-solid ${m.icon}`} /> {m.label} <span>{m.sub}</span>
                  </div>
                  {g.rows.map(row => (
                    <QueueRow key={row.id} row={row} selected={row.id === selectedId}
                      picked={picked.has(row.id)} onPick={isBulkable(row) ? () => togglePick(row.id) : undefined}
                      onOpen={() => onRowOpen(row)} />
                  ))}
                </div>
              );
            })}
          </div>

          <footer class="pxq-foot">
            <span>{items.length ? `Showing ${items.length} of ${result?.total ?? items.length}${result?.asOf ? ` · Refreshed ${new Date(result.asOf).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}` : ''}</span>
            <div class="pxq-pager">
              <button type="button" disabled={cursorStack.length === 0} onClick={prevPage} aria-label="Previous"><i class="fa-solid fa-chevron-left" /></button>
              <button type="button" disabled={!result?.nextCursor} onClick={nextPage} aria-label="Next"><i class="fa-solid fa-chevron-right" /></button>
            </div>
          </footer>
        </section>

        {/* ── Detail panel ── */}
        <aside class="pxq-detail">
          {selected ? (
            <DetailPanel detail={selected} busy={anyPending(mut)} onAction={(type) => setAction({ type, finding: selected })} onOpenRun={(t) => openRun(selected.run.id, t)} />
          ) : (
            <div class="pxq-detail-empty">
              <i class="fa-regular fa-hand-pointer" />
              <strong>Select a finding</strong>
              <small>Open a blocker or warning to see its evidence, activity and the actions you can take.</small>
            </div>
          )}
        </aside>
      </div>

      {action && (
        <FindingActionModal
          action={action.type}
          finding={action.finding}
          mut={mut}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); }}
        />
      )}

      {bulk && (
        <BulkActionModal
          action={bulk}
          targets={pickedRows.map(r => ({ id: r.id, version: r.version }))}
          mut={mut}
          onClose={() => setBulk(null)}
          onDone={() => { setBulk(null); setPicked(new Set()); }}
        />
      )}
    </div>
  );
}

function anyPending(mut: ReturnType<typeof useWorkQueueMutations>): boolean {
  return mut.escalate.isPending || mut.comment.isPending || mut.assign.isPending
    || mut.resolve.isPending || mut.waive.isPending || mut.reopen.isPending;
}

// ── Queue row ───────────────────────────────────────────────────────────────
function QueueRow({ row, selected, picked, onPick, onOpen }: {
  row: PayrollFindingQueueItem; selected: boolean; picked: boolean;
  onPick?: () => void; onOpen: () => void;
}): VNode {
  const sev = SEV_CLS.get(row.severity) ?? 'low';
  const icon = KIND_ICON.get(row.kind) ?? 'fa-circle-dot';
  const overdue = isOverdue(row.dueAt);
  const cta = row.kind === 'approval' ? 'Review' : 'Open';
  // Scope suffix: run totals for approval rows (employees + net), amount when present.
  const scope = row.impact.employeeCount != null ? ` · ${row.impact.employeeCount} employees` : '';
  const amount = row.impact.amount != null ? ` · ${fmtTTD(row.impact.amount)}` : '';
  return (
    <div class={`pxq-item${selected ? ' on' : ''}${picked ? ' picked' : ''}`} role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <label class="pxq-check" onClick={e => e.stopPropagation()}>
        {onPick
          ? <input type="checkbox" checked={picked} onChange={onPick} aria-label={`Select ${row.title}`} />
          : <span class="pxq-check-spacer" aria-hidden="true" />}
      </label>
      <div class={`pxq-sev ${sev}`}><i class={`fa-solid ${icon}`} /></div>
      <div class="pxq-copy">
        <strong>{row.title}</strong>
        <small>{row.run.reference} · Pay {fmtPayDate(row.run.payDate)} · {row.summary}{scope}{amount}</small>
      </div>
      <div class="pxq-owner">
        {row.owner ? <><span class="pxq-av">{initials(row.owner.displayName)}</span>
          <div><strong>{row.owner.displayName}</strong><small>{row.owner.type === 'team' ? 'Team' : 'Owner'}</small></div></>
          : <><span class="pxq-av ghost"><i class="fa-regular fa-user" /></span><div><strong>Unassigned</strong><small>No owner</small></div></>}
      </div>
      <div class={`pxq-due${overdue ? ' overdue' : ''}`}>{overdue ? <><i class="fa-solid fa-clock" /> Overdue</> : fmtDue(row.dueAt)}</div>
      <button type="button" class={`pxq-go${row.kind === 'approval' ? ' primary' : ''}`}
        onClick={e => { e.stopPropagation(); onOpen(); }}>{cta} <i class="fa-solid fa-arrow-right" /></button>
    </div>
  );
}

// ── Detail panel ────────────────────────────────────────────────────────────
const ACTION_META: Record<PayrollFindingAllowedAction, { label: string; icon: string }> = {
  review:   { label: 'Review in workflow', icon: 'fa-arrow-up-right-from-square' },
  assign:   { label: 'Reassign', icon: 'fa-user-pen' },
  escalate: { label: 'Escalate', icon: 'fa-arrow-up-right-dots' },
  comment:  { label: 'Comment', icon: 'fa-comment' },
  resolve:  { label: 'Resolve', icon: 'fa-circle-check' },
  waive:    { label: 'Waive', icon: 'fa-shield-halved' },
  reopen:   { label: 'Reopen', icon: 'fa-rotate-left' },
};

function DetailPanel({ detail, busy, onAction, onOpenRun }: {
  detail: PayrollFindingDetail; busy: boolean;
  onAction: (a: PayrollFindingAllowedAction) => void;
  onOpenRun: (tab: 'approvals' | 'exceptions') => void;
}): VNode {
  const activity = detail.activity.items;
  const primaryActs = detail.allowedActions.filter(a => a === 'resolve' || a === 'review');
  const secondaryActs = detail.allowedActions.filter(a => a !== 'resolve' && a !== 'review');
  // Source evidence carries the record that triggered the finding + when it was observed.
  // We surface the human label + timestamp (never a raw id — resolving ids to navigable
  // records is a backend enrichment tracked separately).
  const evidence = detail.sourceEvidence.filter(e => e.occurredAt || e.label);
  return (
    <div class="pxq-detail-card">
      <header class="pxq-sum-head">
        <span>Selected Finding</span>
        <h3>{detail.title}</h3>
        <p>{detail.run.reference} · Pay {fmtPayDate(detail.run.payDate)} · {detail.subject.scopeLabel}</p>
      </header>
      <div class="pxq-sum-body">
        <p class="pxq-detail-summary">{detail.summary}</p>

        <dl class="pxq-facts">
          <div><dt>Trigger</dt><dd>{humanizeKey(detail.trigger.ruleKey)}</dd></div>
          <div><dt>Observed</dt><dd>{detail.trigger.observed}{detail.trigger.threshold ? ` (threshold ${detail.trigger.threshold})` : ''}</dd></div>
          <div><dt>Subject</dt><dd>
            {detail.subject.employeeId
              ? <button type="button" class="pxq-link" title="Open the affected employee's HR record"
                  onClick={() => openHrEmployee(detail.subject.employeeId!)}>
                  {detail.subject.displayName ?? detail.subject.scopeLabel} <i class="fa-solid fa-arrow-up-right-from-square" />
                </button>
              : (detail.subject.displayName ?? detail.subject.scopeLabel)}
          </dd></div>
          <div><dt>Impact</dt><dd>{detail.impact.amount != null ? fmtTTD(detail.impact.amount) : (detail.impact.label ?? '—')}</dd></div>
        </dl>

        {evidence.length > 0 && (
          <div class="pxq-evidence"><span>Source evidence</span>
            <ul>{evidence.map((e, i) => (
              <li key={i}><i class="fa-solid fa-file-lines" /> {humanizeKey(e.label)}
                {e.occurredAt && <em> · {fmtDateTime(e.occurredAt)}</em>}</li>
            ))}</ul></div>
        )}

        {detail.requiredEvidence.length > 0 && (
          <div class="pxq-required"><span>Required to clear</span>
            <ul>{detail.requiredEvidence.map(r => <li key={r}>{r}</li>)}</ul></div>
        )}

        {detail.resolution && (
          <div class="pxq-resolution"><i class="fa-solid fa-circle-check" />
            <div><strong>Resolved</strong><small>{detail.resolution.note}</small></div></div>
        )}

        <div class="pxq-sum-actions">
          {primaryActs.map(a => (
            <button key={a} type="button" class="pxq-btn primary" disabled={busy}
              onClick={() => (a === 'review' ? onOpenRun('approvals') : onAction(a))}>
              <i class={`fa-solid ${ACTION_META[a].icon}`} /> {ACTION_META[a].label}
            </button>
          ))}
          <button type="button" class="pxq-btn" onClick={() => onOpenRun('exceptions')}><i class="fa-solid fa-arrow-up-right-from-square" /> Open run evidence</button>
        </div>

        {secondaryActs.length > 0 && (
          <div class="pxq-finding-actions">
            {secondaryActs.map(a => (
              <button key={a} type="button" class="pxq-btn" disabled={busy} onClick={() => onAction(a)}>
                <i class={`fa-solid ${ACTION_META[a].icon}`} /> {ACTION_META[a].label}
              </button>
            ))}
          </div>
        )}

        <div class="pxq-activity-head">Activity <span>{detail.activity.total}</span></div>
        <div class="pxq-activity">
        {activity.length ? activity.map(a => {
          const v = ACT_ICON.get(a.activityType) ?? { icon: 'fa-circle', tone: 'blue' };
          return (
            <div class="pxq-act" key={a.id}>
              <span class={`pxq-act-dot ${v.tone}`}><i class={`fa-solid ${v.icon}`} /></span>
              <div><strong>{a.activityType === 'comment' ? (a.actorName ?? 'Someone') : labelActivity(a.activityType)}</strong>
                {a.body && <small>{a.body}</small>}
                {a.fromState && a.toState && <small>{a.fromState} → {a.toState}</small>}
                <em>{a.actorName ?? 'System'} · {fmtDateTime(a.createdAt)}</em></div>
            </div>
          );
        }) : <div class="pxq-empty small"><span>No activity yet.</span></div>}
        </div>
      </div>
    </div>
  );
}

function labelActivity(t: PayrollFindingActivityType): string {
  switch (t) {
    case 'created': return 'Finding raised';
    case 'assign': return 'Reassigned';
    case 'escalate': return 'Escalated';
    case 'resolve': return 'Resolved';
    case 'waive': return 'Waived';
    case 'reopen': return 'Reopened';
    case 'comment': return 'Comment';
  }
}

// Humanize a snake/dotted rule or source key for display (no raw machine tokens in the UI).
function humanizeKey(k: string): string {
  const s = k.replace(/[._]/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : k;
}

// ── Action modal (fully wired: version-guarded + idempotent + per-field validation) ──

function FindingActionModal({ action, finding, mut, onClose, onDone }: {
  action: PayrollFindingAllowedAction;
  finding: PayrollFindingDetail;
  mut: ReturnType<typeof useWorkQueueMutations>;
  onClose: () => void;
  onDone: () => void;
}): VNode | null {
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});

  if (action === 'review') return null;

  const key = (): string => crypto.randomUUID();
  const base = { expectedVersion: finding.version };

  const run = async (): Promise<void> => {
    const e: Record<string, string> = {};
    try {
      switch (action) {
        case 'comment':
          if (note.trim().length < 1) { e.note = 'Enter a comment.'; break; }
          await mut.comment.mutateAsync({ findingId: finding.id, idempotencyKey: key(), body: note.trim(), expectedVersion: finding.version });
          break;
        case 'escalate':
          if (!assigneeId) { e.assigneeId = 'Choose who to escalate to.'; break; }
          await mut.escalate.mutateAsync({ findingId: finding.id, ...base, idempotencyKey: key(), assigneeId, note: note.trim() || undefined });
          break;
        case 'assign':
          if (!assigneeId) { e.assigneeId = 'Choose an assignee.'; break; }
          await mut.assign.mutateAsync({ id: finding.id, ...base, idempotencyKey: key(), assigneeId, note: note.trim() || undefined });
          break;
        case 'resolve':
          if (note.trim().length < 1) { e.note = 'A resolution note is required.'; break; }
          await mut.resolve.mutateAsync({ id: finding.id, ...base, idempotencyKey: key(), note: note.trim(),
            evidence: { recordedVia: 'exceptions_queue', ...(evidenceRef.trim() ? { reference: evidenceRef.trim() } : {}) } });
          break;
        case 'waive':
          if (reason.trim().length < 1) { e.reason = 'A waiver reason is required.'; break; }
          await mut.waive.mutateAsync({ id: finding.id, ...base, idempotencyKey: key(), reason: reason.trim(), expiresAt: expiresAt || undefined });
          break;
        case 'reopen':
          if (reason.trim().length < 1) { e.reason = 'A reason to reopen is required.'; break; }
          await mut.reopen.mutateAsync({ id: finding.id, ...base, idempotencyKey: key(), reason: reason.trim() });
          break;
      }
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'The action could not be completed.');
      return;
    }
    if (Object.keys(e).length) { setErr(e); return; }
    toast(`${ACTION_META[action].label} recorded.`);
    onDone();
  };

  const needsAssignee = action === 'escalate' || action === 'assign';
  const needsNote = action === 'comment' || action === 'escalate' || action === 'assign' || action === 'resolve';
  const needsReason = action === 'waive' || action === 'reopen';

  return (
    <Modal open title={ACTION_META[action].label} sub={finding.title} icon={`fa-solid ${ACTION_META[action].icon}`}
      onClose={onClose} onSubmit={() => void run()} submitLabel={ACTION_META[action].label} submitDisabled={anyPending(mut)}>
      <div class="pxq-form">
        {needsAssignee && (
          <EmployeePicker label={action === 'escalate' ? 'Escalate to' : 'Reassign to'} value={assigneeId}
            onChange={v => setAssigneeId(v ?? '')} error={err.assigneeId} required />
        )}
        {action === 'resolve' && (
          <label class="pxq-field"><span>Evidence reference <em>(optional)</em></span>
            <input type="text" value={evidenceRef} maxLength={200}
              placeholder="e.g. HR change ref, ticket, document id"
              onInput={e => setEvidenceRef((e.target as HTMLInputElement).value)} /></label>
        )}
        {needsNote && (
          <label class="pxq-field"><span>{action === 'resolve' ? 'Resolution note' : action === 'comment' ? 'Comment' : 'Note'}{action === 'comment' || action === 'resolve' ? '' : ' (optional)'}</span>
            <textarea rows={4} value={note} maxLength={2000}
              placeholder={action === 'resolve' ? 'How was this cleared at the source?' : 'Add context…'}
              onInput={e => setNote((e.target as HTMLTextAreaElement).value)} />
            {err.note && <small class="pxq-err">{err.note}</small>}</label>
        )}
        {needsReason && (
          <label class="pxq-field"><span>{action === 'waive' ? 'Waiver reason' : 'Reason to reopen'}</span>
            <textarea rows={4} value={reason} maxLength={2000}
              placeholder={action === 'waive' ? 'Why is this warning accepted without resolution?' : 'Why is this being reopened?'}
              onInput={e => setReason((e.target as HTMLTextAreaElement).value)} />
            {err.reason && <small class="pxq-err">{err.reason}</small>}</label>
        )}
        {action === 'waive' && (
          <label class="pxq-field"><span>Waiver expires <em>(optional)</em></span>
            <input type="datetime-local" value={expiresAt}
              onInput={e => setExpiresAt((e.target as HTMLInputElement).value)} /></label>
        )}
      </div>
    </Modal>
  );
}

// ── Bulk action modal — reassign/waive over the selected open findings ─────────
// Loops the same version-guarded, idempotent single-finding commands; every item
// keeps its own optimistic-concurrency guard. Partial failure is reported honestly
// (items that changed under the actor are counted as failed, not silently skipped).

function BulkActionModal({ action, targets, mut, onClose, onDone }: {
  action: 'assign' | 'waive';
  targets: { id: string; version: number }[];
  mut: ReturnType<typeof useWorkQueueMutations>;
  onClose: () => void;
  onDone: () => void;
}): VNode {
  const [assigneeId, setAssigneeId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  const run = async (): Promise<void> => {
    const e: Record<string, string> = {};
    if (action === 'assign' && !assigneeId) e.assigneeId = 'Choose an assignee.';
    if (action === 'waive' && reason.trim().length < 1) e.reason = 'A waiver reason is required.';
    if (Object.keys(e).length) { setErr(e); return; }

    setRunning(true);
    let done = 0, failed = 0;
    for (const t of targets) {
      try {
        if (action === 'assign') {
          await mut.assign.mutateAsync({ id: t.id, expectedVersion: t.version, idempotencyKey: crypto.randomUUID(), assigneeId, note: note.trim() || undefined });
        } else {
          await mut.waive.mutateAsync({ id: t.id, expectedVersion: t.version, idempotencyKey: crypto.randomUUID(), reason: reason.trim() });
        }
        done++;
      } catch { failed++; }
    }
    setRunning(false);
    toast(failed
      ? `${done} ${action === 'assign' ? 'reassigned' : 'waived'} · ${failed} failed — they may have changed since; refresh and retry.`
      : `${done} finding${done === 1 ? '' : 's'} ${action === 'assign' ? 'reassigned' : 'waived'}.`);
    onDone();
  };

  const label = action === 'assign' ? 'Reassign selected' : 'Waive selected';
  return (
    <Modal open title={label} sub={`${targets.length} finding${targets.length === 1 ? '' : 's'} selected`}
      icon={`fa-solid ${action === 'assign' ? 'fa-user-pen' : 'fa-shield-halved'}`}
      onClose={onClose} onSubmit={() => void run()} submitLabel={running ? 'Working…' : label} submitDisabled={running}>
      <div class="pxq-form">
        {action === 'assign' && (
          <EmployeePicker label="Reassign all to" value={assigneeId} onChange={v => setAssigneeId(v ?? '')} error={err.assigneeId} required />
        )}
        {action === 'waive' && (
          <label class="pxq-field"><span>Waiver reason</span>
            <textarea rows={4} value={reason} maxLength={2000}
              placeholder="Applied to every selected warning — why is it accepted without resolution?"
              onInput={e => setReason((e.target as HTMLTextAreaElement).value)} />
            {err.reason && <small class="pxq-err">{err.reason}</small>}</label>
        )}
        <label class="pxq-field"><span>Note <em>(optional)</em></span>
          <textarea rows={3} value={note} maxLength={2000} placeholder="Add context applied to each item…"
            onInput={e => setNote((e.target as HTMLTextAreaElement).value)} /></label>
        <p class="pxq-bulk-note"><i class="fa-solid fa-circle-info" /> Applies to the {targets.length} selected item{targets.length === 1 ? '' : 's'} in view. Each keeps its own concurrency check; any that changed since selection are reported as failed.</p>
      </div>
    </Modal>
  );
}
