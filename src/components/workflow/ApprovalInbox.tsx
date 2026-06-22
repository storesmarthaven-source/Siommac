/**
 * src/components/workflow/ApprovalInbox.tsx
 *
 * Approver task list — the "My Approvals" inbox. Shows real workflow tasks
 * assigned to the current actor; each task can be approved, returned, or rejected.
 * Return/Reject require a comment (segregation-of-duties hygiene).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useMyWorkflowTasks, useDecideWorkflowTask, type WorkflowTask } from '@api/workflows';
import { statusPill, statusLabel } from '@lib/workflow';

function TaskCard({ task, onOpen }: { task: WorkflowTask; onOpen: (t: WorkflowTask) => void }): VNode {
  const inst = task.workflow_instances;
  const ref  = inst ? `${inst.source_module.toUpperCase()} · ${inst.source_entity_id}` : task.workflow_id;
  return (
    <article class="wf-task" onClick={() => onOpen(task)}>
      <i class="fas fa-check-to-slot" />
      <div class="wf-task-text">
        <strong>{task.step_key} · {task.task_type}</strong>
        <span>{ref} · Due {task.due_at ? new Date(task.due_at).toLocaleDateString('en-GB') : 'No deadline'} · {task.assigned_role ?? 'Unassigned'}</span>
      </div>
      <span class={statusPill(task.status as any)}>{statusLabel(task.status as any)}</span>
    </article>
  );
}

export function ApprovalInbox(): VNode {
  const tasksQ   = useMyWorkflowTasks();
  const decide   = useDecideWorkflowTask();
  const [active, setActive]   = useState<WorkflowTask | null>(null);
  const [comment, setComment] = useState('');

  const tasks = tasksQ.data ?? [];

  function act(decision: 'approved' | 'rejected' | 'returned') {
    if (!active) return;
    if ((decision === 'returned' || decision === 'rejected') && !comment.trim()) return;
    decide.mutate({ taskId: active.id, decision, note: comment.trim() || undefined });
    setActive(null); setComment('');
  }

  if (tasksQ.isLoading) {
    return <div class="wf-inbox"><div class="wf-empty"><i class="fas fa-spinner fa-spin" /><div><strong>Loading approvals…</strong></div></div></div>;
  }

  return (
    <div class="wf-inbox">
      {tasks.length === 0 ? (
        <div class="wf-empty"><i class="fas fa-inbox" /><div><strong>No approvals waiting</strong><p>Submitted workflows route here for a decision.</p></div></div>
      ) : tasks.map(t => <TaskCard key={t.id} task={t} onOpen={setActive} />)}

      {active && (
        <div class="wf-decision">
          <div class="wf-decision-head">
            <div>
              <strong>{active.step_key} · {active.task_type}</strong>
              <span>{active.workflow_instances?.source_entity_id ?? active.workflow_id} · {(active.workflow_instances?.source_module ?? 'HSE').toUpperCase()}</span>
            </div>
            <button class="wf-x" onClick={() => { setActive(null); setComment(''); }} aria-label="Close"><i class="fas fa-xmark" /></button>
          </div>
          <textarea
            class="wf-comment" placeholder="Comment (required to return or reject)…"
            value={comment} onInput={e => setComment((e.target as HTMLTextAreaElement).value)}
          />
          <div class="wf-decision-actions">
            <button class="hse-btn" onClick={() => act('rejected')} disabled={decide.isPending}><i class="fas fa-ban" /> Reject</button>
            <button class="hse-btn" onClick={() => act('returned')} disabled={decide.isPending}><i class="fas fa-rotate-left" /> Return</button>
            <button class="hse-btn primary" onClick={() => act('approved')} disabled={decide.isPending}><i class="fas fa-check" /> Approve</button>
          </div>
        </div>
      )}
    </div>
  );
}
