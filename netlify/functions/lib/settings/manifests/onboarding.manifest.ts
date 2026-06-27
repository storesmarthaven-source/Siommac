// HR Onboarding — settings manifest (spec §13 + Phase 6 provisioning).
//
// moduleKey 'hr_onboarding' (matches the module key used in app_events / workflow
// context). All entries reuse the existing 'hr.settings.manage' permission (no new
// settings permission). Catalog keys are a registry — consumers are wired
// incrementally: the `enabled` master switch is wired in onboardingCore (safe at its
// default). case_no_prefix (needs nextRef to accept a configurable RefPrefix),
// activation gates, evidence, and require-owner are Phase 7b — they change start /
// ready / complete behaviour and need E2E updates. Default package lives in employees.manifest
// (`employees.onboarding_default_package`) — not duplicated here.

import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, workflowRule, notificationRule, auditPolicy } from '../catalogHelpers';

const M = 'hr_onboarding';
const MANAGE = 'hr.settings.manage';

export const onboardingManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'HR Onboarding',
  hasSettings: true,
  moduleCategory: 'hr',
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'module_owner'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'numbering', applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'workflow', applies: true },
    { sectionKey: 'automation', applies: true },
    { sectionKey: 'escalation', applies: true },
    { sectionKey: 'notifications', applies: true },
    { sectionKey: 'audit_retention', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    // ── General ──────────────────────────────────────────────────────────────────
    modulePolicy(M, 'hr_onboarding.enabled', {
      label: 'Onboarding Enabled', description: 'Master switch for the onboarding module (starting new cases).',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Numbering ────────────────────────────────────────────────────────────────
    modulePolicy(M, 'hr_onboarding.case_no_prefix', {
      label: 'Case Number Prefix', description: 'Prefix for generated onboarding case numbers (e.g. ONB-0001).',
      dataType: 'string', defaultValue: 'ONB', scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Validation / start rules ─────────────────────────────────────────────────
    modulePolicy(M, 'hr_onboarding.require_owner_on_start', {
      label: 'Require Case Owner on Start', description: 'Require an explicit case owner when starting onboarding.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_onboarding.allow_draft_cases', {
      label: 'Allow Draft Cases', description: 'Allow saving an onboarding case as a draft before starting it.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_onboarding.task_completion_requires_evidence', {
      label: 'Task Completion Requires Evidence', description: 'Require an evidence attachment to complete tasks flagged as evidence-required.',
      dataType: 'boolean', defaultValue: false, scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Workflow / automation ────────────────────────────────────────────────────
    workflowRule(M, 'hr_onboarding.auto_start_after_employee_create', {
      label: 'Auto-Start After Employee Create', description: 'Automatically start an onboarding case when a new employee is created.',
      dataType: 'boolean', defaultValue: false, scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_onboarding.allow_blocker_waiver', {
      label: 'Allow Blocker Waiver', description: 'Allow authorized users to waive an onboarding blocker (with a reason).',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),
    workflowRule(M, 'hr_onboarding.blocker_waiver_requires_workflow', {
      label: 'Blocker Waiver Requires Workflow', description: 'Route a blocker waiver through a workflow approval before it takes effect.',
      dataType: 'boolean', defaultValue: false, scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Escalation ───────────────────────────────────────────────────────────────
    workflowRule(M, 'hr_onboarding.escalate_overdue_blocking_tasks', {
      label: 'Escalate Overdue Blocking Tasks', description: 'Escalate blocking tasks that pass their due date.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Activation gates (critical governance) — wired in Phase 7b ────────────────
    modulePolicy(M, 'hr_onboarding.block_activation_until_documents_complete', {
      label: 'Gate: Documents Complete', description: 'Block activation/ready until document tasks are complete.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_onboarding.block_activation_until_training_complete', {
      label: 'Gate: Training Complete', description: 'Block activation/ready until training tasks are complete.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_onboarding.block_activation_until_hse_complete', {
      label: 'Gate: HSE Complete', description: 'Block activation/ready until HSE tasks are complete.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_onboarding.block_activation_until_payroll_complete', {
      label: 'Gate: Payroll Complete', description: 'Block activation/ready until payroll-readiness tasks are complete.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Notifications (defaults the Start wizard pre-selects) ─────────────────────
    notificationRule(M, 'hr_onboarding.send_employee_welcome_email_default', {
      label: 'Send Welcome Email (default)', description: 'Default for "send employee welcome email" when starting a case.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),
    notificationRule(M, 'hr_onboarding.notify_supervisor_default', {
      label: 'Notify Supervisor (default)', description: 'Default for "notify supervisor & HR owner" when starting a case.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Account / work-email provisioning (Phase 6 defaults) ─────────────────────
    modulePolicy(M, 'hr_onboarding.work_email_domain', {
      label: 'Work Email Domain', description: 'Domain used to generate work email addresses (e.g. acme.com). Blank disables auto-generation.',
      dataType: 'string', defaultValue: '', scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_onboarding.work_email_pattern', {
      label: 'Work Email Naming Pattern', description: 'How the local part is built from the name.',
      dataType: 'select', defaultValue: 'first.last', allowedValues: ['first.last', 'flast', 'first'], scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_onboarding.account_default_credential_method', {
      label: 'Default Credential Method', description: 'How a new hire first signs in. MFA requirement is governed by the security policy.',
      dataType: 'select', defaultValue: 'invite_link', allowedValues: ['invite_link', 'temp_password', 'passkey'], scope: ['global'], requiresPermission: MANAGE,
    }),
    workflowRule(M, 'hr_onboarding.auto_provision_account_on_start', {
      label: 'Auto-Provision Account on Start', description: 'Create the login account + send the invite automatically when a case starts.',
      dataType: 'boolean', defaultValue: false, scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Audit / retention ────────────────────────────────────────────────────────
    auditPolicy(M, 'hr_onboarding.retention_years', {
      label: 'Onboarding Retention (years)', description: 'How long completed/cancelled onboarding records are retained.',
      dataType: 'number', defaultValue: 7, minValue: 1, maxValue: 25, scope: ['global'], requiresPermission: MANAGE,
    }),
  ],
};
