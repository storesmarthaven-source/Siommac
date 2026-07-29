// Workforce Readiness — settings manifest.
//
// Backs "Settings → Workforce → Readiness Ownership" from
// docs/EMPLOYEE_READINESS_COLLABORATION_NOTE.md: each readiness area has exactly
// ONE operational owner, and that owner determines where a work item is routed,
// who receives notifications and overdue reminders, which workspace the user
// opens, and which capabilities are required to complete the control.
//
// WHY THE CANONICAL SETTINGS CATALOG AND NOT A NEW TABLE:
// `app_setting_catalog` + `app_setting_values` already are the organisation
// configuration store, with scoping, validation, audit and an admin surface.
// A dedicated `hr_readiness_ownership` table would have been a second
// configuration system for the same job — and would have needed a migration to
// say what a manifest already says.
//
// GOVERNANCE — read before changing a default:
//   * Configuration NEVER grants authority. The resolved owner must still hold
//     the capability the control requires; `lib/hr/readinessOwnership.ts`
//     re-checks that on every resolve and fails closed as `owner_required`.
//   * The defaults are deliberately EMPTY strings, not "hr_manager". Shipping a
//     default owner would mean every organisation silently routes readiness work
//     to HR before an administrator ever visited this page — the exact
//     "assume-don't-verify" failure the collaboration note fails closed against.
//     An unconfigured domain surfaces as **Owner Required**.
//   * `requiresPermission` is pinned to the EXISTING `settings.employees.manage`
//     rather than the helper's `settings.workforce_readiness.manage` default: a
//     permission key is dead until a migration grants it in `role_permissions`,
//     so defaulting would have shipped six settings nobody could edit.

import type { ModuleSettingsManifest } from '../types';
import { modulePolicy } from '../catalogHelpers';

const M = 'workforce_readiness';

/** The one permission that already exists and is granted for workforce config. */
const MANAGE = 'settings.employees.manage';

/**
 * Owner value format: `"<ownerType>:<ownerId>"`, e.g. `role:payroll_manager` or
 * `user:usr_123`. Empty string means "not configured" → fail closed.
 *
 * A compound string rather than two settings per domain keeps the pair atomic:
 * two independent settings can be saved half-updated, leaving a type that does
 * not match its id.
 */
function ownerSetting(domain: string, label: string, description: string) {
  return modulePolicy(M, `workforce_readiness.owner.${domain}`, {
    label,
    description,
    dataType: 'string' as const,
    defaultValue: '',
    scope: ['global' as const],
    requiresPermission: MANAGE,
    // Ownership routing is an operational control, not a preference: it must not
    // be silently loosened per user, role, site or department.
    canReduceStrictness: false,
    isAudited: true,
  });
}

export const workforceReadinessManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Workforce Readiness',
  hasSettings: true,
  moduleCategory: 'hr',
  reviewedBy: ['product_owner', 'engineering', 'module_owner'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'assignment', applies: true },
    { sectionKey: 'escalation', applies: true },
    { sectionKey: 'permissions', applies: true },
    { sectionKey: 'audit_retention', applies: true },
    { sectionKey: 'numbering', applies: false, reasonNotApplicable: 'Readiness ownership allocates responsibility; it issues no numbered records.' },
    { sectionKey: 'validation', applies: false, reasonNotApplicable: 'Owner values are validated by the resolver against live users and roles, not by static rules.' },
    { sectionKey: 'workflow', applies: false, reasonNotApplicable: 'Readiness work items run on the central workflow engine; this module configures routing only.' },
    { sectionKey: 'automation', applies: false, reasonNotApplicable: 'No scheduled automation; reminders are actor-initiated follow-ups.' },
    { sectionKey: 'handoffs', applies: true },
    { sectionKey: 'personal_preferences', applies: false, reasonNotApplicable: 'Ownership is organisational, never a personal preference.' },
    { sectionKey: 'critical_governance', applies: false, reasonNotApplicable: 'Configuration cannot grant authority; capability checks remain authoritative at every route.' },
  ],
  settings: [
    ownerSetting('assignment', 'Assignment Owner',
      'Team or user responsible for resolving assignment readiness controls (department, site and supervisor completeness).'),
    ownerSetting('payroll', 'Payroll Owner',
      'Team or user responsible for confirming payroll and bank readiness. Set to an HR role only when HR genuinely performs Payroll work and holds the Payroll capability.'),
    ownerSetting('training', 'Training Owner',
      'Team or user responsible for reviewing training evidence.'),
    ownerSetting('documents', 'Documents Owner',
      'Team or user responsible for required employee documents and their verification.'),
    ownerSetting('statutory', 'Statutory Owner',
      'Team or user responsible for statutory registration and compliance controls.'),
    ownerSetting('access', 'Access Owner',
      'Team or user responsible for account and access readiness, including account-support routing.'),
  ],
  notes:
    'Owner values are stored as "<ownerType>:<ownerId>" with ownerType in {role,user}. '
    + 'An empty value, a deleted or inactive user, or a role whose holders lack the '
    + "control's required capability all resolve to `owner_required`, which the profile "
    + 'surfaces as **Owner Required** for an administrator to configure.',
};
