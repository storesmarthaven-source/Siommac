/**
 * src/lib/workflow/store.ts
 *
 * Framework-agnostic workflow engine store. Owns ALL mutation of the governed
 * loop: submit a workflow → create its approval task → on a decision, update
 * status, append an immutable audit event, emit handoffs and notifications.
 *
 * Design notes (enterprise):
 *  • Pure data + small single-responsibility actions; no DOM, no Preact.
 *  • Immutable updates (new arrays/objects) so the Preact binding can diff by
 *    reference; subscribers are notified once per action.
 *  • Persistence is behind a thin seam (`persist`/`hydrate`) — swap localStorage
 *    for a real backend later without touching action logic.
 *  • The singleton is pinned to `window` and HMR-accepted, so editing a file in
 *    dev never resets live workflow state (same pattern as useActiveSection.ts).
 */

import {
  type WorkflowState, type WorkflowInstance, type ApprovalTask, type AuditEvent,
  type Handoff, type WorkflowNotification, type ActorContext, type SubmitWorkflowInput,
  type Decision, type WorkflowStatus, type Priority, type ModuleKey, type EvidenceItem,
} from './types';
import { templateById } from './templates';

const STORAGE_KEY = 'siomac.hse.workflow.v1';

type Listener = () => void;

// ── Seed ──────────────────────────────────────────────────────────────────────

function emptyState(): WorkflowState {
  return {
    workflows: [], approvals: [], audit: [], handoffs: [], notifications: [],
    seq: { workflow: 2500, approval: 6000, handoff: 100, audit: 1, note: 1 },
  };
}

/** A small amount of seed activity so the demo doesn't open empty. */
function seedState(): WorkflowState {
  const s = emptyState();
  const ctx: ActorContext = { actor: 'Sarah Chen', role: 'HSE Manager' };
  // One pre-existing incident workflow awaiting approval.
  applySubmit(s, ctx, {
    templateId: 'incident-investigation',
    recordRef: 'INC-2026-041',
    reason: 'Diesel sheen near storm drain — EMA evidence and cleanup closeout pending.',
    due: 'Today 4:00 PM',
  });
  applySubmit(s, ctx, {
    templateId: 'permit-approval',
    recordRef: 'PTW-0033',
    reason: 'Confined space vessel entry — gas test and rescue plan required.',
    due: 'Today 3:30 PM',
  });
  return s;
}

// ── Persistence seam ──────────────────────────────────────────────────────────

function hydrate(): WorkflowState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Partial<WorkflowState>;
    const base = emptyState();
    return {
      workflows:     parsed.workflows     ?? base.workflows,
      approvals:     parsed.approvals     ?? base.approvals,
      audit:         parsed.audit         ?? base.audit,
      handoffs:      parsed.handoffs       ?? base.handoffs,
      notifications: parsed.notifications ?? base.notifications,
      seq:           { ...base.seq, ...(parsed.seq ?? {}) },
    };
  } catch {
    return seedState();
  }
}

