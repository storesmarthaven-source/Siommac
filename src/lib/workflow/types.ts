/**
 * src/lib/workflow/types.ts
 *
 * Type contract for the cross-module workflow / approval / audit engine.
 *
 * This is the governed-transaction backbone an ERP runs on: a business event
 * creates a RECORD, which spawns a WORKFLOW INSTANCE that routes through an
 * APPROVAL ROUTE, gates each stage on EVIDENCE, escalates on SLA, HANDS OFF
 * outputs to downstream modules, and writes an immutable AUDIT EVENT for every
 * decision. The engine is module-agnostic — HSE wires into it now; HR / Payroll
 * / Finance reuse the same contract later with zero changes here.
 *
 * Everything is fully typed (no positional tuples) and side-effect free; the
 * store (store.ts) owns mutation, the hook (useWorkflow.ts) owns reactivity.
 */

// ── Shared vocabulary ─────────────────────────────────────────────────────────

/** Modules that can own, target, or receive workflow output. */
export type ModuleKey =
  | 'hse' | 'hr' | 'payroll' | 'finance' | 'documents' | 'core' | 'admin';

/** Priority drives SLA + escalation tone. */
export type Priority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Lifecycle status shared by workflows and approvals. Kept as a small closed
 * union so UI tone mapping (statusTone) is exhaustive.
 */
export type WorkflowStatus =
  | 'draft'
  | 'pending'      // submitted, awaiting a decision
  | 'in_review'
  | 'returned'     // sent back for correction
  | 'approved'
  | 'rejected'
  | 'closed'
  | 'blocked';

/** A decision an approver can make on a task. */
export type Decision = 'approve' | 'return' | 'reject';

// ── Templates (declarative config — adding a workflow type is a data edit) ────

/** One stage in a workflow's lifecycle (Scope → Validate → Evidence → …). */
export interface WorkflowStage {
  readonly key:  string;
  readonly label: string;
  readonly hint:  string;
}

/** One step in the approval route (who decides, in order). */
export interface ApprovalRouteStep {
  readonly role:  string;       // e.g. "HSE Manager"
  readonly label: string;       // human description of the gate
}

/** A required piece of evidence before a stage can complete. */
export interface EvidenceGate {
  readonly key:      string;
  readonly label:    string;
  readonly required: boolean;
}

/** A downstream module the workflow hands off to on approval. */
export interface HandoffSpec {
  readonly target:   ModuleKey;
  readonly summary:  string;     // what the target receives
}

/**
 * Declarative definition of a workflow type. Templates live in `templates.ts`
 * as data; the engine never hard-codes a process.
 */
export interface WorkflowTemplate {
  readonly id:            string;          // e.g. 'incident-investigation'
  readonly label:         string;          // 'Incident Investigation'
  readonly sourceModule:  ModuleKey;
  readonly targetModule:  ModuleKey;
  readonly defaultPriority: Priority;
  readonly stages:        readonly WorkflowStage[];
  readonly approvalRoute: readonly ApprovalRouteStep[];
  readonly evidence:      readonly EvidenceGate[];
  /** Handoffs emitted to downstream modules when the workflow is approved. */
  readonly handoffsOnApproval: readonly HandoffSpec[];
}

// ── Runtime instances (what the store holds) ──────────────────────────────────

/** Evidence item state on a live workflow (gate + whether it's attached). */
export interface EvidenceItem {
  readonly key:      string;
  readonly label:    string;
  readonly required: boolean;
  attached:          boolean;
}

/** A live workflow instance created from a template. */
export interface WorkflowInstance {
  readonly id:           string;            // 'WF-2501'
  readonly templateId:   string;
  readonly label:        string;
  readonly sourceModule: ModuleKey;
  readonly targetModule: ModuleKey;
  readonly recordRef:    string;            // the business record it governs
  priority:              Priority;
  status:                WorkflowStatus;
  stageKey:              string;            // current stage
  readonly due:          string;
  readonly reason:       string;
  readonly createdAt:    string;            // ISO
  readonly createdBy:    string;
}

/** An approval task assigned to a role/approver for a workflow. */
export interface ApprovalTask {
  readonly id:          string;            // 'APR-6001'
  readonly workflowId:  string;
  readonly title:       string;
  readonly approverRole: string;
  readonly module:      ModuleKey;
  readonly recordRef:   string;
  readonly due:         string;
  status:               WorkflowStatus;
  evidence:             EvidenceItem[];
  /** Mandatory comment captured on return/reject. */
  comment?:             string;
  readonly createdAt:   string;
}

/** An immutable audit event. The store only ever appends these. */
export interface AuditEvent {
  readonly id:        string;
  readonly at:        string;              // ISO
  readonly module:    ModuleKey;
  readonly event:     string;
  readonly actor:     string;
  readonly impact:    string;
}

/** A cross-module handoff (the seam to HR / Payroll / Finance). */
export interface Handoff {
  readonly id:         string;            // 'HSE-FIN-118'
  readonly source:     ModuleKey;
  readonly target:     ModuleKey;
  readonly recordRef:  string;
  readonly summary:    string;
  readonly evidence:   string;
  readonly due:        string;
  readonly owner:      string;
  status:              WorkflowStatus;
  readonly createdAt:  string;
}

/** A lightweight in-app notification raised by engine actions. */
export interface WorkflowNotification {
  readonly id:    string;
  readonly title: string;
  readonly body:  string;
  readonly tone:  Priority | 'info';
  readonly at:    string;
}

/** The full persisted engine state. */
export interface WorkflowState {
  workflows:     WorkflowInstance[];
  approvals:     ApprovalTask[];
  audit:         AuditEvent[];      // newest first; append-only
  handoffs:      Handoff[];
  notifications: WorkflowNotification[];
  /** Monotonic id counters so refs stay unique across a session. */
  seq: { workflow: number; approval: number; handoff: number; audit: number; note: number };
}

// ── Action inputs ─────────────────────────────────────────────────────────────

/** Caller context for any mutating action (who is acting). */
export interface ActorContext {
  readonly actor: string;   // display name, e.g. 'Sarah Chen'
  readonly role:  string;   // active role, e.g. 'HSE Manager'
}

/** Input to submit a new workflow from a template + a business record. */
export interface SubmitWorkflowInput {
  readonly templateId: string;
  readonly recordRef:  string;
  readonly reason:     string;
  readonly due?:       string;
  readonly priority?:  Priority;
}
