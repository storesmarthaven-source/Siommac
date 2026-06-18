/**
 * src/components/workflow/WorkflowDrawer.tsx
 *
 * Slide-in detail for a single workflow instance: its template route (stages),
 * approval path, evidence and the decision controls. Driven by a workflow id;
 * resolves the live instance + its approval task from the store. Reused by any
 * module that wants to open a governed record.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useWorkflow, templateById, statusPill, statusLabel, priorityPill } from '@lib/workflow';
import type { Decision } from '@lib/workflow';

export function WorkflowDrawer({ workflowId, onClose }: { workflowId: string | null; onClose: () => void }): VNode {
  const wf = useWorkflow();
  const [comment, setComment] = useState('');

  const instance = workflowId ? wf.state.workflows.find(w => w.id === workflowId) ?? null : null;
  const task = instance ? wf.state.approvals.find(a => a.workflowId === instance.id) ?? null : null;
  const tpl = instance ? templateById(instance.templateId) : undefined;

  function act(decision: Decision) {
    if (!task) return;
    if ((decision === 'return' || decision === 'reject') && !comment.trim()) return;
    wf.decide(task.id, decision, comment.trim() || undefined);
    setComment(''); onClose();
  }

  return (
    <>
      <div class={`hse-drawer-backdrop${instance ? ' show' : ''}`} onClick={onClose} />
      <aside class={`hse-drawer${instance ? ' show' : ''}`} role="dialog" aria-modal="true" aria-hidden={!instance}>
        <div class="hse-drawer-head">
          <div>
            <h3>{instance ? `${instance.id} · ${instance.label}` : 'Workflow'}</h3>
            <p>{instance ? `${instance.recordRef} · ${instance.sourceModule.toUpperCase()} → ${instance.targetModule.toUpperCase()}` : ''}</p>
          </div>
          <button class="hse-icon-btn" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>

        <div class="hse-drawer-body">
          {instance && (
            <>
              <div class="hse-drawer-grid">
                <div class="hse-drawer-card"><span>Status</span><strong><span class={statusPill(instance.status)}>{statusLabel(instance.status)}</span></strong></div>
                <div class="hse-drawer-card"><span>Priority</span><strong><span class={priorityPill(instance.priority)}>{instance.priority}</span></strong></div>
                <div class="hse-drawer-card"><span>Due</span><strong>{instance.due}</strong></div>
                <div class="hse-drawer-card"><span>Created by</span><strong>{instance.createdBy}</strong></div>
              </div>

              <section class="wf-section">
                <div class="wf-section-title"><i class="fas fa-diagram-project" /> Stages</div>
                <div class="wf-stages">
                  {tpl?.stages.map(st => (
                    <div class={`wf-stage${st.key === instance.stageKey ? ' active' : ''}`} key={st.key}>
                      <b>{st.label}</b><span>{st.hint}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section class="wf-section">
                <div class="wf-section-title"><i class="fas fa-route" /> Approval Route</div>
                <div class="wf-route">
                  {tpl?.approvalRoute.map((step, i) => (
                    <div class="wf-route-step" key={i}>
                      <b>{step.role}</b><span>{step.label}</span>
                      <span class={statusPill(i === (tpl.approvalRoute.length - 1) ? instance.status : 'approved')}>
                        {statusLabel(i === (tpl.approvalRoute.length - 1) ? instance.status : 'approved')}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {task && /pending|in_review|returned/.test(task.status) && (
                <section class="wf-section">
                  <div class="wf-section-title"><i class="fas fa-gavel" /> Decision</div>
                  <textarea class="wf-comment" placeholder="Comment (required to return or reject)…" value={comment} onInput={e => setComment((e.target as HTMLTextAreaElement).value)} />
                </section>
              )}
            </>
          )}
        </div>

        <div class="hse-drawer-foot">
          {task && /pending|in_review|returned/.test(task.status) ? (
            <>
              <button class="hse-btn" onClick={() => act('reject')}>Reject</button>
              <button class="hse-btn" onClick={() => act('return')}>Return</button>
              <button class="hse-btn primary" onClick={() => act('approve')}>Approve</button>
            </>
          ) : (
            <button class="hse-btn" onClick={onClose}>Close</button>
          )}
        </div>
      </aside>
    </>
  );
}
