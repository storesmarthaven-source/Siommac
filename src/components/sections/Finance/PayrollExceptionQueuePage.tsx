// Payroll Approvals & Exceptions (F-06/F-07, spec §15.3) — the unified work-queue page.
// Reference: mockups/payroll-enterprise/exceptions.html + approval.html (re-implemented
// to the Siomac standard, scoped .pxq-*). ONE tabbed queue over the merged §15.3 backend
// (findings/work-queue keyset union of findings + open approval workflow-tasks).
//
// Approval-kind rows are REVIEW-ONLY (DEC-EXC-004): "Review" deep-links to the run
// workspace's Approvals tab (the central workflow decision path); approve/return/reject
// never happen here. Finding rows open a detail drawer with the activity feed + the
// version-guarded lifecycle actions the row/actor allows.

import { useMemo, useState, useEffect } from 'preact/hooks';
import type { VNode } from 'preact';
import { toast } from '@store';
import { showSection } from '@components/nav/navCore';
import {
  useWorkQueue, useWorkQueueMutations,
  type PayrollFindingQueueItem, type PayrollFindingDetail, type PayrollWorkQueueTab,
  type PayrollFindingQueueSeverity, type PayrollFindingAllowedAction, type PayrollFindingActivityType,
} from '@api/finance/payrollExceptions';
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

