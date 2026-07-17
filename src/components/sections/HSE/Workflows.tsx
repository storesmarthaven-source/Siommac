/**
 * src/components/sections/HSE/Workflows.tsx
 *
 * HSE Workflow Management — wired to the platform workflow backbone.
 * All data comes from POST /api/workflows/* and POST /api/handoffs/*.
 * The localStorage store (useWorkflow) is no longer used here.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { PageHeader, MetricRow, TabBar, withCounts, SparkCard, type AreaTab, type SparkDef } from '@ui';
import { dialog } from '@lib/dialog';
import {
  useWorkflowList,
  useWorkflow,
  useMyWorkflowTasks,
  useDecideWorkflowTask,
  useHandoffList,
  useRetryHandoff,
  type WorkflowInstance,
  type WorkflowTask,
} from '@api/workflows';

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'approvals', label: 'Approvals',        icon: 'fa-inbox' },
  { key: 'register',  label: 'Workflow Register', icon: 'fa-diagram-project' },
  { key: 'audit',     label: 'Audit Log',         icon: 'fa-shield-halved' },
  { key: 'handoffs',  label: 'Handoffs',          icon: 'fa-handshake' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_TONE: Record<string, string> = {
  critical: '#ef4444', high: '#f59e0b', medium: '#60a5fa', normal: '#60a5fa', low: '#94a3b8',
};

const STATUS_TONE: Record<string, { bg: string; color: string; label: string }> = {
  pending:              { bg: 'rgba(245,158,11,.15)',  color: '#fcd34d', label: 'Pending'   },
  submitted:            { bg: 'rgba(245,158,11,.15)',  color: '#fcd34d', label: 'Submitted' },
  in_review:            { bg: 'rgba(96,165,250,.15)',  color: '#93c5fd', label: 'In Review' },
  open:                 { bg: 'rgba(96,165,250,.15)',  color: '#93c5fd', label: 'Open'      },
  approved:             { bg: 'rgba(34,197,94,.15)',   color: '#4ade80', label: 'Approved'  },
  returned:             { bg: 'rgba(251,146,60,.15)',  color: '#fdba74', label: 'Returned'  },
  rejected:             { bg: 'rgba(239,68,68,.15)',   color: '#fca5a5', label: 'Rejected'  },
  closed:               { bg: 'rgba(100,116,139,.15)', color: '#94a3b8', label: 'Closed'    },
  completed:            { bg: 'rgba(34,197,94,.15)',   color: '#4ade80', label: 'Completed' },
  failed:               { bg: 'rgba(239,68,68,.2)',    color: '#f87171', label: 'Failed'    },
  cancelled:            { bg: 'rgba(100,116,139,.15)', color: '#94a3b8', label: 'Cancelled' },
  awaiting_approval:    { bg: 'rgba(96,165,250,.15)',  color: '#93c5fd', label: 'Awaiting'  },
  awaiting_evidence:    { bg: 'rgba(245,158,11,.15)',  color: '#fcd34d', label: 'Evidence'  },
};

function StatusPill({ status }: { status: string }): VNode {
  const t = STATUS_TONE[status] ?? { bg: 'rgba(148,163,184,.12)', color: '#94a3b8', label: status };
  return (
    <span style={{ background: t.bg, color: t.color, padding: '3px 10px', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 'var(--font-weight-bold)', letterSpacing: '0.03em' }}>
      {t.label}
    </span>
  );
}

function PriorityChip({ priority }: { priority: string }): VNode {
  const color = PRIORITY_TONE[priority] ?? '#94a3b8';
  return (
    <span style={{ background: `${color}22`, color, padding: '2px 8px', borderRadius: '999px', fontSize: '0.64rem', fontWeight: 'var(--font-weight-bold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {priority}
    </span>
  );
}

const MODULE_ICON: Record<string, string> = {
  hse: 'fa-helmet-safety', hr: 'fa-users', finance: 'fa-coins',
  payroll: 'fa-money-bill-wave', documents: 'fa-folder-open', core: 'fa-gear', admin: 'fa-shield',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

function isOpenStatus(s: string): boolean {
  return /submitted|in_review|open|awaiting/.test(s);
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ rows = 4 }: { rows?: number }): VNode {
  return (
    <div style={{ padding: '12px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ height: '40px', background: 'rgba(255,255,255,.05)', borderRadius: '6px', marginBottom: '8px' }} class="vt-skeleton" />
      ))}
    </div>
  );
}

// ── Approvals tab ─────────────────────────────────────────────────────────────

function ApprovalsTab(): VNode {
  const tasksQ   = useMyWorkflowTasks();
  const decide   = useDecideWorkflowTask();
  const [comment, setComment]   = useState<Record<string, string>>({});
  const [filter, setFilter]     = useState<'pending' | 'decided' | 'all'>('pending');

  const tasks = tasksQ.data ?? [];
  const filtered = useMemo(() => tasks.filter(t => {
    if (filter === 'pending')  return /open|in_review|submitted/.test(t.status);
    if (filter === 'decided')  return /approved|rejected|returned|completed/.test(t.status);
    return true;
  }), [tasks, filter]);

  const pending  = tasks.filter(t => /open|in_review|submitted/.test(t.status)).length;
  const approved = tasks.filter(t => t.decision === 'approved').length;
  const returned = tasks.filter(t => t.decision === 'returned').length;

  function handleDecide(task: WorkflowTask, decision: 'approved' | 'returned' | 'rejected'): void {
    const c = comment[task.id] ?? '';
    if ((decision === 'returned' || decision === 'rejected') && !c.trim()) {
      void dialog.warning('Comment required', 'A comment is required when returning or rejecting a task.');
      return;
    }
    decide.mutate({ taskId: task.id, decision, note: c.trim() || undefined }, {
      onSuccess: () => setComment(prev => { const n = { ...prev }; Reflect.deleteProperty(n, task.id); return n; }),
    });
  }

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Pending</span></div>
          <div class="hse-spark-val" style={{ color: pending > 0 ? '#f59e0b' : '#4ade80' }}>{pending}</div>
          <div class="hse-spark-sub">Awaiting your decision</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Approved</span></div>
          <div class="hse-spark-val" style={{ color: '#4ade80' }}>{approved}</div>
          <div class="hse-spark-sub">Decisions this session</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Returned</span></div>
          <div class="hse-spark-val" style={{ color: '#fb923c' }}>{returned}</div>
          <div class="hse-spark-sub">Sent back for correction</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total Tasks</span></div>
          <div class="hse-spark-val">{tasks.length}</div>
          <div class="hse-spark-sub">All approval tasks</div>
        </div>
      </div>

      <div class="wf-filter-row">
        {(['pending', 'decided', 'all'] as const).map(f => (
          <button key={f} class={`wf-filter-chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'pending' ? `Pending (${pending})` : f === 'decided' ? 'Decided' : 'All'}
          </button>
        ))}
      </div>

      {tasksQ.isLoading && <Skeleton />}
      {tasksQ.isError  && <div class="hse-error-bar"><i class="fas fa-triangle-exclamation" /> Failed to load approval tasks.</div>}

      {!tasksQ.isLoading && filtered.length === 0 && (
        <div class="wf-empty">
          <i class="fas fa-circle-check" />
          <strong>All clear</strong>
          <span>No {filter === 'all' ? '' : filter} approval tasks.</span>
        </div>
      )}

      <div class="wf-inbox-list">
        {filtered.map(task => {
          const decided = /approved|rejected|returned|completed/.test(task.status);
          const wi      = task.workflow_instances;

          return (
            <div key={task.id} class={`wf-inbox-card${decided ? ' decided' : ''}`}>
              <div class="wf-inbox-head">
                <div class="wf-inbox-icon">
                  <i class={`fas ${MODULE_ICON[wi?.source_module ?? ''] ?? 'fa-file-circle-check'}`} />
                </div>
                <div class="wf-inbox-meta">
                  <div class="wf-inbox-title">{task.step_key.replace(/_/g, ' ')}</div>
                  <div class="wf-inbox-sub">
                    <span class="wf-mono">{task.id.slice(0, 8)}</span>
                    <span>·</span>
                    {wi && <span class="wf-mono">{wi.ref}</span>}
                    {wi && <><span>·</span><span>{wi.source_entity_id}</span></>}
                    {task.assigned_role && <><span>·</span><span>{task.assigned_role}</span></>}
                    {wi && <><span>·</span><PriorityChip priority={wi.priority} /></>}
                  </div>
                </div>
                <div class="wf-inbox-status">
                  <StatusPill status={task.status} />
                  {task.decision_note && <span class="wf-inbox-comment-badge" title={task.decision_note}><i class="fas fa-comment-dots" /></span>}
                </div>
              </div>

              <div class="wf-inbox-foot">
                <span class="wf-due"><i class="fas fa-clock" /> Due: {fmtDate(task.due_at)}</span>
                {!decided ? (
                  <div class="wf-decide-row">
                    <textarea
                      class="wf-comment-box"
                      rows={2}
                      placeholder="Add a comment (required for Return / Reject)…"
                      value={comment[task.id] ?? ''}
                      onInput={e => setComment(prev => ({ ...prev, [task.id]: (e.target as HTMLTextAreaElement).value }))}
                    />
                    <div class="wf-decide-btns">
                      <button class="wf-btn approve" disabled={decide.isPending} onClick={() => handleDecide(task, 'approved')}>
                        <i class="fas fa-check" /> Approve
                      </button>
                      <button class="wf-btn return" disabled={decide.isPending} onClick={() => handleDecide(task, 'returned')}>
                        <i class="fas fa-rotate-left" /> Return
                      </button>
                      <button class="wf-btn reject" disabled={decide.isPending} onClick={() => handleDecide(task, 'rejected')}>
                        <i class="fas fa-xmark" /> Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  task.decision_note && (
                    <div class="wf-decided-comment">
                      <i class="fas fa-comment-dots" />
                      <em>{task.decision_note}</em>
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Workflow Register tab ─────────────────────────────────────────────────────

function RegisterTab(): VNode {
  const listQ  = useWorkflowList();
  const [search, setSearch]     = useState('');
  const [statusF, setStatusF]   = useState('all');
  const [selected, setSelected] = useState<WorkflowInstance | null>(null);

  const rows = useMemo(() => {
    const all = listQ.data ?? [];
    const q   = search.toLowerCase();
    return all.filter(w => {
      const matchSearch = !q || `${w.ref} ${w.source_entity_id} ${w.owner_user_id} ${w.current_step}`.toLowerCase().includes(q);
      const matchStatus = statusF === 'all' || w.status === statusF;
      return matchSearch && matchStatus;
    });
  }, [listQ.data, search, statusF]);

  const all     = listQ.data ?? [];
  const open    = all.filter(w => isOpenStatus(w.status)).length;
  const closed  = all.filter(w => /approved|closed/.test(w.status)).length;
  const critical = all.filter(w => w.priority === 'critical').length;

  const statuses = [...new Set(all.map(w => w.status))];

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total Workflows</span></div>
          <div class="hse-spark-val">{all.length}</div>
          <div class="hse-spark-sub">All workflows</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Open</span></div>
          <div class="hse-spark-val" style={{ color: open > 0 ? '#f59e0b' : '#4ade80' }}>{open}</div>
          <div class="hse-spark-sub">Awaiting action</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Closed / Approved</span></div>
          <div class="hse-spark-val" style={{ color: '#4ade80' }}>{closed}</div>
          <div class="hse-spark-sub">Completed workflows</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Critical</span></div>
          <div class="hse-spark-val" style={{ color: critical > 0 ? '#ef4444' : '#4ade80' }}>{critical}</div>
          <div class="hse-spark-sub">High-priority escalations</div>
        </div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}>
              <i class="fas fa-search" />
              <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search workflows…" />
            </div>
            <select class="emp-filter-select" value={statusF} onChange={e => setStatusF((e.target as HTMLSelectElement).value)}>
              <option value="all">All statuses</option>
              {statuses.map(s => <option key={s} value={s}>{STATUS_TONE[s]?.label ?? s}</option>)}
            </select>
          </div>

          {listQ.isLoading && <Skeleton />}
          {listQ.isError   && <div class="hse-error-bar"><i class="fas fa-triangle-exclamation" /> Failed to load workflows.</div>}

          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr><th>Ref</th><th>Record</th><th>Module</th><th>Priority</th><th>Step</th><th>Status</th><th>Due</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && !listQ.isLoading && (
                    <tr><td colspan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>No workflows match.</td></tr>
                  )}
                  {rows.map(w => (
                    <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(w)}>
                      <td><span class="vt-cell-mono">{w.ref}</span></td>
                      <td><span class="vt-cell-mono" style={{ fontSize: '0.72rem' }}>{w.source_entity_id}</span></td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          <i class={`fas ${MODULE_ICON[w.source_module] ?? 'fa-gear'}`} style={{ fontSize: '0.68rem' }} />
                          {w.source_module}
                        </span>
                      </td>
                      <td><PriorityChip priority={w.priority} /></td>
                      <td><span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{w.current_step.replace(/_/g, ' ')}</span></td>
                      <td><StatusPill status={w.status} /></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{fmtDate(w.due_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          {selected ? (
            <WorkflowDetailPanel inst={selected} onClose={() => setSelected(null)} />
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(255,255,255,.4)' }}>
              <i class="fas fa-diagram-project" style={{ fontSize: '2rem', marginBottom: '12px', display: 'block' }} />
              <span style={{ fontSize: '0.8rem' }}>Click a workflow row to view its event history and tasks.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function WorkflowDetailPanel({ inst, onClose }: { inst: WorkflowInstance; onClose: () => void }): VNode {
  const detailQ = useWorkflow(inst.id);
  const detail  = detailQ.data;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ color: '#fff', fontSize: '0.82rem', fontWeight: 'var(--font-weight-bold)', margin: 0 }}>
          <i class={`fas ${MODULE_ICON[inst.source_module] ?? 'fa-diagram-project'}`} style={{ marginRight: '7px', color: 'rgba(255,255,255,.5)' }} />
          {inst.ref}
        </h4>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: '0.9rem' }}>
          <i class="fas fa-xmark" />
        </button>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>{inst.source_entity_id}</div>
        <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,.5)', marginBottom: '8px' }}>
          {inst.source_module} · Step: {inst.current_step.replace(/_/g, ' ')}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <StatusPill status={inst.status} />
          <PriorityChip priority={inst.priority} />
        </div>
      </div>

      {detailQ.isLoading && <Skeleton rows={3} />}

      {detail && detail.tasks.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 'var(--font-weight-bold)', color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>
            Tasks
          </div>
          {detail.tasks.map(t => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '0.73rem', fontWeight: 600, color: '#fff' }}>{t.step_key.replace(/_/g, ' ')}</div>
                {t.assigned_role && <div style={{ fontSize: '0.66rem', color: 'rgba(255,255,255,.45)' }}>{t.assigned_role}</div>}
              </div>
              <StatusPill status={t.status} />
            </div>
          ))}
        </div>
      )}

      {detail && detail.events.length > 0 && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 'var(--font-weight-bold)', color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
            Event history
          </div>
          {detail.events.slice(0, 8).map(ev => (
            <div key={ev.id} style={{ display: 'flex', gap: '8px', marginBottom: '8px', fontSize: '0.7rem' }}>
              <i class="fas fa-circle" style={{ fontSize: '0.4rem', marginTop: '5px', color: 'rgba(255,255,255,.3)', flexShrink: 0 }} />
              <div>
                <span style={{ fontWeight: 600, color: '#fff' }}>{ev.event_type}</span>
                <span style={{ color: 'rgba(255,255,255,.4)', marginLeft: '6px' }}>{fmtDate(ev.created_at)}</span>
                {ev.note && <div style={{ color: 'rgba(255,255,255,.55)', marginTop: '2px' }}>{ev.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Audit Log tab ─────────────────────────────────────────────────────────────

function AuditTab(): VNode {
  const listQ    = useWorkflowList();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailQ  = useWorkflow(selectedId ?? '');
  const [search, setSearch] = useState('');

  const workflows = listQ.data ?? [];
  const events    = detailQ.data?.events ?? [];

  const filteredWf = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return workflows;
    return workflows.filter(w => `${w.ref} ${w.source_entity_id} ${w.source_module}`.toLowerCase().includes(q));
  }, [workflows, search]);

  const totalEvents = workflows.length; // proxy until we have a global event count

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Workflows</span></div>
          <div class="hse-spark-val">{workflows.length}</div>
          <div class="hse-spark-sub">With audit trail</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Events (selected)</span></div>
          <div class="hse-spark-val">{selectedId ? events.length : '—'}</div>
          <div class="hse-spark-sub">Select a workflow below</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Approvals</span></div>
          <div class="hse-spark-val">{events.filter(e => e.event_type === 'approved').length || (selectedId ? 0 : '—')}</div>
          <div class="hse-spark-sub">Approval decisions logged</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total</span></div>
          <div class="hse-spark-val">{totalEvents}</div>
          <div class="hse-spark-sub">Tracked workflows</div>
        </div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar" style={{ marginBottom: '14px' }}>
            <div class="vt-search" style={{ flex: '1 1 220px' }}>
              <i class="fas fa-search" />
              <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search workflows…" />
            </div>
            <div style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i class="fas fa-lock" style={{ color: '#4ade80' }} />
              Immutable · append-only
            </div>
          </div>

          {listQ.isLoading && <Skeleton />}

          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr><th>Ref</th><th>Module</th><th>Record</th><th>Status</th><th>Created</th></tr>
                </thead>
                <tbody>
                  {filteredWf.length === 0 && !listQ.isLoading && (
                    <tr><td colspan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>No workflows found.</td></tr>
                  )}
                  {filteredWf.map(w => (
                    <tr key={w.id} style={{ cursor: 'pointer', background: selectedId === w.id ? 'rgba(96,165,250,.08)' : undefined }} onClick={() => setSelectedId(w.id === selectedId ? null : w.id)}>
                      <td><span class="vt-cell-mono">{w.ref}</span></td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          <i class={`fas ${MODULE_ICON[w.source_module] ?? 'fa-gear'}`} style={{ fontSize: '0.68rem' }} />
                          {w.source_module}
                        </span>
                      </td>
                      <td><span class="vt-cell-mono" style={{ fontSize: '0.7rem' }}>{w.source_entity_id}</span></td>
                      <td><StatusPill status={w.status} /></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{fmtDate(w.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          {!selectedId ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(255,255,255,.4)' }}>
              <i class="fas fa-shield-halved" style={{ fontSize: '2rem', marginBottom: '12px', display: 'block' }} />
              <span style={{ fontSize: '0.8rem' }}>Select a workflow to view its immutable event log.</span>
            </div>
          ) : detailQ.isLoading ? (
            <Skeleton rows={5} />
          ) : events.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: '0.8rem' }}>No events yet.</div>
          ) : (
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 'var(--font-weight-bold)', color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '12px' }}>
                Event log
              </div>
              {events.map(ev => (
                <div key={ev.id} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff' }}>{ev.event_type}</span>
                    <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,.4)' }}>{fmtDate(ev.created_at)}</span>
                  </div>
                  {ev.note && <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,.55)', marginTop: '3px' }}>{ev.note}</div>}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Handoffs tab ──────────────────────────────────────────────────────────────

function HandoffsTab(): VNode {
  const handoffsQ = useHandoffList();
  const retry     = useRetryHandoff();
  const handoffs  = handoffsQ.data ?? [];

  const pending  = handoffs.filter(h => h.status === 'pending').length;
  const failed   = handoffs.filter(h => h.status === 'failed').length;
  const toFinance = handoffs.filter(h => h.target_module === 'finance').length;
  const toHr      = handoffs.filter(h => h.target_module === 'hr').length;

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total Handoffs</span></div>
          <div class="hse-spark-val">{handoffs.length}</div>
          <div class="hse-spark-sub">Cross-module seams</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Pending</span></div>
          <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{pending}</div>
          <div class="hse-spark-sub">Awaiting receiving module</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Failed</span></div>
          <div class="hse-spark-val" style={{ color: failed > 0 ? '#ef4444' : '#4ade80' }}>{failed}</div>
          <div class="hse-spark-sub">Require retry</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Finance / HR</span></div>
          <div class="hse-spark-val">{toFinance} / {toHr}</div>
          <div class="hse-spark-sub">By target module</div>
        </div>
      </div>

      {handoffsQ.isLoading && <Skeleton />}
      {handoffsQ.isError   && <div class="hse-error-bar"><i class="fas fa-triangle-exclamation" /> Failed to load handoffs.</div>}

      {!handoffsQ.isLoading && handoffs.length === 0 && (
        <div class="wf-empty">
          <i class="fas fa-handshake" />
          <strong>No handoffs yet</strong>
          <span>Approving an incident workflow emits cross-module handoffs here.</span>
        </div>
      )}

      {handoffs.length > 0 && (
        <div class="vt-table-card">
          <div class="vt-table-scroll">
            <table class="vt-table">
              <thead>
                <tr><th>ID</th><th>Source</th><th>Target</th><th>Record</th><th>Status</th><th>Attempts</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {handoffs.map(h => (
                  <tr key={h.id}>
                    <td><span class="vt-cell-mono" style={{ fontSize: '0.68rem' }}>{h.id.slice(0, 8)}</span></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem' }}>
                        <i class={`fas ${MODULE_ICON[h.source_module] ?? 'fa-gear'}`} style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }} />
                        {h.source_module}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem' }}>
                        <i class={`fas ${MODULE_ICON[h.target_module] ?? 'fa-gear'}`} style={{ fontSize: '0.68rem', color: 'rgba(96,165,250,.8)' }} />
                        <span style={{ color: 'rgba(96,165,250,.9)', fontWeight: 600 }}>{h.target_module}</span>
                      </span>
                    </td>
                    <td><span class="vt-cell-mono" style={{ fontSize: '0.7rem' }}>{h.source_entity_id}</span></td>
                    <td><StatusPill status={h.status} /></td>
                    <td style={{ fontSize: '0.73rem', color: 'var(--text-muted)', textAlign: 'center' }}>{h.attempts}</td>
                    <td style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{fmtDate(h.created_at)}</td>
                    <td>
                      {h.status === 'failed' && (
                        <button
                          class="hse-btn"
                          style={{ fontSize: '0.65rem', padding: '3px 8px' }}
                          disabled={retry.isPending}
                          onClick={() => retry.mutate(h.id)}
                        >
                          <i class="fas fa-rotate" /> Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Wizard tab ────────────────────────────────────────────────────────────────

interface SeededTemplate {
  id: string; label: string; sourceModule: string; defaultPriority: string;
  approvalRoute: { role: string; label: string }[];
  evidence: { key: string; label: string; required: boolean }[];
  handoffsOnApproval: { target: string; summary: string }[];
}

const SEEDED_TEMPLATES: SeededTemplate[] = [
  {
    id: 'hse_incident_investigation', label: 'Incident Investigation', sourceModule: 'hse', defaultPriority: 'critical',
    approvalRoute: [
      { role: 'Site HSE Officer', label: 'Initial classification and immediate controls' },
      { role: 'HSE Manager',      label: 'Investigation sign-off and closeout route' },
    ],
    evidence: [
      { key: 'scene',   label: 'Scene photos / sketch',         required: true  },
      { key: 'witness', label: 'Witness / supervisor statement', required: true  },
    ],
    handoffsOnApproval: [
      { target: 'finance', summary: 'Cleanup / cost allocation for incident closeout' },
      { target: 'hr',      summary: 'Employee impact review (injury / restricted work)' },
    ],
  },
  {
    id: 'hse_capa_closure', label: 'Corrective Action (CAPA)', sourceModule: 'hse', defaultPriority: 'high',
    approvalRoute: [
      { role: 'Action Owner', label: 'Complete and submit verification evidence' },
      { role: 'HSE Manager',  label: 'Verify effectiveness and close' },
    ],
    evidence: [{ key: 'completion', label: 'Completion evidence', required: true }],
    handoffsOnApproval: [],
  },
  {
    id: 'hse_permit_approval', label: 'Permit to Work Approval', sourceModule: 'hse', defaultPriority: 'high',
    approvalRoute: [
      { role: 'Permit Issuer', label: 'Hazard controls and gas test verification' },
      { role: 'HSE Manager',   label: 'High-risk permit authorisation' },
    ],
    evidence: [
      { key: 'gas',       label: 'Gas test record',             required: true  },
      { key: 'rescue',    label: 'Rescue / standby plan',        required: true  },
      { key: 'isolation', label: 'Isolation / LOTO certificate', required: false },
    ],
    handoffsOnApproval: [],
  },
  {
    id: 'hse_document_approval', label: 'Controlled Document Approval', sourceModule: 'documents', defaultPriority: 'normal',
    approvalRoute: [
      { role: 'Document Controller', label: 'Technical and compliance review' },
      { role: 'HSE Manager',         label: 'Controlled release and publication' },
    ],
    evidence: [{ key: 'changes', label: 'Change summary', required: true }],
    handoffsOnApproval: [{ target: 'hr', summary: 'Policy acknowledgement campaign distribution' }],
  },
  {
    id: 'ppe-request', label: 'PPE Request', sourceModule: 'hse', defaultPriority: 'normal',
    approvalRoute: [
      { role: 'Site HSE Officer', label: 'Validate role requirement and stock availability' },
      { role: 'HSE Manager',      label: 'Approve issue and cost allocation' },
    ],
    evidence: [{ key: 'reason', label: 'Request justification / hazard exposure', required: true }],
    handoffsOnApproval: [],
  },
];
// WizardTab DELETED - the ad-hoc 'New Workflow' wizard fed caller-controlled
// inputs into the hardened explicit-start endpoint (schema now rejects them).
// Workflows start from their source modules; templates render in the stat tile.

// ── Root area component ───────────────────────────────────────────────────────

export function WorkflowsArea({ tab }: { tab: string }): VNode {
  const [active, setActive] = useState(TABS.some(item => item.key === tab) ? tab : 'approvals');
  const tasksQ    = useMyWorkflowTasks();
  const workflowQ = useWorkflowList();

  const pending = (tasksQ.data ?? []).filter(t => /open|in_review|submitted/.test(t.status)).length;
  const open    = (workflowQ.data ?? []).filter(w => isOpenStatus(w.status)).length;
  const total   = workflowQ.data?.length ?? 0;

  const sparks: SparkDef[] = [
    {
      label: 'Pending Approvals', value: String(pending), sub: 'Awaiting your decision',
      delta: pending > 0 ? 'Action required' : 'All clear', deltaUp: pending > 0, color: pending > 0 ? '#f59e0b' : '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, pending], sparkColor: '#f59e0b',
    },
    {
      label: 'Open Workflows', value: String(open), sub: 'In progress — awaiting action',
      delta: `${total} total tracked`, deltaUp: false, color: '#60a5fa',
      sparkPoints: [0, 0, 0, 0, 0, open], sparkColor: '#60a5fa',
    },
    {
      label: 'Total Workflows', value: String(total), sub: 'All governed processes tracked',
      delta: `${total - open} closed / approved`, deltaUp: false, color: '#60a5fa',
      sparkPoints: [0, 0, 0, 0, 0, total], sparkColor: '#60a5fa',
    },
    {
      label: 'Templates Active', value: String(SEEDED_TEMPLATES.length), sub: 'Available workflow templates',
      delta: 'Backbone connected', deltaUp: false, color: '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, SEEDED_TEMPLATES.length], sparkColor: '#4ade80',
    },
  ];

  return (
    <div class="hse-tab hse-dash">
      <PageHeader
        icon="fa-diagram-project"
        module="HSE"
        title="Workflows"
        sub="Governed approvals, evidence gates, cross-module handoffs, and immutable audit trail."
      />

      <MetricRow pageKey="hse.workflows" cards={sparks.map(s => ({ key: s.label, node: <SparkCard spark={s} /> }))} />

      <TabBar tabs={withCounts(TABS, { approvals: pending, register: open })} active={active} onSelect={setActive} />

      {active === 'approvals' && <ApprovalsTab />}
      {active === 'register'  && <RegisterTab />}
      {active === 'audit'     && <AuditTab />}
      {active === 'handoffs'  && <HandoffsTab />}
    </div>
  );
}
