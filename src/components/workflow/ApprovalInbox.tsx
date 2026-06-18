/**
 * src/components/workflow/ApprovalInbox.tsx
 *
 * Approver task list — the "My Approvals" inbox. Each task shows its record,
 * route role, due and evidence checklist; the approver can Approve, Return or
 * Reject. Return/Reject require a comment (segregation-of-duties hygiene). Pure
 * presentational binding over useWorkflow — reused by any module.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useWorkflow } from '@lib/workflow';
import { statusPill, statusLabel } from '@lib/workflow';
import type { ApprovalTask, Decision } from '@lib/workflow';

function EvidenceRow({ task, evKey, label, required, attached, onToggle }: {
  task: string; evKey: string; label: string; required: boolean; attached: boolean; onToggle: (id: string, k: string) => void;
}): VNode {
  return (
    <label class="wf-evidence-row">
      <input type="checkbox" checked={attached} onChange={() => onToggle(task, evKey)} />
      <span><strong>{label}</strong><em>{required ? 'Required before approval.' : 'Optional supporting evidence.'}</em></span>
      <span class={`vt-pill ${attached ? 'is-on' : required ? 'is-warn' : 'is-info'}`}>{attached ? 'Attached' : required ? 'Pending' : 'Optional'}</span>
    </label>
  );
}

function TaskCard({ task, onOpen }: { task: ApprovalTask; onOpen: (t: ApprovalTask) => void }): VNode {
  return (
    <article class="wf-task" onClick={() => onOpen(task)}>
      <i class="fas fa-check-to-slot" />
      <div class="wf-task-text">
        <strong>{task.id} · {task.title}</strong>
        <span>{task.recordRef} · Due {task.due} · {task.approverRole}</span>
      </div>
      <span class={statusPill(task.status)}>{statusLabel(task.status)}</span>
    </article>
  );
}

export function ApprovalInbox(): VNode {
  const wf = useWorkflow();
  const [active, setActive] = useState<ApprovalTask | null>(null);
  const [comment, setComment] = useState('');

  const tasks = wf.pendingApprovals;

  function act(decision: Decision) {
    if (!active) return;
    if ((decision === 'return' || decision === 'reject') && !comment.trim()) return;
    wf.decide(active.id, decision, comment.trim() || undefined);
    setActive(null); setComment('');
  }

  return (
    <div class="wf-inbox">
      {tasks.length === 0 ? (
        <div class="wf-empty"><i class="fas fa-inbox" /><div><strong>No approvals waiting</strong><p>Submitted workflows route here for a decision.</p></div></div>
      ) : tasks.map(t => <TaskCard key={t.id} task={t} onOpen={setActive} />)}

      {active && (
        <div class="wf-decision">
          <div class="wf-decision-head">
            <div><strong>{active.id} · {active.title}</strong><span>{active.recordRef} · {active.module.toUpperCase()}</span></div>
            <button class="wf-x" onClick={() => { setActive(null); setComment(''); }} aria-label="Close"><i class="fas fa-xmark" /></button>
          </div>
          <div class="wf-evidence-list">
            {active.evidence.map(e => (
              <EvidenceRow key={e.key} task={active.id} evKey={e.key} label={e.label} required={e.required} attached={e.attached} onToggle={wf.toggleEvidence} />
            ))}
          </div>
          <textarea
            class="wf-comment" placeholder="Comment (required to return or reject)…"
            value={comment} onInput={e => setComment((e.target as HTMLTextAreaElement).value)}
          />
          <div class="wf-decision-actions">
            <button class="hse-btn" onClick={() => act('reject')}><i class="fas fa-ban" /> Reject</button>
            <button class="hse-btn" onClick={() => act('return')}><i class="fas fa-rotate-left" /> Return</button>
            <button class="hse-btn primary" onClick={() => act('approve')}><i class="fas fa-check" /> Approve</button>
          </div>
        </div>
      )}
    </div>
  );
}
