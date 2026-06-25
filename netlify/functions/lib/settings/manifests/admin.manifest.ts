// Admin — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, systemSecurity, auditPolicy } from '../catalogHelpers';

const M = 'admin';

export const adminManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Admin',
  hasSettings: true,
  moduleCategory: 'admin',
  requiresSecurityReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'security'],
  sections: [
    { sectionKey: 'permissions', applies: true },
    { sectionKey: 'audit_retention', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    auditPolicy(M, 'admin.audit_permission_changes', {
      label: 'Audit Permission Changes', description: 'Audit every permission grant, revoke, and override.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    auditPolicy(M, 'admin.require_reason_for_role_change', {
      label: 'Reason for Role Change', description: 'Require a reason when changing a user\'s role.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'admin.allow_temporary_permission_grants', {
      label: 'Allow Temporary Grants', description: 'Allow time-boxed temporary permission grants.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'admin.temporary_permission_expiry_required', {
      label: 'Temporary Grant Expiry Required', description: 'Temporary grants must carry an expiry date.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], canReduceStrictness: false,
    }),
    modulePolicy(M, 'admin.prevent_orphan_permissions', {
      label: 'Prevent Orphan Permissions', description: 'Block enforced permission keys that are not catalogued.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], canReduceStrictness: false,
    }),
    systemSecurity(M, 'admin.require_mfa_for_admin_actions', {
      label: 'Require MFA for Admin Actions', description: 'Require MFA / step-up for privileged admin actions.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
  ],
};
