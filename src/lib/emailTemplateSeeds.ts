/**
 * lib/emailTemplateSeeds.ts — the canonical catalogue of starter email templates.
 *
 * ⭐ Extracted from the Studio's development adapter so this list has exactly ONE definition. The
 * dev adapter renders these for the browser; the seeding tool publishes the same 13 into the
 * server-side store. A second copy would drift the moment anyone edited a subject line, and the
 * two surfaces would then disagree about what a template IS.
 *
 * Pure data plus types — no DOM, no preact — which is what makes it safe on the server too.
 *
 * Tuple order: key, name, family, triggerKey, triggerLabel, audience, purpose, subject, preheader.
 */
import type { EmailTemplateDraft } from '../../types/emailTemplates';

export type EmailTemplateSeed = readonly [
  key: string,
  name: string,
  family: EmailTemplateDraft['family'],
  triggerKey: string,
  triggerLabel: string,
  audience: string,
  purpose: string,
  subject: string,
  preheader: string,
];

export const EMAIL_TEMPLATE_SEEDS: readonly EmailTemplateSeed[] = [
  ['employee-welcome', 'Employee Welcome', 'onboarding', 'onboarding.case_created', 'Case created', 'New employee',
    'Introduces the onboarding workspace and key contacts.',
    'Welcome to SIOMAC, {{recipient.firstName}}', 'Your onboarding workspace and key contacts are ready.'],
  ['complete-onboarding-tasks', 'Complete Your Onboarding Tasks', 'onboarding', 'onboarding.tasks_pending', 'Tasks pending', 'New employee',
    'Groups pending onboarding work into one focused reminder.',
    'You have onboarding tasks waiting', 'Finish the remaining steps to stay on track for day one.'],
  ['missing-documents-reminder', 'Missing Documents Reminder', 'onboarding', 'onboarding.documents_missing', 'Documents missing', 'New employee',
    'Requests outstanding documents without exposing confidential details.',
    'Action needed: documents still outstanding', 'Upload the remaining items securely from your portal.'],
  ['day-one-instructions', 'Day-One Instructions', 'onboarding', 'onboarding.start_approaching', 'Start approaching', 'New employee',
    'Provides practical arrival details before the employee’s start date.',
    'Your first day at SIOMAC — what to expect', 'Arrival time, worksite, and who to ask for.'],
  ['onboarding-completed', 'Onboarding Completed', 'onboarding', 'onboarding.completed', 'Case completed', 'Employee & manager',
    'Confirms completion and transitions the employee to their permanent record.',
    'Onboarding complete — welcome aboard', 'Your employee record is now active.'],
  ['account-invitation', 'Account Invitation', 'user_invitation', 'identity.invitation_created', 'Invitation created', 'Invited user',
    'Delivers the secure, time-limited link used to create portal access.',
    'Your SIOMAC account invitation', 'Create your secure access — this link is time-limited.'],
  ['invitation-reminder', 'Invitation Reminder', 'user_invitation', 'identity.invitation_reminder', 'Reminder scheduled', 'Invited user',
    'Reminds a user who has not completed account activation.',
    'Reminder: your SIOMAC invitation is waiting', 'Activate your account before the link expires.'],
  ['invitation-expiring', 'Invitation Expiring Soon', 'user_invitation', 'identity.invitation_expiring', 'Expiry approaching', 'Invited user',
    'Warns that the secure account invitation will expire soon.',
    'Your SIOMAC invitation expires soon', 'Complete registration to keep your access.'],
  ['invitation-reissued', 'Invitation Reissued', 'user_invitation', 'identity.invitation_reissued', 'Invitation reissued', 'Invited user',
    'Explains that an earlier invitation was replaced by a new secure link.',
    'A new secure invitation link for SIOMAC', 'Your previous link was replaced — use this one instead.'],
  ['worker-registration', 'Worker Registration Invitation', 'worker_invitation', 'worker.invitation_created', 'Worker invited', 'External worker',
    'Starts the governed registration journey for an external worker.',
    'Complete your worker registration', 'Start your secure registration for site assignment.'],
  ['site-assignment', 'Site Assignment Invitation', 'worker_invitation', 'worker.site_assigned', 'Site assigned', 'External worker',
    'Shares the worker’s site, reporting contact, and assignment timing.',
    'Your site assignment details', 'Location, reporting contact, and start timing.'],
  ['worker-compliance', 'Worker Compliance Requirements', 'worker_invitation', 'worker.documents_required', 'Requirements assigned', 'External worker',
    'Presents the documents and safety requirements needed for assignment.',
    'Compliance requirements for your assignment', 'Documents and safety items still needed.'],
  ['worker-reminder', 'Worker Invitation Reminder', 'worker_invitation', 'worker.invitation_reminder', 'Reminder scheduled', 'External worker',
    'Reminds a worker to finish an incomplete registration journey.',
    'Finish your worker registration', 'A few steps remain before you can be assigned.'],
];
