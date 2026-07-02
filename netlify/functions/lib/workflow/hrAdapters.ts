// ============================================================================
// HR module workflow adapter (Spec §8/§14)
// ============================================================================
// `hr_employee_change_requests` is the change ENVELOPE; the central engine owns
// the approval LIFECYCLE. This adapter is how the engine drives the HR change:
//   • onWorkflowStarted   → mark the request in_review
//   • onWorkflowCompleted → APPLY the approved change to app_users (+ history /
//                           assignment), mark applied, audit + emit the event
//   • onWorkflowReturned / Rejected / Cancelled → set the matching status
// The approving user isn't passed to adapter callbacks, so it's resolved from
// the workflow's latest decision. Unlike the HSE status-sync adapters, this one
// performs the actual record mutation (via applyApprovedChange).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
import { applyApprovedChange, markChangeRequestStatus } from '../hr/changeApproval';
import { applyApprovedOrgChange, setOrgChangeStatus } from '../hr/organizationChangeRequests';
import { applyApprovedLeave, setLeaveRequestStatus } from '../hr/leaveCore';

/** The user who made the most recent decision on this workflow (the approver). */
async function decidedBy(workflowId: string): Promise<string | null> {
  const { data } = await sb.from('workflow_decisions')
    .select('actor_id').eq('workflow_id', workflowId)
    .order('created_at', { ascending: false }).limit(1)
    .maybeSingle<{ actor_id: string | null }>();
  return data?.actor_id ?? null;
}

const hrEmployeeMasterAdapter: ModuleWorkflowAdapter = {
  moduleKey: 'hr_employee_master',
  async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    throw new Error('hr_employee_master: workflow context is built at the call site, not via the adapter.');
  },
  onWorkflowStarted:       ({ sourceRecordId }) => markChangeRequestStatus(sourceRecordId, 'in_review', null),
  onWorkflowStepCompleted: async () => {},
  onWorkflowCompleted:     async ({ workflowId, sourceRecordId }) => { await applyApprovedChange(sourceRecordId, await decidedBy(workflowId)); },
  onWorkflowReturned:      async ({ workflowId, sourceRecordId, comment }) => { await markChangeRequestStatus(sourceRecordId, 'returned', await decidedBy(workflowId), comment); },
  onWorkflowRejected:      async ({ workflowId, sourceRecordId, comment }) => { await markChangeRequestStatus(sourceRecordId, 'rejected', await decidedBy(workflowId), comment); },
  onWorkflowCancelled:     ({ sourceRecordId, reason }) => markChangeRequestStatus(sourceRecordId, 'cancelled', null, reason),
};

// Org Structure change approval (Phase B). The envelope (hr_org_change_requests) is
// set to pending_approval at submit; this adapter drives it on the engine's decisions.
// On completion, applyApprovedOrgChange applies the stored change (or marks it scheduled
// when effective-dated). sourceStatusMap is empty — the adapter owns the status.
const hrOrgStructureAdapter: ModuleWorkflowAdapter = {
  moduleKey: 'hr_org_structure',
  async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    throw new Error('hr_org_structure: workflow context is built at the call site, not via the adapter.');
  },
  onWorkflowStarted:       async () => {},
  onWorkflowStepCompleted: async () => {},
  onWorkflowCompleted:     async ({ workflowId, sourceRecordId }) => { await applyApprovedOrgChange(sourceRecordId, await decidedBy(workflowId)); },
  onWorkflowReturned:      async ({ workflowId, sourceRecordId, comment }) => { await setOrgChangeStatus(sourceRecordId, 'pending_approval', { decidedBy: await decidedBy(workflowId), comment }); },
  onWorkflowRejected:      async ({ workflowId, sourceRecordId, comment }) => { await setOrgChangeStatus(sourceRecordId, 'rejected', { decidedBy: await decidedBy(workflowId), comment }); },
  onWorkflowCancelled:     async ({ sourceRecordId, reason }) => { await setOrgChangeStatus(sourceRecordId, 'cancelled', { comment: reason }); },
};


const hrLeaveAdapter: ModuleWorkflowAdapter = {
  moduleKey: 'hr_leave',
  async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    throw new Error('hr_leave: workflow context is built at the call site, not via the adapter.');
  },
  onWorkflowStarted:       async ({ sourceRecordId }) => { await setLeaveRequestStatus(sourceRecordId, 'pending_approval', null); },
  onWorkflowStepCompleted: async () => {},
  onWorkflowCompleted:     async ({ workflowId, sourceRecordId }) => { await applyApprovedLeave(sourceRecordId, await decidedBy(workflowId)); },
  onWorkflowReturned:      async ({ workflowId, sourceRecordId, comment }) => { await setLeaveRequestStatus(sourceRecordId, 'pending_approval', await decidedBy(workflowId), comment); },
  onWorkflowRejected:      async ({ workflowId, sourceRecordId, comment }) => { await setLeaveRequestStatus(sourceRecordId, 'rejected', await decidedBy(workflowId), comment); },
  onWorkflowCancelled:     async ({ sourceRecordId, reason }) => { await setLeaveRequestStatus(sourceRecordId, 'cancelled', null, reason); },
};

export function registerHrWorkflowAdapters(): void {
  registerWorkflowAdapter(hrEmployeeMasterAdapter);
  registerWorkflowAdapter(hrOrgStructureAdapter);
  registerWorkflowAdapter(hrLeaveAdapter);
}
