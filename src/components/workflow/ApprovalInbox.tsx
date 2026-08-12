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
import { statusBadgeTone, statusLabel } from '@lib/workflow';
import type { WorkflowStatus } from '@lib/workflow/types';
import { Badge, EmptyState, Spinner } from '@ui';

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
      <Badge tone={statusBadgeTone(task.status as WorkflowStatus)}>{statusLabel(task.status as WorkflowStatus)}</Badge>
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
    return <div class="wf-inbox"><Spinner label="Loading approvals…" center /></div>;
  }

  return (
    <div class="wf-inbox">
      {tasks.length === 0 ? (
        <EmptyState size="compact" icon="fa-inbox" title="No approvals waiting" text="Submitted workflows route here for a decision." />
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
