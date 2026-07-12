// ============================================================================
// Finance Payroll -- Payslip Template workflow adapter
// ============================================================================
// Adapter for the `payslip_template_approval` workflow.
// Module key: finance_payroll_templates
// Trigger:    finance.payroll.template.submitted
//
// The central engine drives the template approval lifecycle:
//   onWorkflowStarted   -> no status change (template already at pending_approval)
//   onWorkflowCompleted -> set status='approved' + approved_by/at (enforcing SoD)
//   onWorkflowReturned  -> set status='changes_requested' (reviewer requested edits)
//   onWorkflowRejected  -> set status='changes_requested' (same path as returned)
//   onWorkflowCancelled -> set status='draft'
//
// SoD: submitted_by != approver enforced here (assertDifferentApprover).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter } from './definitionTypes';
import { writeHrAudit } from '../hr/employeeCore';
import { emitAppEvent } from '../appEvents';
import { assertDifferentApprover } from '../finance/statutoryConfig';
import { notifyTemplateSubmitter } from '../finance/payslipTemplates';

const SUBMODULE = 'finance_payroll_templates';
const ENTITY    = 'payslip_template';

/** Resolve the actor from the most recent workflow decision. */
async function decidedBy(workflowId: string): Promise<string | null> {
  const { data } = await sb
    .from('workflow_decisions')
    .select('actor_id')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ actor_id: string | null }>();
  return data?.actor_id ?? null;
}

/** Load the submitted_by column for SoD check. */
async function getSubmittedBy(templateId: string): Promise<string | null> {
  const { data } = await sb
    .from('payroll_payslip_templates')
    .select('submitted_by, created_by, name')
    .eq('id', templateId)
    .maybeSingle<{ submitted_by: string | null; created_by: string | null; name: string }>();
  return data?.submitted_by ?? data?.created_by ?? null;
}

/** Load template name (for audit/notification messages). */
async function getTemplateName(templateId: string): Promise<string> {
  const { data } = await sb
    .from('payroll_payslip_templates')
    .select('name')
    .eq('id', templateId)
    .maybeSingle<{ name: string }>();
  return data?.name ?? templateId;
}

/** Update the template status (and optionally stamp approval fields). */
async function setTemplateStatus(
  templateId: string,
  status: string,
  patch?: Record<string, unknown>,
): Promise<void> {
  const update: Record<string, unknown> = { status, ...patch };
  const { error } = await sb
    .from('payroll_payslip_templates')
    .update(update)
    .eq('id', templateId);
  if (error) {
    throw new Error('financePayslipTemplateAdapter setTemplateStatus: ' + error.message);
  }
}

const financePayslipTemplateAdapter: ModuleWorkflowAdapter = {
  moduleKey:    'finance_payroll_templates',
  workflowType: 'payslip_template_approval',

  async buildWorkflowContext() {
    // Context is built at the call site (submitTemplate), not via the adapter.
    throw new Error('finance_payroll_templates: workflow context is built at the call site (submitTemplate), not via the adapter.');
  },

  onWorkflowStarted: async () => {
    // Status is already set to pending_approval at submitTemplate time -- nothing to do.
  },

  onWorkflowStepCompleted: async () => {},

  onWorkflowCompleted: async ({ workflowId, sourceRecordId }) => {
    const actor      = await decidedBy(workflowId);
    const submittedBy = await getSubmittedBy(sourceRecordId);

    // SoD: creator/submitter cannot approve their own template.
    if (actor && submittedBy && actor === submittedBy) {
      throw Object.assign(
        new Error('Segregation of duties violation: creator cannot approve their own payslip template.'),
        { status: 422 },
      );
    }
    // Use the assertDifferentApprover helper for a consistent error message.
    assertDifferentApprover({
      actorId:   actor ?? '',
      createdBy: submittedBy,
      action:    'approve a payslip template',
    });

    await setTemplateStatus(sourceRecordId, 'approved', {
      approved_by: actor,
      approved_at: new Date().toISOString(),
    });

    const name = await getTemplateName(sourceRecordId);

    await writeHrAudit({
      submoduleKey: SUBMODULE,
      recordId:     sourceRecordId,
      actorId:      actor ?? 'workflow',
      action:       'payslip_template.approved',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'approved', approvedBy: actor },
    });

    void emitAppEvent({
      eventType:        'finance.payroll.payslip_template.approved',
      sourceModule:     SUBMODULE,
      sourceEntityType: ENTITY,
      sourceEntityId:   sourceRecordId,
      actorUserId:      actor ?? 'workflow',
      severity:         'success',
      payload:          { name, approvedBy: actor },
    });

    await notifyTemplateSubmitter({
      templateId:  sourceRecordId,
      submittedBy,
      actorId:     actor ?? 'workflow',
      decision:    'approved',
      name,
    });
  },

  onWorkflowReturned: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    await setTemplateStatus(sourceRecordId, 'changes_requested');

    const name = await getTemplateName(sourceRecordId);
    const submittedBy = await getSubmittedBy(sourceRecordId);

    await writeHrAudit({
      submoduleKey: SUBMODULE,
      recordId:     sourceRecordId,
      actorId:      actor ?? 'workflow',
      action:       'payslip_template.changes_requested',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'changes_requested' },
      reason:        comment ?? null,
    });

    void emitAppEvent({
      eventType:        'finance.payroll.payslip_template.changes_requested',
      sourceModule:     SUBMODULE,
      sourceEntityType: ENTITY,
      sourceEntityId:   sourceRecordId,
      actorUserId:      actor ?? 'workflow',
      severity:         'warning',
      payload:          { name, reason: comment ?? null },
    });

    await notifyTemplateSubmitter({
      templateId:  sourceRecordId,
      submittedBy,
      actorId:     actor ?? 'workflow',
      decision:    'changes_requested',
      name,
      comment:     comment ?? null,
    });
  },

  onWorkflowRejected: async ({ workflowId, sourceRecordId, comment }) => {
    // Per sourceStatusMap: onRejected -> 'changes_requested' (same as returned)
    const actor = await decidedBy(workflowId);
    await setTemplateStatus(sourceRecordId, 'changes_requested');

    const name = await getTemplateName(sourceRecordId);
    const submittedBy = await getSubmittedBy(sourceRecordId);

    await writeHrAudit({
      submoduleKey: SUBMODULE,
      recordId:     sourceRecordId,
      actorId:      actor ?? 'workflow',
      action:       'payslip_template.rejected_by_workflow',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'changes_requested' },
      reason:        comment ?? null,
    });

    void emitAppEvent({
      eventType:        'finance.payroll.payslip_template.rejected',
      sourceModule:     SUBMODULE,
      sourceEntityType: ENTITY,
      sourceEntityId:   sourceRecordId,
      actorUserId:      actor ?? 'workflow',
      severity:         'warning',
      payload:          { name, reason: comment ?? null },
    });

    await notifyTemplateSubmitter({
      templateId:  sourceRecordId,
      submittedBy,
      actorId:     actor ?? 'workflow',
      decision:    'changes_requested',
      name,
      comment:     comment ?? null,
    });
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason, actorId }) => {
    await setTemplateStatus(sourceRecordId, 'draft');

    await writeHrAudit({
      submoduleKey: SUBMODULE,
      recordId:     sourceRecordId,
      actorId:      actorId ?? null,
      action:       'payslip_template.workflow_cancelled',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'draft' },
      reason:        reason ?? null,
    });
  },
};

export function registerFinancePayslipTemplateAdapter(): void {
  registerWorkflowAdapter(financePayslipTemplateAdapter);
}
