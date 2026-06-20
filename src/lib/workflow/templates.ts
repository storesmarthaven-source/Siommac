/**
 * src/lib/workflow/templates.ts
 *
 * Declarative workflow templates. Each entry fully describes a governed process
 * — its stages, approval route, evidence gates and the handoffs it emits on
 * approval. Adding a new workflow type is a DATA edit here; no engine code
 * changes. HSE templates ship now; HR/Payroll/Finance add their own later.
 */

import type { WorkflowTemplate, WorkflowStage } from './types';

/** The canonical ERP stage spine, reused by most templates. */
const STAGES: readonly WorkflowStage[] = [
  { key: 'scope',    label: 'Scope',    hint: 'Define record, owner and effective date.' },
  { key: 'validate', label: 'Validate', hint: 'Run rules, permissions and exception checks.' },
  { key: 'evidence', label: 'Evidence', hint: 'Attach required supporting evidence.' },
  { key: 'approve',  label: 'Approve',  hint: 'Route to accountable owners.' },
  { key: 'output',   label: 'Output',   hint: 'Create downstream records and handoffs.' },
  { key: 'audit',    label: 'Audit',    hint: 'Lock timestamp, decision and evidence.' },
];

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'incident-investigation',
    label: 'Incident Investigation',
    sourceModule: 'hse',
    targetModule: 'hse',
    defaultPriority: 'critical',
    stages: STAGES,
    approvalRoute: [
      { role: 'Site HSE Officer', label: 'Initial classification and immediate controls' },
      { role: 'HSE Manager',      label: 'Investigation sign-off and closeout route' },
    ],
    evidence: [
      { key: 'scene',    label: 'Scene photos / sketch',          required: true  },
      { key: 'ema',      label: 'EMA evidence (environmental)',    required: false },
      { key: 'witness',  label: 'Witness / supervisor statement',  required: true  },
    ],
    handoffsOnApproval: [
      { target: 'finance', summary: 'Cleanup / cost allocation for incident closeout' },
      { target: 'hr',      summary: 'Employee impact review (injury / restricted work)' },
    ],
  },
  {
    id: 'permit-approval',
    label: 'Permit to Work Approval',
    sourceModule: 'hse',
    targetModule: 'hse',
    defaultPriority: 'high',
    stages: STAGES,
    approvalRoute: [
      { role: 'Permit Issuer',  label: 'Hazard controls and gas test verification' },
      { role: 'HSE Manager',    label: 'High-risk permit authorisation' },
    ],
    evidence: [
      { key: 'gas',    label: 'Gas test record',        required: true },
      { key: 'rescue', label: 'Rescue / standby plan',   required: true },
      { key: 'isolation', label: 'Isolation / LOTO certificate', required: false },
    ],
    handoffsOnApproval: [],
  },
  {
    id: 'corrective-action',
    label: 'Corrective Action (CAPA)',
    sourceModule: 'hse',
    targetModule: 'hse',
    defaultPriority: 'high',
    stages: STAGES,
    approvalRoute: [
      { role: 'Action Owner', label: 'Complete and submit verification evidence' },
      { role: 'HSE Manager',  label: 'Verify effectiveness and close' },
    ],
    evidence: [
      { key: 'completion', label: 'Completion evidence', required: true },
    ],
    handoffsOnApproval: [],
  },
  {
    id: 'training-override',
    label: 'Training Expiry Override',
    sourceModule: 'hse',
    targetModule: 'hse',
    defaultPriority: 'high',
    stages: STAGES,
    approvalRoute: [
      { role: 'HSE Manager',     label: 'Temporary competency override decision' },
      { role: 'Operations Owner', label: 'Operational acceptance of residual risk' },
    ],
    evidence: [
      { key: 'justification', label: 'Override justification', required: true },
    ],
    handoffsOnApproval: [],
  },
  {
    id: 'document-approval',
    label: 'Controlled Document Approval',
    sourceModule: 'documents',
    targetModule: 'documents',
    defaultPriority: 'normal',
    stages: STAGES,
    approvalRoute: [
      { role: 'Document Controller', label: 'Technical and compliance review' },
      { role: 'HSE Manager',         label: 'Controlled release and publication' },
    ],
    evidence: [
      { key: 'changes', label: 'Change summary', required: true },
    ],
    handoffsOnApproval: [
      { target: 'hr', summary: 'Policy acknowledgement campaign distribution' },
    ],
  },
  {
    id: 'ppe-request',
    label: 'PPE Request',
    sourceModule: 'hse',
    targetModule: 'hse',
    defaultPriority: 'normal',
    stages: STAGES,
    approvalRoute: [
      { role: 'Site HSE Officer', label: 'Validate role requirement and stock availability' },
      { role: 'HSE Manager',      label: 'Approve issue and cost allocation' },
    ],
    evidence: [
      { key: 'reason', label: 'Request justification / hazard exposure', required: true },
    ],
    handoffsOnApproval: [],
  },
];

/** Lookup a template by id (undefined if unknown). */
export function templateById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find(t => t.id === id);
}
