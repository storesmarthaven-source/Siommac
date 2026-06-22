/**
 * src/lib/workflow/store.test.ts
 *
 * Unit tests for the workflow engine store: the governed loop must create a
 * workflow + approval + audit on submit, update status + append audit on a
 * decision, emit template handoffs on approval, and toggle evidence.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  submitWorkflow, decide, toggleEvidence, emitHandoff, addAudit,
  getWorkflowState, resetWorkflow,
} from './store';
import type { ActorContext } from './types';

const CTX: ActorContext = { actor: 'Test User', role: 'HSE Manager' };

beforeEach(() => {
  localStorage.clear();
  resetWorkflow();
});

describe('submitWorkflow', () => {
  it('creates a workflow, an approval task, and an audit event', () => {
    const before = getWorkflowState();
    const beforeWf = before.workflows.length;
    const beforeApr = before.approvals.length;
    const beforeAud = before.audit.length;

    const wf = submitWorkflow(CTX, {
      templateId: 'hse_capa_closure',
      recordRef: 'CA-999',
      reason: 'Test corrective action',
    });

    const s = getWorkflowState();
    expect(wf).not.toBeNull();
    expect(wf!.recordRef).toBe('CA-999');
    expect(wf!.status).toBe('pending');
    expect(s.workflows.length).toBe(beforeWf + 1);
    expect(s.approvals.length).toBe(beforeApr + 1);
    expect(s.audit.length).toBe(beforeAud + 1);

    const apr = s.approvals.find(a => a.workflowId === wf!.id);
    expect(apr).toBeTruthy();
    expect(apr!.recordRef).toBe('CA-999');
    expect(apr!.evidence.length).toBeGreaterThan(0);
  });

  it('returns null for an unknown template', () => {
    const wf = submitWorkflow(CTX, { templateId: 'does-not-exist', recordRef: 'X', reason: 'y' });
    expect(wf).toBeNull();
  });
});

describe('decide', () => {
  it('approving updates statuses and appends an audit event', () => {
    const wf = submitWorkflow(CTX, { templateId: 'hse_capa_closure', recordRef: 'CA-1', reason: 'r' })!;
    const apr = getWorkflowState().approvals.find(a => a.workflowId === wf.id)!;
    const audBefore = getWorkflowState().audit.length;

    decide(CTX, apr.id, 'approve');

    const s = getWorkflowState();
    expect(s.approvals.find(a => a.id === apr.id)!.status).toBe('approved');
    expect(s.workflows.find(w => w.id === wf.id)!.status).toBe('closed');
    expect(s.audit.length).toBe(audBefore + 1);
  });

  it('rejecting records the mandatory comment', () => {
    const wf = submitWorkflow(CTX, { templateId: 'hse_permit_approval', recordRef: 'PTW-9', reason: 'r' })!;
    const apr = getWorkflowState().approvals.find(a => a.workflowId === wf.id)!;

    decide(CTX, apr.id, 'reject', 'Gas test missing');

    const after = getWorkflowState().approvals.find(a => a.id === apr.id)!;
    expect(after.status).toBe('rejected');
    expect(after.comment).toBe('Gas test missing');
  });

  it('approving a template with handoffs emits them', () => {
    // hse_incident_investigation declares finance + hr handoffs on approval.
    const wf = submitWorkflow(CTX, { templateId: 'hse_incident_investigation', recordRef: 'INC-99', reason: 'r' })!;
    const apr = getWorkflowState().approvals.find(a => a.workflowId === wf.id)!;
    const hoBefore = getWorkflowState().handoffs.length;

    decide(CTX, apr.id, 'approve');

    const s = getWorkflowState();
    expect(s.handoffs.length).toBe(hoBefore + 2);
    expect(s.handoffs.some(h => h.target === 'finance')).toBe(true);
    expect(s.handoffs.some(h => h.target === 'hr')).toBe(true);
  });
});

describe('toggleEvidence', () => {
  it('flips an evidence item attached state', () => {
    const wf = submitWorkflow(CTX, { templateId: 'hse_permit_approval', recordRef: 'PTW-2', reason: 'r' })!;
    const apr = getWorkflowState().approvals.find(a => a.workflowId === wf.id)!;
    const key = apr.evidence[0]!.key;
    expect(apr.evidence[0]!.attached).toBe(false);

    toggleEvidence(apr.id, key);

    const after = getWorkflowState().approvals.find(a => a.id === apr.id)!;
    expect(after.evidence.find(e => e.key === key)!.attached).toBe(true);
  });
});

describe('emitHandoff + addAudit', () => {
  it('emitHandoff adds a handoff and an audit event', () => {
    const hoBefore = getWorkflowState().handoffs.length;
    const audBefore = getWorkflowState().audit.length;

    emitHandoff(CTX, {
      source: 'hse', target: 'finance', recordRef: 'INC-5',
      summary: 'Cleanup cost', evidence: 'manifest', due: 'Today', owner: 'Finance Owner',
    });

    const s = getWorkflowState();
    expect(s.handoffs.length).toBe(hoBefore + 1);
    expect(s.audit.length).toBe(audBefore + 1);
    expect(s.handoffs[0]!.target).toBe('finance');
  });

  it('addAudit appends an immutable event at the front', () => {
    const before = getWorkflowState().audit.length;
    addAudit(CTX, 'hse', 'Manual action', 'Did a thing');
    const s = getWorkflowState();
    expect(s.audit.length).toBe(before + 1);
    expect(s.audit[0]!.event).toBe('Manual action');
  });
});
