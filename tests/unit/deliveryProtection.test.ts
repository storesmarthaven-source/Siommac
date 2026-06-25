/**
 * tests/unit/deliveryProtection.test.ts
 * Required delivery protection guards (Spec §21–§22) — pure, no DB.
 */
import {
  canSuppressNotification, canUserSuppressMessage,
  assertCanRemoveParticipant, DeliveryProtectionError,
} from '../../netlify/functions/lib/deliveryProtection';

describe('notification suppression (§21)', () => {
  it('allows muting casual notifications', () => {
    expect(canSuppressNotification('normal')).toBe(true);
    expect(canSuppressNotification('important')).toBe(true);
  });
  it('forbids muting required/critical notifications', () => {
    for (const c of ['workflow_required', 'safety_critical', 'compliance_required', 'emergency'] as const) {
      expect(canSuppressNotification(c)).toBe(false);
    }
  });
});

describe('message suppression (§21)', () => {
  it('allows muting personal / module-context threads', () => {
    expect(canUserSuppressMessage('personal')).toBe(true);
    expect(canUserSuppressMessage('module_context')).toBe(true);
  });
  it('forbids muting required/critical/broadcast threads', () => {
    for (const d of ['workflow_required', 'safety_critical', 'compliance_required', 'admin_broadcast'] as const) {
      expect(canUserSuppressMessage(d)).toBe(false);
    }
  });
});

describe('assertCanRemoveParticipant (§22)', () => {
  it('blocks removing a required participant without the override', () => {
    expect(() => assertCanRemoveParticipant({ participant: { is_required: true, can_be_removed_by_user: true }, canRemoveRequired: false }))
      .toThrow(DeliveryProtectionError);
  });
  it('blocks removing a module-locked participant without the override', () => {
    expect(() => assertCanRemoveParticipant({ participant: { is_required: false, can_be_removed_by_user: false }, canRemoveRequired: false }))
      .toThrow(DeliveryProtectionError);
  });
  it('allows removing a normal participant', () => {
    expect(() => assertCanRemoveParticipant({ participant: { is_required: false, can_be_removed_by_user: true }, canRemoveRequired: false }))
      .not.toThrow();
  });
  it('allows the override to remove a required / locked participant', () => {
    expect(() => assertCanRemoveParticipant({ participant: { is_required: true, can_be_removed_by_user: false }, canRemoveRequired: true }))
      .not.toThrow();
  });
});