function persist(state: WorkflowState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

// ── id + time helpers ─────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();
const wfId   = (s: WorkflowState) => `WF-${s.seq.workflow++}`;
const aprId  = (s: WorkflowState) => `APR-${s.seq.approval++}`;
const hoId   = (s: WorkflowState) => `HO-${s.seq.handoff++}`;
const audId  = (s: WorkflowState) => `AUD-${s.seq.audit++}`;
const noteId = (s: WorkflowState) => `NTF-${s.seq.note++}`;

// ── Pure mutators (operate on a draft state; no I/O, no notify) ───────────────

function pushAudit(s: WorkflowState, module: ModuleKey, event: string, actor: string, impact: string): void {
  const e: AuditEvent = { id: audId(s), at: nowIso(), module, event, actor, impact };
  s.audit = [e, ...s.audit];          // newest first, append-only
}

function pushNotification(s: WorkflowState, title: string, body: string, tone: Priority | 'info'): void {
  const n: WorkflowNotification = { id: noteId(s), title, body, tone, at: nowIso() };
  s.notifications = [n, ...s.notifications].slice(0, 40);
}

/** Core submit logic, shared by the seed and the public action. */
function applySubmit(s: WorkflowState, ctx: ActorContext, input: SubmitWorkflowInput): WorkflowInstance | null {
  const tpl = templateById(input.templateId);
  if (!tpl) return null;

  const id = wfId(s);
  const wf: WorkflowInstance = {
    id, templateId: tpl.id, label: tpl.label,
    sourceModule: tpl.sourceModule, targetModule: tpl.targetModule,
    recordRef: input.recordRef,
    priority: input.priority ?? tpl.defaultPriority,
    status: 'pending', stageKey: 'approve',
    due: input.due ?? 'Next review',
    reason: input.reason, createdAt: nowIso(), createdBy: ctx.actor,
  };
  s.workflows = [wf, ...s.workflows];

  const evidence: EvidenceItem[] = tpl.evidence.map(g => ({ ...g, attached: false }));
  const approver = tpl.approvalRoute[tpl.approvalRoute.length - 1];
  const task: ApprovalTask = {
    id: aprId(s), workflowId: id, title: `Approve ${tpl.label}`,
    approverRole: approver?.role ?? `${tpl.targetModule} Owner`,
    module: tpl.targetModule, recordRef: input.recordRef,
    due: wf.due, status: 'pending', evidence, createdAt: nowIso(),
  };
  s.approvals = [task, ...s.approvals];

  pushAudit(s, tpl.sourceModule, `${id} submitted`, ctx.actor, `${input.recordRef} routed to ${tpl.targetModule}`);
  pushNotification(s, 'Workflow submitted', `${id} · ${input.recordRef} routed to ${tpl.targetModule}`, wf.priority);
  return wf;
}

/** Map a decision to the resulting status. */
function statusForDecision(d: Decision): WorkflowStatus {
  return d === 'approve' ? 'approved' : d === 'return' ? 'returned' : 'rejected';
}

function applyDecision(s: WorkflowState, ctx: ActorContext, approvalId: string, decision: Decision, comment?: string): void {
  const task = s.approvals.find(a => a.id === approvalId);
  if (!task) return;
  const next = statusForDecision(decision);

  task.status = next;
  if (comment) task.comment = comment;
  s.approvals = [...s.approvals];

  const wf = s.workflows.find(w => w.id === task.workflowId);
  if (wf) {
    wf.status = next === 'approved' ? 'closed' : next;
    wf.stageKey = next === 'approved' ? 'audit' : 'evidence';
    s.workflows = [...s.workflows];

    // Emit handoffs declared by the template on approval.
    if (next === 'approved') {
      const tpl = templateById(wf.templateId);
      tpl?.handoffsOnApproval.forEach(h => applyHandoff(s, ctx, {
        source: tpl.sourceModule, target: h.target, recordRef: wf.recordRef,
        summary: h.summary, evidence: 'Linked from approved workflow', due: wf.due,
        owner: `${h.target} Owner`,
      }));
    }
  }

  pushAudit(s, task.module, `${task.id} ${next}`, ctx.actor, `${task.title}${comment ? ` — ${comment}` : ''}`);
  pushNotification(s, `Approval ${next}`, `${task.id} · ${task.title}`, next === 'rejected' ? 'critical' : 'info');
}

function applyHandoff(
  s: WorkflowState, ctx: ActorContext,
  h: { source: ModuleKey; target: ModuleKey; recordRef: string; summary: string; evidence: string; due: string; owner: string },
): Handoff {
  const handoff: Handoff = {
    id: `${h.source.toUpperCase()}-${h.target.toUpperCase()}-${hoId(s).split('-')[1]}`,
    source: h.source, target: h.target, recordRef: h.recordRef, summary: h.summary,
    evidence: h.evidence, due: h.due, owner: h.owner, status: 'pending', createdAt: nowIso(),
  };
  s.handoffs = [handoff, ...s.handoffs];
  pushAudit(s, h.source, `Handoff to ${h.target}`, ctx.actor, `${h.recordRef} · ${h.summary}`);
  return handoff;
}

// ── Store singleton (window-pinned, HMR-safe) ─────────────────────────────────

interface Store {
  state: WorkflowState;
  listeners: Set<Listener>;
}

const store: Store =
  ((window as unknown as { __siomacWorkflow?: Store }).__siomacWorkflow ??=
    { state: hydrate(), listeners: new Set<Listener>() });

function commit(): void {
  persist(store.state);
  for (const fn of store.listeners) fn();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getWorkflowState(): WorkflowState {
  return store.state;
}

export function subscribeWorkflow(fn: Listener): () => void {
  store.listeners.add(fn);
  return () => { store.listeners.delete(fn); };
}

/** Submit a new governed workflow from a template + business record. */
export function submitWorkflow(ctx: ActorContext, input: SubmitWorkflowInput): WorkflowInstance | null {
  const wf = applySubmit(store.state, ctx, input);
  commit();
  return wf;
}

/** Approver decision on a task (approve / return / reject). */
export function decide(ctx: ActorContext, approvalId: string, decision: Decision, comment?: string): void {
  applyDecision(store.state, ctx, approvalId, decision, comment);
  commit();
}

/** Toggle an evidence item attached/detached on an approval task. */
export function toggleEvidence(approvalId: string, evidenceKey: string): void {
  const task = store.state.approvals.find(a => a.id === approvalId);
  if (!task) return;
  task.evidence = task.evidence.map(e => e.key === evidenceKey ? { ...e, attached: !e.attached } : e);
  store.state.approvals = [...store.state.approvals];
  commit();
}

/** Directly emit a cross-module handoff (the mock seam). */
export function emitHandoff(
  ctx: ActorContext,
  h: { source: ModuleKey; target: ModuleKey; recordRef: string; summary: string; evidence: string; due: string; owner: string },
): Handoff {
  const handoff = applyHandoff(store.state, ctx, h);
  commit();
  return handoff;
}

/** Append an audit event directly (for record actions outside a workflow). */
export function addAudit(ctx: ActorContext, module: ModuleKey, event: string, impact: string): void {
  pushAudit(store.state, module, event, ctx.actor, impact);
  commit();
}

/** Clear notifications (UI affordance). */
export function clearNotifications(): void {
  store.state.notifications = [];
  commit();
}

/** Reset the engine to seed (demo control / tests). */
export function resetWorkflow(): void {
  store.state = seedState();
  commit();
}

if (import.meta.hot) import.meta.hot.accept();
