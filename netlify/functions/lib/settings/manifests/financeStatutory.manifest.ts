// Finance Statutory Configuration — settings manifest.
// Policy controls for the sensitive statutory-config module (Spec §13).

import type { ModuleSettingsManifest } from '../types';
import { modulePolicy } from '../catalogHelpers';

const M = 'finance_statutory';
const MANAGE = 'settings.global.manage'; // org-level policy (admin / finance_manager)

export const financeStatutoryManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Finance Statutory Configuration',
  hasSettings: true,
  moduleCategory: 'finance',
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'module_owner'],
  sections: [
    { sectionKey: 'general',    applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'automation', applies: false, reasonNotApplicable: 'Statutory versions are advanced and approved manually by Finance; nothing is scheduled automatically.' },
    { sectionKey: 'audit_retention', applies: true },
  ],
  settings: [
    modulePolicy(M, 'finance_statutory.require_reapproval_on_edit', {
      label: 'Require Re-approval When an Approved Version Is Edited',
      description:
        'If enabled (default), editing the NIS class schedule of an already-approved (not-yet-active) statutory version sends it back for approval — status returns to Awaiting Approval and the approver is cleared — so the changed figures must be re-approved before activation. ' +
        'If disabled, edits on an approved version stand without re-approval (activation still requires a different approver). Statutory data is sensitive; leave this on unless you have a specific reason.',
      dataType: 'boolean',
      defaultValue: true,
      scope: ['global'],
      requiresPermission: MANAGE,
      isCritical: true,
    }),
  ],
};
