/**
 * src/components/sections/HSE/Workflows.tsx
 *
 * HSE Workflow Management area — Approvals inbox, Workflow Register,
 * Audit Log, and a New Workflow Wizard. Drives the live workflow engine
 * (useWorkflow) so every action taken here is immediately reflected on
 * the HSE Dashboard and in the originating area (Incidents, Permits, etc.).
 *
 * Sized for a 150–200 employee T&T operation:
 *  - Approvals inbox: approve / return / reject with mandatory comment
 *  - Evidence gate toggling before deciding
 *  - Register: full lifecycle view with stage timeline
 *  - Audit log: immutable, signed, newest-first
 *  - Wizard: 3-step template picker → detail form → confirm & submit
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { AreaHero, AreaTabs, type AreaTab } from './_shared';
import { useWorkflow } from '@lib/workflow';
import { WORKFLOW_TEMPLATES } from '@lib/workflow/templates';
import type {
  ApprovalTask, WorkflowInstance, AuditEvent, Handoff,
} from '@lib/workflow/types';

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'approvals', label: 'Approvals',        icon: 'fa-inbox' },
  { key: 'register',  label: 'Workflow Register', icon: 'fa-diagram-project' },
  { key: 'audit',     label: 'Audit Log',         icon: 'fa-shield-halved' },
  { key: 'handoffs',  label: 'Handoffs',          icon: 'fa-handshake' },
  { key: 'wizard',    label: 'New Workflow',      icon: 'fa-wand-magic-sparkles' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_TONE: Record<string, string> = {
  critical: '#ef4444', high: '#f59e0b', normal: '#60a5fa', low: '#94a3b8',
};

const STATUS_TONE: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: 'rgba(245,158,11,.15)',  color: '#fcd34d', label: 'Pending'   },
  in_review: { bg: 'rgba(96,165,250,.15)',  color: '#93c5fd', label: 'In Review' },
  approved:  { bg: 'rgba(34,197,94,.15)',   color: '#4ade80', label: 'Approved'  },
  returned:  { bg: 'rgba(251,146,60,.15)',  color: '#fdba74', label: 'Returned'  },
  rejected:  { bg: 'rgba(239,68,68,.15)',   color: '#fca5a5', label: 'Rejected'  },
  closed:    { bg: 'rgba(100,116,139,.15)', color: '#94a3b8', label: 'Closed'    },
  blocked:   { bg: 'rgba(239,68,68,.2)',    color: '#f87171', label: 'Blocked'   },
  draft:     { bg: 'rgba(148,163,184,.12)', color: '#94a3b8', label: 'Draft'     },
};

function StatusPill({ status }: { status: string }): VNode {
  const t = STATUS_TONE[status] ?? STATUS_TONE.draft!;
  return (
    <span style={{ background: t.bg, color: t.color, padding: '3px 10px', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.03em' }}>
      {t.label}
    </span>
  );
}

function PriorityChip({ priority }: { priority: string }): VNode {
  const color = PRIORITY_TONE[priority] ?? '#94a3b8';
  return (
    <span style={{ background: `${color}22`, color, padding: '2px 8px', borderRadius: '999px', fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {priority}
    </span>
  );
}

const MODULE_ICON: Record<string, string> = {
  hse: 'fa-helmet-safety', hr: 'fa-users', finance: 'fa-coins',
  payroll: 'fa-money-bill-wave', documents: 'fa-folder-open', core: 'fa-gear', admin: 'fa-shield',
};

const STAGE_LABELS: Record<string, string> = {
  scope: 'Scope', validate: 'Validate', evidence: 'Evidence', approve: 'Approve', output: 'Output', audit: 'Audit',
};
const STAGE_KEYS = ['scope', 'validate', 'evidence', 'approve', 'output', 'audit'];

// ── Approvals tab ─────────────────────────────────────────────────────────────

function ApprovalsTab(): VNode {
  const wf = useWorkflow();
  const [comment, setComment] = useState<Record<string, string>>({});
  const [evidenceOpen, setEvidenceOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'decided'>('pending');

  const tasks = useMemo(() => {
    return wf.state.approvals.filter(a => {
      if (filter === 'pending')  return /pending|in_review/.test(a.status);
      if (filter === 'decided')  return /approved|rejected|returned/.test(a.status);
      return true;
    });
  }, [wf.state.approvals, filter]);

  const pending = wf.state.approvals.filter(a => /pending|in_review/.test(a.status)).length;

  function decide(task: ApprovalTask, decision: 'approve' | 'return' | 'reject'): void {
    const c = comment[task.id] ?? '';
    if ((decision === 'return' || decision === 'reject') && !c.trim()) {
      alert('A comment is required when returning or rejecting a task.');
      return;
    }
    wf.decide(task.id, decision, c.trim() || undefined);
    setComment(prev => { const n = { ...prev }; delete n[task.id]; return n; });
  }

  return (
    <div class="ppe-tab-content">
      {/* Stats strip */}
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Pending</span></div>
          <div class="hse-spark-val" style={{ color: pending > 0 ? '#f59e0b' : '#4ade80' }}>{pending}</div>
          <div class="hse-spark-sub">Awaiting your decision</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Approved</span></div>
          <div class="hse-spark-val" style={{ color: '#4ade80' }}>
            {wf.state.approvals.filter(a => a.status === 'approved').length}
          </div>
          <div class="hse-spark-sub">Decisions this session</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Returned</span></div>
          <div class="hse-spark-val" style={{ color: '#fb923c' }}>
            {wf.state.approvals.filter(a => a.status === 'returned').length}
          </div>
          <div class="hse-spark-sub">Sent back for correction</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total Tasks</span></div>
          <div class="hse-spark-val">{wf.state.approvals.length}</div>
          <div class="hse-spark-sub">All approval tasks</div>
        </div>
      </div>

      {/* Filter chips */}
      <div class="wf-filter-row">
        {(['pending', 'decided', 'all'] as const).map(f => (
          <button key={f} class={`wf-filter-chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'pending' ? `Pending (${pending})` : f === 'decided' ? 'Decided' : 'All'}
          </button>
        ))}
      </div>

      {tasks.length === 0 && (
        <div class="wf-empty">
          <i class="fas fa-circle-check" />
          <strong>All clear</strong>
          <span>No {filter === 'all' ? '' : filter} approval tasks.</span>
        </div>
      )}

      <div class="wf-inbox-list">
        {tasks.map(task => {
          const decided = /approved|rejected|returned/.test(task.status);
          const wfInst  = wf.state.workflows.find(w => w.id === task.workflowId);
          const allRequired = task.evidence.filter(e => e.required).every(e => e.attached);

          return (
            <div key={task.id} class={`wf-inbox-card${decided ? ' decided' : ''}`}>
              {/* Card header */}
              <div class="wf-inbox-head">
                <div class="wf-inbox-icon">
                  <i class={`fas ${MODULE_ICON[task.module] ?? 'fa-file-circle-check'}`} />
                </div>
                <div class="wf-inbox-meta">
                  <div class="wf-inbox-title">{task.title}</div>
                  <div class="wf-inbox-sub">
                    <span class="wf-mono">{task.id}</span>
                    <span>·</span>
                    <span class="wf-mono">{task.recordRef}</span>
                    <span>·</span>
                    <span>{task.approverRole}</span>
                    {wfInst && <><span>·</span><PriorityChip priority={wfInst.priority} /></>}
                  </div>
                </div>
                <div class="wf-inbox-status">
                  <StatusPill status={task.status} />
                  {task.comment && <span class="wf-inbox-comment-badge" title={task.comment}><i class="fas fa-comment-dots" /></span>}
                </div>
              </div>

              {/* Reason from workflow */}
              {wfInst?.reason && (
                <div class="wf-inbox-reason">
                  <i class="fas fa-quote-left" />
                  {wfInst.reason}
                </div>
              )}

              {/* Evidence gate */}
              {task.evidence.length > 0 && (
                <div class="wf-evidence-section">
                  <button class="wf-evidence-toggle" onClick={() => setEvidenceOpen(evidenceOpen === task.id ? null : task.id)}>
                    <i class={`fas fa-chevron-${evidenceOpen === task.id ? 'up' : 'down'}`} />
                    Evidence gate
                    <span class={`wf-evidence-badge${allRequired ? ' ok' : ''}`}>
                      {task.evidence.filter(e => e.attached).length} / {task.evidence.length}
                    </span>
                  </button>
                  {evidenceOpen === task.id && (
                    <div class="wf-evidence-list">
                      {task.evidence.map(ev => (
                        <label key={ev.key} class={`wf-evidence-item${ev.attached ? ' attached' : ''}`}>
                          <input
                            type="checkbox"
                            checked={ev.attached}
                            disabled={decided}
                            onChange={() => wf.toggleEvidence(task.id, ev.key)}
                          />
                          <i class={`fas ${ev.attached ? 'fa-paperclip' : 'fa-link-slash'}`} />
                          <span>{ev.label}</span>
                          {ev.required && <span class="wf-req-badge">Required</span>}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Due + decision area */}
              <div class="wf-inbox-foot">
                <span class="wf-due"><i class="fas fa-clock" /> Due: {task.due}</span>
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
                      <button
                        class="wf-btn approve"
                        title={!allRequired ? 'Attach required evidence before approving' : ''}
                        onClick={() => decide(task, 'approve')}
                      >
                        <i class="fas fa-check" /> Approve
                      </button>
                      <button class="wf-btn return" onClick={() => decide(task, 'return')}>
                        <i class="fas fa-rotate-left" /> Return
                      </button>
                      <button class="wf-btn reject" onClick={() => decide(task, 'reject')}>
                        <i class="fas fa-xmark" /> Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  task.comment && (
                    <div class="wf-decided-comment">
                      <i class="fas fa-comment-dots" />
                      <em>{task.comment}</em>
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
  const wf = useWorkflow();
  const [search, setSearch]   = useState('');
  const [statusF, setStatusF] = useState('all');
  const [selected, setSelected] = useState<WorkflowInstance | null>(null);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return wf.state.workflows.filter(w => {
      const matchSearch = !q || `${w.id} ${w.label} ${w.recordRef} ${w.createdBy}`.toLowerCase().includes(q);
      const matchStatus = statusF === 'all' || w.status === statusF;
      return matchSearch && matchStatus;
    });
  }, [wf.state.workflows, search, statusF]);

  const open    = wf.state.workflows.filter(w => /pending|in_review|returned|blocked/.test(w.status)).length;
  const closed  = wf.state.workflows.filter(w => /approved|closed/.test(w.status)).length;
  const blocked = wf.state.workflows.filter(w => w.status === 'blocked' || w.priority === 'critical').length;

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total Workflows</span></div>
          <div class="hse-spark-val">{wf.state.workflows.length}</div>
          <div class="hse-spark-sub">All HSE workflows</div>
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
          <div class="hse-spark-val" style={{ color: blocked > 0 ? '#ef4444' : '#4ade80' }}>{blocked}</div>
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
              {Object.keys(STATUS_TONE).map(s => <option key={s} value={s}>{STATUS_TONE[s]!.label}</option>)}
            </select>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr><th>ID</th><th>Workflow</th><th>Record</th><th>Priority</th><th>Stage</th><th>Status</th><th>Due</th><th>Created by</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colspan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>No workflows match.</td></tr>
                  )}
                  {rows.map(w => (
                    <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(w)}>
                      <td><span class="vt-cell-mono">{w.id}</span></td>
                      <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{w.label}</span></td>
                      <td><span class="vt-cell-mono" style={{ fontSize: '0.72rem' }}>{w.recordRef}</span></td>
                      <td><PriorityChip priority={w.priority} /></td>
                      <td><span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{STAGE_LABELS[w.stageKey] ?? w.stageKey}</span></td>
                      <td><StatusPill status={w.status} /></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{w.due}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{w.createdBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <aside class="ppe-signals-panel">
          {selected ? (
            <WorkflowDetailPanel wf={selected} onClose={() => setSelected(null)} />
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(255,255,255,.4)' }}>
              <i class="fas fa-diagram-project" style={{ fontSize: '2rem', marginBottom: '12px', display: 'block' }} />
              <span style={{ fontSize: '0.8rem' }}>Click a workflow row to view its stage timeline and detail.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function WorkflowDetailPanel({ wf: inst, onClose }: { wf: WorkflowInstance; onClose: () => void }): VNode {
  const wf  = useWorkflow();
  const tpl = WORKFLOW_TEMPLATES.find(t => t.id === inst.templateId);
  const task = wf.state.approvals.find(a => a.workflowId === inst.id);
  const currentIdx = STAGE_KEYS.indexOf(inst.stageKey);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ color: '#fff', fontSize: '0.82rem', fontWeight: 700, margin: 0 }}>
          <i class={`fas ${MODULE_ICON[inst.sourceModule] ?? 'fa-diagram-project'}`} style={{ marginRight: '7px', color: 'rgba(255,255,255,.5)' }} />
          {inst.id}
        </h4>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: '0.9rem' }}>
          <i class="fas fa-xmark" />
        </button>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>{inst.label}</div>
        <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,.5)', marginBottom: '8px' }}>{inst.recordRef} · {inst.createdBy}</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <StatusPill status={inst.status} />
          <PriorityChip priority={inst.priority} />
        </div>
      </div>

      {inst.reason && (
        <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', fontSize: '0.72rem', color: 'rgba(255,255,255,.7)', lineHeight: '1.5' }}>
          <i class="fas fa-quote-left" style={{ marginRight: '6px', opacity: 0.5 }} />
          {inst.reason}
        </div>
      )}

      {/* Stage timeline */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>
          Stage timeline
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {STAGE_KEYS.map((key, i) => {
            const done   = i < currentIdx || inst.status === 'approved' || inst.status === 'closed';
            const active = i === currentIdx && !/approved|closed|rejected/.test(inst.status);
            const label  = STAGE_LABELS[key] ?? key;
            return (
              <div key={key} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', position: 'relative' }}>
                {/* connector */}
                {i < STAGE_KEYS.length - 1 && (
                  <div style={{ position: 'absolute', left: '11px', top: '22px', width: '2px', height: '20px', background: done ? 'rgba(34,197,94,.35)' : 'rgba(255,255,255,.1)' }} />
                )}
                <div style={{
                  width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0, marginTop: '2px',
                  display: 'grid', placeItems: 'center', fontSize: '0.6rem',
                  border: `1.5px solid ${done ? '#16a34a' : active ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.2)'}`,
                  background: active ? 'rgba(255,255,255,.12)' : 'transparent',
                  color: done ? '#4ade80' : active ? '#fff' : 'rgba(255,255,255,.3)',
                }}>
                  {done ? <i class="fas fa-check" /> : <span>{i + 1}</span>}
                </div>
                <div style={{ paddingBottom: '16px' }}>
                  <div style={{ fontSize: '0.73rem', fontWeight: done || active ? 600 : 400, color: done ? '#4ade80' : active ? '#fff' : 'rgba(255,255,255,.4)' }}>
                    {label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Approval route */}
      {tpl && tpl.approvalRoute.length > 0 && (
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
            Approval route
          </div>
          {tpl.approvalRoute.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' }}>
              <i class="fas fa-user-shield" style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,.35)', marginTop: '3px' }} />
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,.75)' }}>{r.role}</div>
                <div style={{ fontSize: '0.67rem', color: 'rgba(255,255,255,.4)' }}>{r.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Evidence gate on the linked task */}
      {task && task.evidence.length > 0 && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
            Evidence gate
          </div>
          {task.evidence.map(ev => (
            <div key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
              <i class={`fas ${ev.attached ? 'fa-circle-check' : 'fa-circle-xmark'}`} style={{ fontSize: '0.72rem', color: ev.attached ? '#4ade80' : '#f87171' }} />
              <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,.65)' }}>{ev.label}</span>
              {ev.required && <span style={{ fontSize: '0.6rem', color: '#f59e0b', fontWeight: 700 }}>REQ</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Audit Log tab ─────────────────────────────────────────────────────────────

function AuditTab(): VNode {
  const wf = useWorkflow();
  const [search, setSearch]   = useState('');
  const [moduleF, setModuleF] = useState('all');

  const rows = useMemo<AuditEvent[]>(() => {
    const q = search.toLowerCase();
    return wf.state.audit.filter(e => {
      const matchSearch = !q || `${e.event} ${e.actor} ${e.impact}`.toLowerCase().includes(q);
      const matchModule = moduleF === 'all' || e.module === moduleF;
      return matchSearch && matchModule;
    });
  }, [wf.state.audit, search, moduleF]);

  const modules = [...new Set(wf.state.audit.map(e => e.module))];

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total Events</span></div>
          <div class="hse-spark-val">{wf.state.audit.length}</div>
          <div class="hse-spark-sub">Immutable audit trail</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Modules Active</span></div>
          <div class="hse-spark-val">{modules.length}</div>
          <div class="hse-spark-sub">Modules with audit events</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Decisions</span></div>
          <div class="hse-spark-val">
            {wf.state.audit.filter(e => /approved|rejected|returned/.test(e.event)).length}
          </div>
          <div class="hse-spark-sub">Approval decisions logged</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Handoffs</span></div>
          <div class="hse-spark-val">{wf.state.handoffs.length}</div>
          <div class="hse-spark-sub">Cross-module handoffs</div>
        </div>
      </div>

      <div class="vt-toolbar" style={{ marginBottom: '14px' }}>
        <div class="vt-search" style={{ flex: '1 1 220px' }}>
          <i class="fas fa-search" />
          <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search audit events…" />
        </div>
        <select class="emp-filter-select" value={moduleF} onChange={e => setModuleF((e.target as HTMLSelectElement).value)}>
          <option value="all">All modules</option>
          {modules.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i class="fas fa-lock" style={{ color: '#4ade80' }} />
          Immutable · append-only
        </div>
      </div>

      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr><th>ID</th><th>Timestamp</th><th>Module</th><th>Event</th><th>Actor</th><th>Impact</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colspan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>No audit events match.</td></tr>
              )}
              {rows.map(e => (
                <tr key={e.id}>
                  <td><span class="vt-cell-mono" style={{ fontSize: '0.68rem' }}>{e.id}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                    {new Date(e.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      <i class={`fas ${MODULE_ICON[e.module] ?? 'fa-gear'}`} style={{ fontSize: '0.68rem' }} />
                      {e.module}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500, fontSize: '0.78rem' }}>{e.event}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{e.actor}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.72rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.impact}>{e.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Handoffs tab ──────────────────────────────────────────────────────────────

function HandoffsTab(): VNode {
  const wf = useWorkflow();
  const handoffs: Handoff[] = wf.state.handoffs;

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
          <div class="hse-spark-val" style={{ color: '#f59e0b' }}>
            {handoffs.filter(h => h.status === 'pending').length}
          </div>
          <div class="hse-spark-sub">Awaiting receiving module</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Finance</span></div>
          <div class="hse-spark-val">{handoffs.filter(h => h.target === 'finance').length}</div>
          <div class="hse-spark-sub">Cost allocation handoffs</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">HR</span></div>
          <div class="hse-spark-val">{handoffs.filter(h => h.target === 'hr').length}</div>
          <div class="hse-spark-sub">Employee impact handoffs</div>
        </div>
      </div>

      {handoffs.length === 0 ? (
        <div class="wf-empty">
          <i class="fas fa-handshake" />
          <strong>No handoffs yet</strong>
          <span>Approving an incident investigation or document will emit cross-module handoffs here.</span>
        </div>
      ) : (
        <div class="vt-table-card">
          <div class="vt-table-scroll">
            <table class="vt-table">
              <thead>
                <tr><th>ID</th><th>Source</th><th>Target</th><th>Record</th><th>Summary</th><th>Owner</th><th>Due</th><th>Status</th></tr>
              </thead>
              <tbody>
                {handoffs.map(h => (
                  <tr key={h.id}>
                    <td><span class="vt-cell-mono" style={{ fontSize: '0.68rem' }}>{h.id}</span></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem' }}>
                        <i class={`fas ${MODULE_ICON[h.source] ?? 'fa-gear'}`} style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }} />
                        {h.source}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem' }}>
                        <i class={`fas ${MODULE_ICON[h.target] ?? 'fa-gear'}`} style={{ fontSize: '0.68rem', color: 'rgba(96,165,250,.8)' }} />
                        <span style={{ color: 'rgba(96,165,250,.9)', fontWeight: 600 }}>{h.target}</span>
                      </span>
                    </td>
                    <td><span class="vt-cell-mono" style={{ fontSize: '0.7rem' }}>{h.recordRef}</span></td>
                    <td style={{ fontSize: '0.73rem', color: 'var(--text-muted)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.summary}>{h.summary}</td>
                    <td style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{h.owner}</td>
                    <td style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{h.due}</td>
                    <td><StatusPill status={h.status} /></td>
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

const WIZARD_STEPS = ['Choose template', 'Fill details', 'Review & submit'];

function WizardTab(): VNode {
  const wf = useWorkflow();
  const [step, setStep]           = useState(0);
  const [templateId, setTemplate] = useState(WORKFLOW_TEMPLATES[0]!.id);
  const [recordRef, setRecordRef] = useState('');
  const [reason, setReason]       = useState('');
  const [priority, setPriority]   = useState<'critical' | 'high' | 'normal' | 'low'>('normal');
  const [due, setDue]             = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);

  const tpl = WORKFLOW_TEMPLATES.find(t => t.id === templateId)!;

  function reset(): void {
    setStep(0); setTemplate(WORKFLOW_TEMPLATES[0]!.id); setRecordRef(''); setReason('');
    setPriority('normal'); setDue(''); setSubmitted(null);
  }

  function submit(): void {
    const ref = recordRef.trim() || 'MANUAL-001';
    wf.submit({ templateId, recordRef: ref, reason: reason.trim() || 'Manually initiated via Workflow Wizard.', priority, due: due || 'Next review' });
    // The submitted workflow will be the first entry in state after commit.
    setSubmitted(ref);
  }

  if (submitted) {
    return (
      <div class="ppe-tab-content">
        <div class="wf-submitted">
          <div class="wf-submitted-icon"><i class="fas fa-circle-check" /></div>
          <h3>Workflow submitted</h3>
          <div class="wf-mono wf-submitted-id">{submitted}</div>
          <p>Your workflow has been created and an approval task has been routed to the <strong>{tpl.approvalRoute[tpl.approvalRoute.length - 1]?.role ?? 'approver'}</strong>. You can track its progress in the <strong>Workflow Register</strong> tab.</p>
          <div class="wf-submitted-actions">
            <button class="hse-btn primary" onClick={reset}><i class="fas fa-plus" /> New workflow</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="ppe-tab-content">
      {/* Stepper */}
      <div class="wf-stepper">
        {WIZARD_STEPS.map((label, i) => (
          <div key={i} class={`wf-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}>
            <div class="wf-step-dot">
              {i < step ? <i class="fas fa-check" /> : <span>{i + 1}</span>}
            </div>
            <span class="wf-step-label">{label}</span>
            {i < WIZARD_STEPS.length - 1 && <div class="wf-step-connector" />}
          </div>
        ))}
      </div>

      {/* Step 0: template picker */}
      {step === 0 && (
        <div class="wf-wizard-body">
          <h3 class="wf-wizard-heading">Choose a workflow template</h3>
          <p class="wf-wizard-sub">Select the type of governed process you need to initiate. Each template defines the approval route, evidence gates and downstream handoffs.</p>
          <div class="wf-template-grid">
            {WORKFLOW_TEMPLATES.map(t => (
              <label key={t.id} class={`wf-template-card${templateId === t.id ? ' selected' : ''}`}>
                <input type="radio" name="template" value={t.id} checked={templateId === t.id} onChange={() => setTemplate(t.id)} style={{ position: 'absolute', opacity: 0 }} />
                <div class="wf-template-icon">
                  <i class={`fas ${MODULE_ICON[t.sourceModule] ?? 'fa-diagram-project'}`} />
                </div>
                <div class="wf-template-body">
                  <strong>{t.label}</strong>
                  <span>{t.approvalRoute.length}-step approval · {t.evidence.length} evidence gate{t.evidence.length !== 1 ? 's' : ''}</span>
                  {t.handoffsOnApproval.length > 0 && (
                    <span class="wf-template-handoff">
                      <i class="fas fa-arrow-right-arrow-left" /> Handoffs: {t.handoffsOnApproval.map(h => h.target).join(', ')}
                    </span>
                  )}
                </div>
                <div class="wf-template-check">
                  {templateId === t.id && <i class="fas fa-circle-check" />}
                </div>
              </label>
            ))}
          </div>
          <div class="wf-wizard-foot">
            <button class="hse-btn primary" onClick={() => setStep(1)}>Next <i class="fas fa-arrow-right" /></button>
          </div>
        </div>
      )}

      {/* Step 1: detail form */}
      {step === 1 && (
        <div class="wf-wizard-body">
          <h3 class="wf-wizard-heading">Fill in the details</h3>
          <p class="wf-wizard-sub">Provide the record reference this workflow governs, the reason it's being initiated, and the priority.</p>

          <div class="wf-form-grid">
            <div class="wf-form-field">
              <label>Template</label>
              <div class="wf-form-readonly">{tpl.label}</div>
            </div>
            <div class="wf-form-field">
              <label>Record reference <span class="wf-req">*</span></label>
              <input class="wf-input" type="text" value={recordRef} onInput={e => setRecordRef((e.target as HTMLInputElement).value)} placeholder="e.g. INC-2026-055, PTW-0041" />
            </div>
            <div class="wf-form-field wf-span-2">
              <label>Reason / context <span class="wf-req">*</span></label>
              <textarea class="wf-input" rows={3} value={reason} onInput={e => setReason((e.target as HTMLTextAreaElement).value)} placeholder="Briefly describe why this workflow is being initiated…" />
            </div>
            <div class="wf-form-field">
              <label>Priority</label>
              <select class="wf-input" value={priority} onChange={e => setPriority((e.target as HTMLSelectElement).value as typeof priority)}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div class="wf-form-field">
              <label>Due date / time</label>
              <input class="wf-input" type="text" value={due} onInput={e => setDue((e.target as HTMLInputElement).value)} placeholder="e.g. Today 4:00 PM, 25 Jun 2026" />
            </div>
          </div>

          <div class="wf-wizard-foot">
            <button class="hse-btn" onClick={() => setStep(0)}><i class="fas fa-arrow-left" /> Back</button>
            <button class="hse-btn primary" onClick={() => setStep(2)}>Review <i class="fas fa-arrow-right" /></button>
          </div>
        </div>
      )}

      {/* Step 2: review */}
      {step === 2 && (
        <div class="wf-wizard-body">
          <h3 class="wf-wizard-heading">Review &amp; submit</h3>
          <p class="wf-wizard-sub">Confirm everything looks right before submitting. This will create a workflow and route an approval task.</p>

          <div class="wf-review-card">
            <div class="wf-review-row"><span>Template</span><strong>{tpl.label}</strong></div>
            <div class="wf-review-row"><span>Record</span><strong class="wf-mono">{recordRef || 'MANUAL-001'}</strong></div>
            <div class="wf-review-row"><span>Priority</span><PriorityChip priority={priority} /></div>
            <div class="wf-review-row"><span>Due</span><strong>{due || 'Next review'}</strong></div>
            <div class="wf-review-row wf-review-reason"><span>Reason</span><em>{reason || 'Manually initiated via Workflow Wizard.'}</em></div>
          </div>

          <div class="wf-review-route">
            <div class="wf-review-route-head"><i class="fas fa-route" /> Approval route</div>
            {tpl.approvalRoute.map((r, i) => (
              <div key={i} class="wf-review-route-step">
                <div class="wf-review-route-num">{i + 1}</div>
                <div>
                  <strong>{r.role}</strong>
                  <span>{r.label}</span>
                </div>
              </div>
            ))}
          </div>

          {tpl.evidence.length > 0 && (
            <div class="wf-review-evidence">
              <div class="wf-review-route-head"><i class="fas fa-paperclip" /> Evidence required</div>
              {tpl.evidence.map(e => (
                <div key={e.key} class="wf-review-ev-item">
                  <i class="fas fa-circle" style={{ fontSize: '0.4rem', color: e.required ? '#f59e0b' : '#94a3b8', marginTop: '5px' }} />
                  <span>{e.label} {e.required && <strong style={{ color: '#f59e0b' }}>(required)</strong>}</span>
                </div>
              ))}
            </div>
          )}

          {tpl.handoffsOnApproval.length > 0 && (
            <div class="wf-review-evidence">
              <div class="wf-review-route-head"><i class="fas fa-arrow-right-arrow-left" /> Handoffs on approval</div>
              {tpl.handoffsOnApproval.map((h, i) => (
                <div key={i} class="wf-review-ev-item">
                  <i class={`fas ${MODULE_ICON[h.target] ?? 'fa-gear'}`} style={{ fontSize: '0.72rem', color: '#60a5fa' }} />
                  <span><strong>{h.target}</strong> — {h.summary}</span>
                </div>
              ))}
            </div>
          )}

          <div class="wf-wizard-foot">
            <button class="hse-btn" onClick={() => setStep(1)}><i class="fas fa-arrow-left" /> Back</button>
            <button class="hse-btn primary" onClick={submit}><i class="fas fa-paper-plane" /> Submit workflow</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root area component ───────────────────────────────────────────────────────

export function WorkflowsArea({ tab }: { tab: string }): VNode {
  const [active, setActive] = useState(tab);
  const wf = useWorkflow();

  const pending = wf.state.approvals.filter(a => /pending|in_review/.test(a.status)).length;
  const open    = wf.state.workflows.filter(w => !/closed|rejected/.test(w.status)).length;

  const stats = [
    { icon: 'fa-inbox',            label: 'Pending approvals', value: pending,                     color: pending > 0 ? 'gold' : 'green' },
    { icon: 'fa-diagram-project',  label: 'Open workflows',    value: open,                        color: 'blue'  },
    { icon: 'fa-shield-halved',    label: 'Audit events',      value: wf.state.audit.length,       color: 'blue'  },
    { icon: 'fa-handshake',        label: 'Handoffs',          value: wf.state.handoffs.length,    color: 'blue'  },
  ];

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-diagram-project"
        areaIcon="fa-wand-magic-sparkles"
        title="Workflow Management"
        crumb="Workflows"
        context={['Governed approvals · Evidence gates · Audit trail', 'Trinidad & Tobago Operations']}
        badges={[
          { icon: 'fa-calendar', label: 'Jan – Jun 2026' },
          { icon: 'fa-route', label: `${WORKFLOW_TEMPLATES.length} templates` },
          { icon: 'fa-lock', label: 'Immutable audit' },
        ]}
        stats={stats}
        metrics={[
          { label: 'Templates available', value: String(WORKFLOW_TEMPLATES.length) },
          { label: 'Avg. approval stages', value: '2' },
          { label: 'Cross-module handoffs', value: String(wf.state.handoffs.length) },
          { label: 'Audit events logged', value: String(wf.state.audit.length), highlight: wf.state.audit.length > 0 },
        ]}
      />
      <AreaTabs tabs={TABS} active={active} onSelect={setActive} />

      {active === 'approvals' && <ApprovalsTab />}
      {active === 'register'  && <RegisterTab />}
      {active === 'audit'     && <AuditTab />}
      {active === 'handoffs'  && <HandoffsTab />}
      {active === 'wizard'    && <WizardTab />}
    </div>
  );
}
