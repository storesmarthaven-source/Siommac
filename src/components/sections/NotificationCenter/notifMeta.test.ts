import { describe, expect, it } from 'vitest';
import { type CanonicalNotification } from '@api/communications';
import { notificationIconVariant } from './notifMeta';

function notification(overrides: Partial<CanonicalNotification>): CanonicalNotification {
  return {
    id: 'n-1', type: 'general.notice', module: 'general', severity: 'info',
    title: 'Notification', body: null, source_type: null, source_id: null,
    action_route: null, metadata: {}, is_read: false, action_required: false,
    action_status: 'none', due_at: null, created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('notificationIconVariant', () => {
  it.each([
    ['communications.broadcast', 'info', 'announcement'],
    ['workflow.approval_required', 'info', 'approval'],
    ['hr.onboarding.task_assigned', 'info', 'assignment'],
    ['calendar.event.reminder', 'info', 'reminder'],
    ['hse.investigation.evidence_attached', 'info', 'document'],
    ['finance.payroll.finding.comment', 'info', 'message'],
    ['finance.expense.submitted', 'info', 'finance'],
    ['workflow.handoff.created', 'info', 'workflow'],
    ['general.notice', 'warning', 'warning'],
    ['general.notice', 'critical', 'critical'],
    ['finance.expense.approved', 'success', 'success'],
  ] as const)('maps %s (%s) to %s', (type, severity, expected) => {
    expect(notificationIconVariant(notification({ type, severity }))).toBe(expected);
  });
});
