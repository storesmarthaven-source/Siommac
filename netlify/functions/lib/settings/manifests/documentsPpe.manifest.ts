// Documents · PPE — settings manifest (Spec §28/§29)
// Two modules under one Module-Policy nav entry; each setting maps to its real
// sub-module manage permission (settings.documents/ppe.manage).
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, safetyRule, workflowRule, auditPolicy } from '../catalogHelpers';

const M = 'documents_ppe';
const DOC = 'settings.documents.manage';
const PPE = 'settings.ppe.manage';

export const documentsPpeManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Documents · PPE',
  hasSettings: true,
  moduleCategory: 'hse',
  requiresHseReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'hse'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'workflow', applies: true },
    { sectionKey: 'files', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    workflowRule(M, 'documents.require_approval_before_publish', {
      label: 'Approval Before Publish', description: 'Require approval workflow before a controlled document is published.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: DOC,
    }),
    modulePolicy(M, 'documents.acknowledgement_due_days', {
      label: 'Acknowledgement Due (days)', description: 'Days users have to acknowledge a required document.',
      dataType: 'number', defaultValue: 14, minValue: 1, maxValue: 180, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: DOC,
    }),
    modulePolicy(M, 'documents.auto_supersede_previous_version', {
      label: 'Auto-Supersede Previous Version', description: 'Mark the previous version superseded when a new one is published.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: DOC,
    }),
    auditPolicy(M, 'documents.audit_download', {
      label: 'Audit Document Downloads', description: 'Record controlled-document downloads.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    safetyRule(M, 'documents.critical_acknowledgement_locked', {
      label: 'Critical Acknowledgement Locked', description: 'Prevent users from bypassing acknowledgement on critical documents.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: DOC,
    }),
    safetyRule(M, 'ppe.require_ppe_by_hazard', {
      label: 'PPE By Hazard Required', description: 'Require PPE requirements to be mapped to hazard categories.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: PPE,
    }),
    modulePolicy(M, 'ppe.require_ppe_inspection', {
      label: 'Require PPE Inspection', description: 'Require periodic inspection of issued PPE.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: PPE,
    }),
    modulePolicy(M, 'ppe.replacement_interval_days', {
      label: 'PPE Replacement Interval (days)', description: 'Default days before PPE replacement is due.',
      dataType: 'number', defaultValue: 180, minValue: 1, maxValue: 1825, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: PPE,
    }),
    safetyRule(M, 'ppe.required_for_ptw_activation', {
      label: 'PPE Required for PTW Activation', description: 'Permit activation requires confirmation of required PPE.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: PPE,
    }),
  ],
};
