/**
 * OnboardingWorkQueue.tsx — the unified cross-case execution queue.
 *
 * ONE full-width operational table over the four onboarding work stores (tasks, handoffs,
 * blockers, evidence submissions). No charts, no WidgetBoard, no dashboard: this page is
 * for working a list down, not for looking at it.
 *
 * SERVER-AUTHORITATIVE
 * Search, every filter, the sort and the page all travel to `work-queue/list` and are
 * resolved by the hr_onboarding_work_queue RPC. Nothing is filtered, sorted or sliced in
 * this file — the `total` shown in the pager is Postgres's exact count, so it stays honest
 * beyond one page. The filter object is part of the query key, so any change refetches.
 *
 * SCOPE
 * Defaults to Assigned to Me for everyone. Team / All appear only for a user holding
 * hr.onboarding.view_team / view_all, and the server re-resolves scope on every request
 * and 403s an unauthorised one — the selector is convenience, not the gate.
 *
 * NOT A SECOND CASE PAGE
 * Row click opens the authoritative case. The drawer carries quick context and the two
 * evidence decisions only; anything deeper belongs to Case Detail.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { useQueryClient } from '@tanstack/preact-query';

import { DataTable, Modal, Field, TextInput, type DtAction, type DtActiveFilter, type DtColumn } from '@ui/index';
import { openActionModal, toActionRecord } from '@/components/common/actions';
import { can } from '@lib/permissions';
import { getUiPreference, saveUiPreference } from '@api/uiPreferences';
import {
  ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_KEY,
  ONBOARDING_WORK_QUEUE_PAGE_SIZES,
  ONBOARDING_WORK_QUEUE_VIEW_LIMITS,
  sanitizeOnboardingWorkQueueViews,
  type OnboardingWorkQueueView,
} from '../../../../types/uiPreferences';
import { useOnboardingWorkQueue, hrOnboardingApi } from '@api/hr/onboarding';
import { useOnboardingScope } from './useOnboardingScope';
import { OnboardingScopeSelector } from './OnboardingScopeSelector';
import type {
  OnboardingWorkItem, OnboardingWorkDueState, OnboardingWorkLifecycle,
  OnboardingWorkSortField, OnboardingWorkSourceType,
} from '../../../../types/hrOnboarding';
import './onboardingWorkQueue.css';

// ── label vocabularies ──────────────────────────────────────────────────────────
const SOURCE_LABEL: Record<OnboardingWorkSourceType, string> = {
  task: 'Task', handoff: 'Handoff', blocker: 'Blocker', evidence: 'Evidence Review',
};
const LIFECYCLE_LABEL: Record<OnboardingWorkLifecycle, string> = {
  open: 'Open', in_progress: 'In Progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled',
};
const DUE_LABEL: Record<OnboardingWorkDueState, string> = {
  all: 'Any Due Date', overdue: 'Overdue', due_today: 'Due Today',
  due_this_week: 'Due This Week', unscheduled: 'Unscheduled',
};
const QUEUE_LABEL: Record<string, string> = {
  hr: 'HR', it: 'IT', hse: 'HSE', training: 'Training', payroll: 'Payroll',
  security: 'Security', facilities: 'Facilities', finance: 'Finance', supervisor: 'Supervisor',
};
const humanQueue = (q: string | null): string =>
  !q ? '—' : QUEUE_LABEL[q] ?? q.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

/**
 * The queue RPC may return a machine key as supporting detail for generated work. Convert
 * only key-shaped values; ordinary descriptions keep their authored sentence casing.
 */
