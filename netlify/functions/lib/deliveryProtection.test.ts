import { describe, expect, it } from 'vitest';
import {
  quietModeDeliveryDecision,
  resolveNotificationCriticality,
} from './deliveryProtection';

describe('notification Quiet Mode delivery protection', () => {
  it('keeps routine alerts in Notification Center while suppressing transient delivery', () => {
    expect(quietModeDeliveryDecision({ type: 'calendar.reminder.due', severity: 'info' }, true)).toEqual({
      criticality: 'normal',
      forceNotificationCenter: true,
      suppressToast: true,
      suppressExternalChannels: true,
    });
  });

  it.each([
    [{ type: 'hse.incident.critical', severity: 'critical' }, 'safety_critical'],
    [{ type: 'security.session.compromised', severity: 'warning' }, 'compliance_required'],
    [{ type: 'workflow.approval.due', actionRequired: true, dueAt: '2026-09-04T12:00:00.000Z' }, 'workflow_required'],
    [{ type: 'operations.emergency', severity: 'info' }, 'emergency'],
  ] as const)('lets protected %s alerts through Quiet Mode', (notification, criticality) => {
    expect(resolveNotificationCriticality(notification)).toBe(criticality);
    expect(quietModeDeliveryDecision(notification, true)).toEqual({
      criticality,
      forceNotificationCenter: true,
      suppressToast: false,
      suppressExternalChannels: false,
    });
  });

  it('does not alter routine delivery while Quiet Mode is inactive', () => {
    expect(quietModeDeliveryDecision({ type: 'project.updated' }, false)).toEqual({
      criticality: 'normal',
      forceNotificationCenter: false,
      suppressToast: false,
      suppressExternalChannels: false,
    });
  });
});
