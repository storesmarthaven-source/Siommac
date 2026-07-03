// ============================================================================
// Central Workflow Engine — template definition + adapter contract types
// (Spec §4, §7, §8). Module-agnostic: HSE / HR / Finance / Operations all use
// the same shapes; new modules add an adapter, never edit the engine.
// ============================================================================

export type WorkflowStepType =
  | 'review' | 'approval' | 'verification' | 'acknowledgement'
  | 'assignment' | 'handoff' | 'automation' | 'closeout';

export type WorkflowAssignmentType =
  | 'fixed_user' | 'role' | 'supervisor' | 'department_manager' | 'site_manager'
  | 'hse_manager' | 'document_owner' | 'permit_area_owner' | 'record_owner'
  | 'requester_manager' | 'dynamic_field';

export type WorkflowConditionOperator =
  | 'equals' | 'not_equals' | 'in' | 'not_in'
  | 'greater_than' | 'greater_than_or_equal' | 'less_than' | 'less_than_or_equal'
  | 'exists' | 'not_exists' | 'contains' | 'date_before' | 'date_after';

export interface WorkflowCondition {
  field: string;
  operator: WorkflowConditionOperator;
  value?: unknown;
}

export interface WorkflowStepDefinition {
  stepKey: string;
  stepName: string;
  stepType: WorkflowStepType;
  sequenceNo: number;
  assignment: { type: WorkflowAssignmentType; value?: string; dynamicField?: string };
  dueDurationHours?: number;
  required: boolean;
  parallelGroup?: string;
  permissions?: { approve?: string; return?: string; reject?: string; delegate?: string };
  decisionRules: {
    canApprove: boolean; canReturn: boolean; canReject: boolean; canDelegate: boolean;
    requireCommentOnApprove: boolean; requireCommentOnReturn: boolean; requireCommentOnReject: boolean;
    requireAttachment: boolean;
  };
  conditions?: WorkflowCondition[];
}

export interface WorkflowTransitionRule {
  fromStep: string;
  onDecision: 'approved' | 'returned' | 'rejected';
  toStep?: string;
  completeWorkflow?: boolean;
  conditions?: WorkflowCondition[];
}

export type WorkflowNotificationEvent =
  | 'workflow.started' | 'task.assigned' | 'task.due_soon' | 'task.overdue'
  | 'task.approved' | 'task.returned' | 'task.rejected'
  | 'workflow.completed' | 'workflow.cancelled' | 'handoff.failed';

export type WorkflowNotificationRecipient =
  | 'requester' | 'current_assignee' | 'workflow_owner' | 'source_record_owner'
  | 'supervisor' | 'hse_manager' | 'site_manager' | 'department_manager'
  | 'fixed_user' | 'role';

export type WorkflowNotificationCriticality =
  | 'normal' | 'important' | 'workflow_required' | 'safety_critical' | 'compliance_required' | 'emergency';

export interface WorkflowNotificationRule {
  event: WorkflowNotificationEvent;
  recipients: WorkflowNotificationRecipient[];
  fixedUserId?: string;
  roleKey?: string;
  criticality: WorkflowNotificationCriticality;
  canBeMuted: boolean;
}

export type WorkflowHandoffEvent =
  | 'workflow.started' | 'step.completed' | 'workflow.completed' | 'workflow.rejected' | 'workflow.returned';

export interface WorkflowHandoffRule {
  event: WorkflowHandoffEvent;
  targetModule: string;
  action: string;            // → workflow_handoff_action_catalog.action_key
  conditions?: WorkflowCondition[];
  fieldMap: Record<string, string>;
  required: boolean;
}

export interface WorkflowSourceStatusMap {
  onStarted?: string;
  onReturned?: string;
  onRejected?: string;
  onApproved?: string;
  onCompleted?: string;
  onCancelled?: string;
}

export interface WorkflowTemplateDefinition {
  schemaVersion: 1;
  steps: WorkflowStepDefinition[];
  transitions: WorkflowTransitionRule[];
  notifications: WorkflowNotificationRule[];
  handoffs: WorkflowHandoffRule[];
  sourceStatusMap: WorkflowSourceStatusMap;
  settings: {
    allowReturn: boolean;
    allowReject: boolean;
    allowDelegate: boolean;
    allowAdminOverride: boolean;
    requireAuditAllTransitions: boolean;
  };
}

// ── Module integration contract (Spec §7, §8) ────────────────────────────────

export interface ModuleWorkflowContext {
  moduleKey: string;
  workflowType: string;
  triggerEvent: string;
  sourceRecordId: string;
  sourceRecordRef?: string;
  siteId?: string | null;
  departmentId?: string | null;
  requestedBy: string;
  ownerId?: string | null;
  actorRoleIds?: string[];
  priority?: 'low' | 'normal' | 'medium' | 'high' | 'critical';
  recordData: Record<string, unknown>;
}

export interface ModuleWorkflowAdapter {
  moduleKey: string;
  /** Optional: distinguish adapters that share a moduleKey but serve different workflow types. */
  workflowType?: string;
  buildWorkflowContext(params: { recordId: string; actorId: string; triggerEvent: string }): Promise<ModuleWorkflowContext>;
  onWorkflowStarted(params: { workflowId: string; sourceRecordId: string }): Promise<void>;
  onWorkflowStepCompleted(params: { workflowId: string; sourceRecordId: string; stepKey: string; decision: string }): Promise<void>;
  onWorkflowCompleted(params: { workflowId: string; sourceRecordId: string; finalDecision: string }): Promise<void>;
  onWorkflowReturned(params: { workflowId: string; sourceRecordId: string; comment: string }): Promise<void>;
  onWorkflowRejected(params: { workflowId: string; sourceRecordId: string; comment: string }): Promise<void>;
  onWorkflowCancelled(params: { workflowId: string; sourceRecordId: string; reason: string }): Promise<void>;
}
