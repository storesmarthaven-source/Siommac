// CAPA · JSA · Inspections — settings manifest (Spec §28/§29)
// Three closely-related HSE modules under one Module-Policy nav entry. Each
// setting maps to its real sub-module manage permission (settings.capa/jsa/
// inspections.manage) since the grouped moduleKey has no permission of its own.
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, safetyRule, workflowRule } from '../catalogHelpers';

const M = 'capa_jsa_inspections';
const CAPA = 'settings.capa.manage';
const JSA = 'settings.jsa.manage';
const INSP = 'settings.inspections.manage';

export const capaJsaInspectionsManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'CAPA · JSA · Inspections',
  hasSettings: true,
  moduleCategory: 'hse',
  requiresHseReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'hse'],
  sections: [
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'workflow', applies: true },
    { sectionKey: 'escalation', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    modulePolicy(M, 'capa.require_evidence_to_complete', {
      label: 'CAPA Evidence Required', description: 'Require evidence before a CAPA can be completed.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: CAPA,
    }),
    workflowRule(M, 'capa.require_verification_before_close', {
      label: 'CAPA Verification Required', description: 'Require verification before a CAPA can be closed.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: CAPA,
    }),
    workflowRule(M, 'capa.overdue_escalation_days', {
      label: 'CAPA Overdue Escalation (days)', description: 'Days overdue before a CAPA escalates.',
      dataType: 'number', defaultValue: 3, minValue: 1, maxValue: 60, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: CAPA,
    }),
    workflowRule(M, 'capa.extension_requires_approval', {
      label: 'CAPA Extension Needs Approval', description: 'Due-date extensions require approval.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: CAPA,
    }),
    safetyRule(M, 'jsa.require_hazard_per_step', {
      label: 'JSA Hazard Per Step', description: 'Require at least one hazard per JSA work step.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: JSA,
    }),
    modulePolicy(M, 'jsa.require_residual_risk', {
      label: 'JSA Residual Risk Required', description: 'Require a residual-risk rating after controls.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: JSA,
    }),
    safetyRule(M, 'jsa.block_ptw_if_not_approved', {
      label: 'Unapproved JSA Blocks PTW', description: 'An unapproved JSA blocks the related permit.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: JSA,
    }),
    modulePolicy(M, 'jsa.validity_days', {
      label: 'JSA Validity (days)', description: 'How long an approved JSA remains valid.',
      dataType: 'number', defaultValue: 30, minValue: 1, maxValue: 365, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: JSA,
    }),
    modulePolicy(M, 'inspections.require_evidence_on_fail', {
      label: 'Inspection Evidence on Fail', description: 'Require evidence for a failed inspection item.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: INSP,
    }),
    workflowRule(M, 'inspections.auto_create_capa_on_critical_finding', {
      label: 'Auto-Create CAPA on Critical Finding', description: 'Create a CAPA automatically from a critical inspection finding.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: INSP,
    }),
    modulePolicy(M, 'inspections.pass_score_threshold', {
      label: 'Inspection Pass Threshold (%)', description: 'Minimum score for an inspection to pass.',
      dataType: 'number', defaultValue: 80, minValue: 0, maxValue: 100, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: INSP,
    }),
  ],
};