const fmtTTD = (n: number | null): string => (n == null ? '—' : `TTD ${Math.round(n).toLocaleString('en-US')}`);
const fmtDue = (iso: string | null): string => {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  return `Due ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
const isOverdue = (iso: string | null): boolean => (iso ? new Date(iso).getTime() < Date.now() : false);
const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const initials = (s: string): string => s.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '—';

// Open a payroll run in the workspace (register's deep-link contract).
function openRun(runId: string): void {
  try { sessionStorage.setItem('siomac_open_payroll_run', runId); } catch { /* ignore */ }
  showSection('s-finance-payroll');
}

export function PayrollExceptionQueuePage(): VNode {
  const [tab, setTab]     = useState<PayrollWorkQueueTab>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [ownerMe, setOwnerMe] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);
  const [action, setAction] = useState<{ type: PayrollFindingAllowedAction; finding: PayrollFindingDetail } | null>(null);

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

  function resetPage(): void { setCursor(undefined); setCursorStack([]); }

  const req = useMemo(() => ({
    tab,
    limit: 25,
    search: search || undefined,
    ownerId: ownerMe ? 'me' : undefined,
    selectedId,
    cursor,
  }), [tab, search, ownerMe, selectedId, cursor]);

  const q       = useWorkQueue(req);
  const result  = q.data;
  const items   = result?.items ?? [];
  const counts  = result?.tabCounts;
  const selected = result?.selected ?? null;
  const mut     = useWorkQueueMutations();

  const changeTab = (t: PayrollWorkQueueTab): void => { setTab(t); setSelectedId(undefined); resetPage(); };
  const nextPage = (): void => { if (!result?.nextCursor) return; setCursorStack(s => [...s, cursor]); setCursor(result.nextCursor); };
  const prevPage = (): void => { setCursorStack(s => { const c = [...s]; const prev = c.pop(); setCursor(prev); return c; }); };

  const onRowOpen = (row: PayrollFindingQueueItem): void => {
    if (row.kind === 'approval') { openRun(row.run.id); return; }  // review-only → workflow path
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
            <label class="pxq-owner">
              <input type="checkbox" checked={ownerMe} onChange={e => { setOwnerMe((e.target as HTMLInputElement).checked); resetPage(); }} />
              Assigned to me
            </label>
          </div>

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
            {!q.isLoading && items.map(row => (
              <QueueRow key={row.id} row={row} selected={row.id === selectedId} onOpen={() => onRowOpen(row)} />
            ))}
          </div>

          <footer class="pxq-foot">
            <span>{items.length ? `Showing ${items.length} of ${result?.total ?? items.length}` : ''}</span>
            <div class="pxq-pager">
              <button type="button" disabled={cursorStack.length === 0} onClick={prevPage} aria-label="Previous"><i class="fa-solid fa-chevron-left" /></button>
              <button type="button" disabled={!result?.nextCursor} onClick={nextPage} aria-label="Next"><i class="fa-solid fa-chevron-right" /></button>
            </div>
          </footer>
        </section>

        {/* ── Detail panel ── */}
        <aside class="pxq-detail">
          {selected ? (
            <DetailPanel detail={selected} busy={anyPending(mut)} onAction={(type) => setAction({ type, finding: selected })} onOpenRun={() => openRun(selected.run.id)} />
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
    </div>
  );
}

function anyPending(mut: ReturnType<typeof useWorkQueueMutations>): boolean {
  return mut.escalate.isPending || mut.comment.isPending || mut.assign.isPending
    || mut.resolve.isPending || mut.waive.isPending || mut.reopen.isPending;
}

// ── Queue row ───────────────────────────────────────────────────────────────
function QueueRow({ row, selected, onOpen }: { row: PayrollFindingQueueItem; selected: boolean; onOpen: () => void }): VNode {
  const sev = SEV_CLS.get(row.severity) ?? 'low';
  const icon = KIND_ICON.get(row.kind) ?? 'fa-circle-dot';
  const overdue = isOverdue(row.dueAt);
  return (
    <button type="button" class={`pxq-item${selected ? ' on' : ''}`} onClick={onOpen}>
      <div class={`pxq-sev ${sev}`}><i class={`fa-solid ${icon}`} /></div>
      <div class="pxq-copy"><strong>{row.title}</strong><small>{row.run.reference} · {row.summary}</small></div>
      <div class="pxq-owner">
        {row.owner ? <><span class="pxq-av">{initials(row.owner.displayName)}</span>
          <div><strong>{row.owner.displayName}</strong><small>{row.owner.type === 'team' ? 'Team' : 'Owner'}</small></div></>
          : <div><strong>Unassigned</strong></div>}
      </div>
      <div class="pxq-impact">{row.impact.amount != null ? <strong>{fmtTTD(row.impact.amount)}</strong> : null}
        {row.impact.label && <small>{row.impact.label}</small>}</div>
      <div class={`pxq-due${overdue ? ' overdue' : ''}`}>{overdue ? 'Overdue' : fmtDue(row.dueAt)}</div>
      <span class="pxq-cta">{row.kind === 'approval' ? 'Review' : 'Open'} <i class="fa-solid fa-arrow-right" /></span>
    </button>
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
  onAction: (a: PayrollFindingAllowedAction) => void; onOpenRun: () => void;
}): VNode {
  const activity = detail.activity.items;
  return (
    <div class="pxq-detail-card">
      <div class="pxq-detail-head">
        <span class={`pxq-sev ${SEV_CLS.get(detail.severity) ?? 'low'}`}><i class={`fa-solid ${KIND_ICON.get(detail.kind) ?? 'fa-circle-dot'}`} /></span>
        <div><strong>{detail.title}</strong><small>{detail.run.reference} · {detail.subject.scopeLabel}</small></div>
      </div>
      <p class="pxq-detail-summary">{detail.summary}</p>

      <dl class="pxq-facts">
        <div><dt>Trigger</dt><dd>{detail.trigger.ruleKey}</dd></div>
        <div><dt>Observed</dt><dd>{detail.trigger.observed}{detail.trigger.threshold ? ` (threshold ${detail.trigger.threshold})` : ''}</dd></div>
        <div><dt>Subject</dt><dd>{detail.subject.displayName ?? detail.subject.scopeLabel}</dd></div>
        <div><dt>Impact</dt><dd>{detail.impact.amount != null ? fmtTTD(detail.impact.amount) : (detail.impact.label ?? '—')}</dd></div>
      </dl>

      {detail.requiredEvidence.length > 0 && (
        <div class="pxq-required"><span>Required to clear</span>
          <ul>{detail.requiredEvidence.map(r => <li key={r}>{r}</li>)}</ul></div>
      )}

      {detail.resolution && (
        <div class="pxq-resolution"><i class="fa-solid fa-circle-check" />
          <div><strong>Resolved</strong><small>{detail.resolution.note}</small></div></div>
      )}

      <div class="pxq-actions">
        {detail.allowedActions.map(a => (
          <button key={a} type="button" class={`pxq-btn${a === 'resolve' ? ' primary' : ''}`} disabled={busy}
            onClick={() => (a === 'review' ? onOpenRun() : onAction(a))}>
            <i class={`fa-solid ${ACTION_META[a].icon}`} /> {ACTION_META[a].label}
          </button>
        ))}
        <button type="button" class="pxq-btn" onClick={onOpenRun}><i class="fa-solid fa-arrow-up-right-from-square" /> Open run</button>
      </div>

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