function displayDetail(value: string): string {
  const text = value.trim();
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(text)
    ? text.replace(/[_-]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
    : text;
}

const DEFAULT_FILTERS = {
  query: '', sourceTypes: [] as OnboardingWorkSourceType[],
  lifecycles: ['open', 'in_progress', 'blocked'] as OnboardingWorkLifecycle[],
  dueState: 'all' as OnboardingWorkDueState,
  unassigned: false,
};
type Filters = typeof DEFAULT_FILTERS;

/** Due-date presentation. An absent date is Unscheduled, never a blank cell. */
function DueCell({ dueAt }: { dueAt: string | null }): VNode {
  if (!dueAt) return <span class="owq-due owq-due-none">Unscheduled</span>;
  const due = new Date(dueAt);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  const tone = days < 0 ? 'overdue' : days === 0 ? 'today' : '';
  const rel = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `in ${days}d`;
  return (
    <span class={`owq-due ${tone ? `owq-due-${tone}` : ''}`}>
      <b>{due.toLocaleDateString(undefined, due.getFullYear() === today.getFullYear()
        ? { day: '2-digit', month: 'short' }
        : { day: '2-digit', month: 'short', year: 'numeric' })}</b>
      <small>{rel}</small>
    </span>
  );
}

export function OnboardingWorkQueue({ onBack, onOpenCase, onToast }: {
  onBack?: () => void;
  onOpenCase?: (caseId: string, focus?: { sourceType: string; sourceId: string }) => void;
  onToast?: (message: string) => void;
}): VNode {
  const qc = useQueryClient();
  const scopeState = useOnboardingScope();
  const canReview = can('hr.onboarding.task.manage');

  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [sort, setSort] = useState<{ field: OnboardingWorkSortField; dir: 'asc' | 'desc' }>({ field: 'due_at', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(ONBOARDING_WORK_QUEUE_PAGE_SIZES[0]);
  const [openRow, setOpenRow] = useState<OnboardingWorkItem | null>(null);
  const [views, setViews] = useState<OnboardingWorkQueueView[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState('');

  // Any change to what is being asked for returns to page 1 — otherwise a narrower filter
  // can leave the user stranded on a page that no longer exists.
  const patch = useCallback((next: Partial<Filters>) => {
    setFilters(f => ({ ...f, ...next })); setPage(1);
  }, []);

  // ── saved views (shared preference contract; server validates the same sanitizer) ──
  useEffect(() => {
    let alive = true;
    void getUiPreference(ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_KEY)
      .then(pref => { if (alive && pref) setViews(sanitizeOnboardingWorkQueueViews(pref.value)); })
      .catch(e => {
        if (!alive) return;
        onToast?.(e instanceof Error ? e.message : 'Saved views could not be loaded.');
      });
    return () => { alive = false; };
  }, [onToast]);

  const persistViews = useCallback(async (next: OnboardingWorkQueueView[]) => {
    setViews(next);
    try { await saveUiPreference(ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_KEY, next); }
    catch { onToast?.('Could not save your views.'); }
  }, [onToast]);

  const saveCurrentView = useCallback(() => {
    const name = viewName.trim();
    if (!name) return;
    if (views.length >= ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxViews) {
      onToast?.(`You can keep up to ${ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxViews} views.`); return;
    }
    void persistViews([...views, {
      id: `v-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${views.length + 1}`,
      name, scope: scopeState.scope,
      filters: {
        query: filters.query, sourceTypes: filters.sourceTypes, lifecycles: filters.lifecycles,
        dueState: filters.dueState, departmentIds: [], queues: [], accountableIds: [],
        unassigned: filters.unassigned,
      },
      sortBy: sort.field, sortDir: sort.dir, pageSize,
    }]);
    setSaveViewOpen(false);
    setViewName('');
  }, [viewName, views, filters, sort, pageSize, scopeState.scope, persistViews, onToast]);

  const applyView = useCallback((v: OnboardingWorkQueueView) => {
    setFilters({
      query: v.filters.query,
      sourceTypes: v.filters.sourceTypes as OnboardingWorkSourceType[],
      lifecycles: v.filters.lifecycles as OnboardingWorkLifecycle[],
      dueState: v.filters.dueState as OnboardingWorkDueState,
      unassigned: v.filters.unassigned,
    });
    setSort({ field: v.sortBy, dir: v.sortDir });
    setPageSize(v.pageSize);
    setPage(1);
    // A view may carry a scope the current user cannot hold; select() refuses it rather
    // than requesting a scope the server would 403.
    scopeState.select(v.scope as 'my' | 'team' | 'all');
  }, [scopeState]);

  // ── the one server request ────────────────────────────────────────────────────
  const args = useMemo(() => ({
    scope: scopeState.scope,
    query: filters.query.trim() || undefined,
    sourceTypes: filters.sourceTypes.length ? filters.sourceTypes : undefined,
    lifecycles: filters.lifecycles.length ? filters.lifecycles : undefined,
    dueState: filters.dueState === 'all' ? undefined : filters.dueState,
    unassigned: filters.unassigned || undefined,
    sort: { field: sort.field, direction: sort.dir },
    page, pageSize,
  }), [scopeState.scope, filters, sort, page, pageSize]);

  const q = useOnboardingWorkQueue(args);

  // Close the scope transition once the new scope's data has actually arrived. Without
  // this the selector stays `busy` forever after the first switch and silently swallows
  // every later click — Team applied, then All never fired.
  useEffect(() => {
    if (scopeState.changing && !q.isPending) scopeState.settled();
  }, [scopeState, q.isPending]);

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['hr', 'onboarding', 'work-queue'] });
  }, [qc]);

  // ── evidence decisions — the only mutations this page performs ────────────────
  const decide = useCallback(async (row: OnboardingWorkItem, decision: 'approved' | 'returned') => {
    let note: string | null = null;
    if (decision === 'returned') {
      const result = await openActionModal({
        title: 'Return evidence', icon: 'fa-rotate-left', tone: 'warning',
        record: toActionRecord({ title: row.title, subtitle: `${row.employeeName ?? 'Employee'} · ${row.caseNo}`, icon: 'fa-paperclip' }),
        reason: { required: true, label: 'Return reason', type: 'textarea', placeholder: 'Explain what must be corrected or resubmitted.' },
        whatNext: ['The submission returns to the accountable person for correction.'],
        confirmLabel: 'Return evidence',
      });
      if (!result.confirmed) return;
      note = result.reason?.trim() || null;
      if (!note) { onToast?.('A reason is required to return evidence.'); return; }
    }
    setBusy(true);
    try {
      await hrOnboardingApi.reviewEvidence({ evidenceId: row.sourceId, decision, note });
      onToast?.(decision === 'approved' ? 'Evidence approved.' : 'Evidence returned to the assignee.');
      setOpenRow(null);
      refresh();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Could not record that decision.');
    } finally { setBusy(false); }
  }, [onToast, refresh]);

  const openCase = useCallback((row: OnboardingWorkItem) => {
    onOpenCase?.(row.caseId, { sourceType: row.sourceType, sourceId: row.sourceId });
  }, [onOpenCase]);

  // ── columns ───────────────────────────────────────────────────────────────────
  const columns: DtColumn<OnboardingWorkItem>[] = useMemo(() => [
    {
      key: 'title', label: 'Work', width: 'minmax(240px, 2fr)', isPinned: true,
      sortAccessor: r => r.title,
      renderCell: r => (
        <div class="owq-work">
          <span class={`owq-type owq-type-${r.sourceType}`}>{SOURCE_LABEL[r.sourceType]}</span>
          <div class="owq-work-text">
            <strong>{r.title}</strong>
            {r.detail ? <small>{displayDetail(r.detail)}</small> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'employee_name', label: 'Employee', width: 'minmax(170px, 1.2fr)',
      sortAccessor: r => r.employeeName,
      renderCell: r => (
        <div class="owq-stack">
          <strong>{r.employeeName ?? '—'}</strong>
          <small>{r.caseNo}</small>
        </div>
      ),
    },
    {
      // The queue that PERFORMS the work, kept visually distinct from the person below.
      key: 'owning_queue', label: 'Owning Queue', width: 'minmax(130px, 1fr)',
      renderCell: r => (
        <div class="owq-stack">
          <span class="owq-queue">{humanQueue(r.owningQueue)}</span>
          <small>{r.departmentName ?? 'No department'}</small>
        </div>
      ),
    },
    {
      key: 'accountable', label: 'Accountable', width: 'minmax(150px, 1fr)',
      // Unassigned work still belongs to a queue — it is never a bare blank.
      renderCell: r => (r.accountableName
        ? <div class="owq-stack"><strong>{r.accountableName}</strong><small>Accountable</small></div>
        : <div class="owq-stack">
            <span class="owq-unassigned">Unassigned</span>
            <small>{humanQueue(r.owningQueue)}</small>
          </div>),
    },
    {
      key: 'due_at', label: 'Due', width: '150px',
      sortAccessor: r => r.dueAt,
      renderCell: r => <DueCell dueAt={r.dueAt} />,
    },
    {
      key: 'status', label: 'Status', width: '150px', align: 'left',
      sortAccessor: r => r.normalizedStatus,
      renderCell: r => (
        <span class={`owq-status owq-status-${r.normalizedStatus}`}
          title={`Source status: ${r.sourceStatus}`}>
          {LIFECYCLE_LABEL[r.normalizedStatus]}
        </span>
      ),
    },
  ], []);

  const rowActions = useCallback((r: OnboardingWorkItem): DtAction<OnboardingWorkItem>[] => {
    const acts: DtAction<OnboardingWorkItem>[] = [
      { key: 'open', label: 'Open in Case Detail', icon: 'file', onClick: openCase },
      { key: 'peek', label: 'Quick view', icon: 'view', onClick: row => setOpenRow(row) },
    ];
    // Evidence decisions are offered only where they are actually possible: a pending
    // submission, to a user who holds the review permission.
    if (r.sourceType === 'evidence' && r.sourceStatus === 'pending_review' && canReview) {
      acts.push({ key: 'approve', label: 'Approve evidence', icon: 'check', onClick: row => void decide(row, 'approved') });
      acts.push({ key: 'return', label: 'Return evidence', icon: 'reject', tone: 'danger', onClick: row => void decide(row, 'returned') });
    }
    return acts;
  }, [openCase, canReview, decide]);

  // ── active filter chips ───────────────────────────────────────────────────────
  const activeFilters: DtActiveFilter[] = [];
  if (filters.dueState !== 'all') {
    activeFilters.push({ label: DUE_LABEL[filters.dueState], onRemove: () => patch({ dueState: 'all' }) });
  }
  for (const t of filters.sourceTypes) {
    activeFilters.push({ label: SOURCE_LABEL[t], onRemove: () => patch({ sourceTypes: filters.sourceTypes.filter(x => x !== t) }) });
  }
  if (filters.unassigned) activeFilters.push({ label: 'Unassigned only', onRemove: () => patch({ unassigned: false }) });
  if (filters.lifecycles.length !== DEFAULT_FILTERS.lifecycles.length) {
    activeFilters.push({ label: `Status: ${filters.lifecycles.map(l => LIFECYCLE_LABEL[l]).join(', ') || 'None'}`,
      onRemove: () => patch({ lifecycles: [...DEFAULT_FILTERS.lifecycles] }) });
  }

  const errorText = q.isError
    ? (q.error instanceof Error ? q.error.message : 'The work queue could not be loaded.')
    : null;

  return (
    <section class="owq-page">
      <header class="owq-head">
        <div>
          {onBack && <button type="button" class="obx-back" onClick={onBack}>← Command Centre</button>}
          <h1>Work Queue</h1>
          <p>Every onboarding task, handoff, blocker and evidence review you are accountable for.</p>
        </div>
        <OnboardingScopeSelector
          scope={scopeState.scope} options={scopeState.options} visible={scopeState.visible}
          busy={scopeState.changing} onSelect={scopeState.select}
        />
      </header>

      {errorText && (
        <div class="owq-error" role="alert">
          <strong>The work queue could not be loaded.</strong>
          <span>{errorText}</span>
          <button type="button" class="btn" onClick={refresh}>Try again</button>
        </div>
      )}

      <DataTable<OnboardingWorkItem>
        ariaLabel="Onboarding work queue"
        noun="work items"
        columns={columns}
        rows={rows}
        rowKey={r => `${r.sourceType}:${r.sourceId}`}
        rowStatus={r => (r.normalizedStatus === 'blocked' ? 'danger'
          : r.dueAt && new Date(r.dueAt) < new Date() ? 'warning' : 'default')}
        rowActions={rowActions}
        onRowClick={openCase}
        selectedKey={openRow ? `${openRow.sourceType}:${openRow.sourceId}` : null}
        loading={q.isPending}
        skeletonRows={pageSize > 25 ? 12 : 8}
        emptyState={filters.query || activeFilters.length
          ? { icon: 'search', title: 'No work matches these filters', text: 'Clear a filter or widen the scope.' }
          : { icon: 'check', title: 'Nothing assigned to you', text: 'Work appears here as soon as it is assigned or falls due.' }}
        globalSearch={{
          value: filters.query,
          onChange: v => patch({ query: v }),
          placeholder: 'Search work, employee or case number…',
        }}
        filterChips={
          <>
            <select class="dt-filter" aria-label="Due state" value={filters.dueState}
              onChange={e => patch({ dueState: (e.target as HTMLSelectElement).value as OnboardingWorkDueState })}>
              {(Object.keys(DUE_LABEL) as OnboardingWorkDueState[]).map(k => <option key={k} value={k}>{DUE_LABEL[k]}</option>)}
            </select>
            <select class="dt-filter" aria-label="Work type"
              value={filters.sourceTypes[0] ?? ''}
              onChange={e => {
                const v = (e.target as HTMLSelectElement).value as OnboardingWorkSourceType | '';
                patch({ sourceTypes: v ? [v] : [] });
              }}>
              <option value="">All Work Types</option>
              {(Object.keys(SOURCE_LABEL) as OnboardingWorkSourceType[]).map(k => <option key={k} value={k}>{SOURCE_LABEL[k]}</option>)}
            </select>
            <select class="dt-filter" aria-label="Status"
              value={filters.lifecycles.length === 1 ? filters.lifecycles[0] : ''}
              onChange={e => {
                const v = (e.target as HTMLSelectElement).value as OnboardingWorkLifecycle | '';
                patch({ lifecycles: v ? [v] : [...DEFAULT_FILTERS.lifecycles] });
              }}>
              <option value="">Open Work</option>
              {(Object.keys(LIFECYCLE_LABEL) as OnboardingWorkLifecycle[]).map(k => <option key={k} value={k}>{LIFECYCLE_LABEL[k]}</option>)}
            </select>
            <label class="owq-toggle">
              <input type="checkbox" checked={filters.unassigned}
                onChange={e => patch({ unassigned: (e.target as HTMLInputElement).checked })} />
              Unassigned only
            </label>
          </>
        }
        toolbarRight={
          <div class="owq-views">
            <select class="dt-filter" aria-label="Saved views" value=""
              onChange={e => {
                const v = views.find(x => x.id === (e.target as HTMLSelectElement).value);
                if (v) applyView(v);
              }}>
              <option value="">Saved Views…</option>
              {views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="button" class="btn" onClick={() => setSaveViewOpen(true)}>Save View</button>
          </div>
        }
        activeFilters={activeFilters}
        onClearFilters={() => { setFilters({ ...DEFAULT_FILTERS }); setPage(1); }}
        sort={{
          field: sort.field, dir: sort.dir,
          onSort: (field, dir) => { setSort({ field: field as OnboardingWorkSortField, dir }); setPage(1); },
        }}
        // DataTable's pagination.page is ZERO-indexed (it renders
        // `page * pageSize + 1` and disables Prev at `page <= 0`), while the API and this
        // component are 1-based. Converting at the boundary — passing 1-based straight
        // through showed "Showing 26–22 of 22" on a single-page result.
        pagination={{ page: page - 1, pageCount, total, onPage: p => setPage(p + 1) }}
        rowsPerPage={{ value: pageSize, options: [...ONBOARDING_WORK_QUEUE_PAGE_SIZES], onChange: n => { setPageSize(n); setPage(1); } }}
        drawerSlot={openRow && (
          <aside class="owq-drawer" role="dialog" aria-label="Work item context">
            <header>
              <span class={`owq-type owq-type-${openRow.sourceType}`}>{SOURCE_LABEL[openRow.sourceType]}</span>
              <button type="button" class="owq-drawer-close" aria-label="Close" onClick={() => setOpenRow(null)}>×</button>
            </header>
            <h2>{openRow.title}</h2>
            {/* Quick context only. Full history, notes and the rest of the case live in
                Case Detail — this drawer must not grow into a second case page. */}
            <dl class="owq-facts">
              <div><dt>Employee</dt><dd>{openRow.employeeName ?? '—'}</dd></div>
              <div><dt>Case</dt><dd>{openRow.caseNo}</dd></div>
              <div><dt>Owning queue</dt><dd>{humanQueue(openRow.owningQueue)}</dd></div>
              <div><dt>Accountable</dt><dd>{openRow.accountableName ?? 'Unassigned'}</dd></div>
              <div><dt>Department</dt><dd>{openRow.departmentName ?? '—'}</dd></div>
              <div><dt>Due</dt><dd><DueCell dueAt={openRow.dueAt} /></dd></div>
              <div><dt>Status</dt><dd>{LIFECYCLE_LABEL[openRow.normalizedStatus]} <small>({openRow.sourceStatus})</small></dd></div>
            </dl>
            <footer>
              {openRow.sourceType === 'evidence' && openRow.sourceStatus === 'pending_review' && canReview && (
                <>
                  <button type="button" class="btn primary" disabled={busy}
                    onClick={() => void decide(openRow, 'approved')}>Approve</button>
                  <button type="button" class="btn danger" disabled={busy}
                    onClick={() => void decide(openRow, 'returned')}>Return</button>
                </>
              )}
              <button type="button" class="btn" onClick={() => openCase(openRow)}>Open in Case Detail</button>
            </footer>
          </aside>
        )}
      />

      <Modal open={saveViewOpen} title="Save Work Queue View" icon="fa-bookmark"
        onClose={() => { setSaveViewOpen(false); setViewName(''); }}
        onSubmit={saveCurrentView} submitLabel="Save View" submitDisabled={!viewName.trim()}>
        <Field label="View name" wide>
          <TextInput value={viewName} onInput={setViewName} placeholder="e.g. HSE evidence due this week" />
        </Field>
      </Modal>
    </section>
  );
}
