// lib/hr/onboardingPackages.ts — onboarding package templates (v36 §10.2/10.3).
//
// Each package is a fixed plan of tasks (by owning role) + cross-module handoffs.
// `moduleKey` flags tasks owned by another module (HSE/Training/Payroll) — those
// also drive the handoffs. Pure config; routes/hrOnboarding.ts instantiates it.

export interface OnboardingTaskTemplate { taskKey: string; taskTitle: string; ownerRole: string; moduleKey: string | null }
export interface OnboardingHandoffTemplate { targetModule: string; handoffType: string }
export interface OnboardingPackage { key: string; label: string; tasks: OnboardingTaskTemplate[]; handoffs: OnboardingHandoffTemplate[] }

const HR_TASKS: OnboardingTaskTemplate[] = [
  { taskKey: 'profile_confirmation', taskTitle: 'Confirm employee profile',     ownerRole: 'hr', moduleKey: null },
  { taskKey: 'document_collection',  taskTitle: 'Collect contract & documents', ownerRole: 'hr', moduleKey: null },
  { taskKey: 'emergency_contact',    taskTitle: 'Confirm emergency contact',    ownerRole: 'hr', moduleKey: null },
];
const SUPERVISOR_TASKS: OnboardingTaskTemplate[] = [
  { taskKey: 'welcome',               taskTitle: 'Welcome the new hire', ownerRole: 'supervisor', moduleKey: null },
  { taskKey: 'schedule_confirmation', taskTitle: 'Confirm schedule',     ownerRole: 'supervisor', moduleKey: null },
  { taskKey: 'first_week_checkin',    taskTitle: 'First-week check-in',  ownerRole: 'supervisor', moduleKey: null },
];
const IT_TASKS: OnboardingTaskTemplate[] = [
  { taskKey: 'account_invite',     taskTitle: 'Send account invite',    ownerRole: 'it', moduleKey: null },
  { taskKey: 'mfa_setup',          taskTitle: 'MFA / passkey setup',    ownerRole: 'it', moduleKey: null },
  { taskKey: 'application_access', taskTitle: 'Grant application access', ownerRole: 'it', moduleKey: null },
  { taskKey: 'equipment_request',  taskTitle: 'Equipment request',      ownerRole: 'it', moduleKey: null },
];
const HSE_TASKS: OnboardingTaskTemplate[] = [
  { taskKey: 'site_induction',   taskTitle: 'Site induction', ownerRole: 'hse', moduleKey: 'hse' },
  { taskKey: 'ppe_requirements', taskTitle: 'PPE requirements', ownerRole: 'hse', moduleKey: 'hse' },
  { taskKey: 'hse_briefing',     taskTitle: 'HSE briefing',   ownerRole: 'hse', moduleKey: 'hse' },
];
const TRAINING_TASKS: OnboardingTaskTemplate[] = [
  { taskKey: 'training_matrix',          taskTitle: 'Training matrix assignment', ownerRole: 'training', moduleKey: 'training' },
  { taskKey: 'competency_requirements',  taskTitle: 'Competency requirements',    ownerRole: 'training', moduleKey: 'training' },
];
const PAYROLL_TASKS: OnboardingTaskTemplate[] = [
  { taskKey: 'statutory_review',         taskTitle: 'Statutory readiness review', ownerRole: 'payroll', moduleKey: 'payroll' },
  { taskKey: 'pay_group_handoff',        taskTitle: 'Pay group handoff',          ownerRole: 'payroll', moduleKey: 'payroll' },
  { taskKey: 'payroll_gate',             taskTitle: 'Payroll gate',               ownerRole: 'payroll', moduleKey: 'payroll' },
];
const STD_HANDOFFS: OnboardingHandoffTemplate[] = [
  { targetModule: 'hse',      handoffType: 'onboarding_induction' },
  { targetModule: 'training', handoffType: 'onboarding_training' },
  { targetModule: 'payroll',  handoffType: 'onboarding_payroll' },
];

export const ONBOARDING_PACKAGES: Record<string, OnboardingPackage> = {
  standard_employee: {
    key: 'standard_employee', label: 'Standard Employee',
    tasks: [...HR_TASKS, ...SUPERVISOR_TASKS, ...IT_TASKS, ...HSE_TASKS, ...TRAINING_TASKS, ...PAYROLL_TASKS],
    handoffs: STD_HANDOFFS,
  },
  safety_critical_employee: {
    key: 'safety_critical_employee', label: 'Safety-Critical Employee',
    tasks: [
      ...HR_TASKS, ...SUPERVISOR_TASKS, ...IT_TASKS, ...HSE_TASKS,
      { taskKey: 'medical_clearance', taskTitle: 'Medical / fitness clearance', ownerRole: 'hse', moduleKey: 'hse' },
      ...TRAINING_TASKS,
      { taskKey: 'safety_competency', taskTitle: 'Safety-critical competency sign-off', ownerRole: 'training', moduleKey: 'training' },
      ...PAYROLL_TASKS,
    ],
    handoffs: STD_HANDOFFS,
  },
  contractor_worker: {
    key: 'contractor_worker', label: 'Contractor Worker',
    tasks: [
      { taskKey: 'profile_confirmation', taskTitle: 'Confirm contractor profile', ownerRole: 'hr', moduleKey: null },
      { taskKey: 'document_collection',  taskTitle: 'Collect contractor documents', ownerRole: 'hr', moduleKey: null },
      ...HSE_TASKS,
      { taskKey: 'contractor_readiness', taskTitle: 'Contractor HSE readiness', ownerRole: 'hse', moduleKey: 'hse' },
      { taskKey: 'application_access',    taskTitle: 'Grant limited access', ownerRole: 'it', moduleKey: null },
    ],
    handoffs: [{ targetModule: 'hse', handoffType: 'onboarding_contractor_readiness' }],
  },
  supervisor_manager: {
    key: 'supervisor_manager', label: 'Supervisor / Manager',
    tasks: [
      ...HR_TASKS, ...SUPERVISOR_TASKS, ...IT_TASKS,
      { taskKey: 'leadership_orientation', taskTitle: 'Leadership orientation', ownerRole: 'hr', moduleKey: null },
      ...HSE_TASKS, ...TRAINING_TASKS, ...PAYROLL_TASKS,
    ],
    handoffs: STD_HANDOFFS,
  },
  office_admin: {
    key: 'office_admin', label: 'Office / Admin',
    tasks: [
      ...HR_TASKS, ...SUPERVISOR_TASKS, ...IT_TASKS,
      { taskKey: 'office_induction', taskTitle: 'Office induction', ownerRole: 'hse', moduleKey: 'hse' },
      ...PAYROLL_TASKS,
    ],
    handoffs: [{ targetModule: 'payroll', handoffType: 'onboarding_payroll' }],
  },
};

export const ONBOARDING_PACKAGE_KEYS = Object.keys(ONBOARDING_PACKAGES);
