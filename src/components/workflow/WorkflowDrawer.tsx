/**
 * src/components/workflow/WorkflowDrawer.tsx
 *
 * Slide-in detail for a single workflow instance: current status, tasks, and
 * the decision controls for the active approver. Driven by a workflow id from
 * the backend; reused by any module that needs to open a governed record.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useWorkflow, useDecideWorkflowTask } from '@api/workflows';
import { statusPill, statusLabel, priorityPill } from '@lib/workflow';
import type { WorkflowStatus, Priority } from '@lib/workflow/types';

export function WorkflowDrawer({ workflowId, onClose }: { workflowId: string | null; onClose: () => void }): VNode {
  const detailQ = useWorkflow(workflowId ?? '');
  const decide  = useDecideWorkflowTask();
  const [comment, setComment] = useState('');

  const detail   = detailQ.data ?? null;
  const instance = detail?.workflow ?? null;
  const tasks    = detail?.tasks ?? [];
  const activeTask = tasks.find(t => /pending|in_review|returned/.test(t.status)) ?? null;

  function act(decision: 'approved' | 'rejected' | 'returned') {
    if (!activeTask) return;
    if ((decision === 'returned' || decision === 'rejected') && !comment.trim()) return;
    decide.mutate({ taskId: activeTask.id, decision, note: comment.trim() || undefined });
    setComment(''); onClose();
  }

  return (
    <>
      <div class={`hse-drawer-backdrop${instance ? ' show' : ''}`} onClick={onClose} />
      <aside class={`hse-drawer${instance ? ' show' : ''}`} role="dialog" aria-modal="true" aria-hidden={!instance}>
        <div class="hse-drawer-head">
          <div>
            <h3>{instance ? `${instance.ref} · ${instance.template_id.replace(/_/g, ' ')}` : 'Workflow'}</h3>
            <p>{instance ? `${instance.source_entity_id} · ${instance.source_module.toUpperCase()}` : ''}</p>
          </div>
          <button class="hse-icon-btn" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>

        <div class="hse-drawer-body">
          {detailQ.isLoading && (
            <div class="wf-empty"><i class="fas fa-spinner fa-spin" /><div><strong>Loading…</strong></div></div>
          )}
          {instance && (
            <>
              <div class="hse-drawer-grid">
                <div class="hse-drawer-card"><span>Status</span><strong><span class={statusPill(instance.status as WorkflowStatus)}>{statusLabel(instance.status as WorkflowStatus)}</span></strong></div>
                <div class="hse-drawer-card"><span>Priority</span><strong><span class={priorityPill(instance.priority as Priority)}>{instance.priority}</span></strong></div>
                <div class="hse-drawer-card"><span>Due</span><strong>{instance.due_at ? new Date(instance.due_at).toLocaleDateString('en-GB') : '—'}</strong></div>
                <div class="hse-drawer-card"><span>Step</span><strong>{instance.current_step}</strong></div>
              </div>

              {tasks.length > 0 && (
                <section class="wf-section">
                  <div class="wf-section-title"><i class="fas fa-list-check" /> Tasks</div>
                  <div class="wf-stages">
                    {tasks.map(t => (
                      <div class={`wf-stage${t.id === activeTask?.id ? ' active' : ''}`} key={t.id}>
                        <b>{t.step_key} · {t.task_type}</b>
                        <span>
                          {t.assigned_role ?? 'Unassigned'}
                          {t.decision ? ` · ${t.decision}` : ''}
                        </span>
                        <span class={statusPill(t.status as WorkflowStatus)}>{statusLabel(t.status as WorkflowStatus)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeTask && (
                <section class="wf-section">
                  <div class="wf-section-title"><i class="fas fa-gavel" /> Decision</div>
                  <textarea class="wf-comment" placeholder="Comment (required to return or reject)…" value={comment} onInput={e => setComment((e.target as HTMLTextAreaElement).value)} />
                </section>
              )}
            </>
          )}
        </div>

        <div class="hse-drawer-foot">
          {activeTask ? (
            <>
              <button class="hse-btn" onClick={() => act('rejected')} disabled={decide.isPending}>Reject</button>
              <button class="hse-btn" onClick={() => act('returned')} disabled={decide.isPending}>Return</button>
              <button class="hse-btn primary" onClick={() => act('approved')} disabled={decide.isPending}>Approve</button>
            </>
          ) : (
            <button class="hse-btn" onClick={onClose}>Close</button>
          )}
        </div>
      </aside>
    </>
  );
}
