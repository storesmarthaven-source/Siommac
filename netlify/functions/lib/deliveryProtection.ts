// ============================================================================
// Required delivery protection (Spec §21–§22)
// ============================================================================
// Employees may mute casual personal messages/notifications, but NOT workflow,
// safety, compliance, or emergency delivery — and cannot remove module-locked
// required thread participants. These guards are the enforcement layer.
// ============================================================================

export type NotificationCriticality =
  | 'normal' | 'important' | 'workflow_required' | 'safety_critical' | 'compliance_required' | 'emergency';

const UNSUPPRESSIBLE_NOTIFICATION = new Set<NotificationCriticality>([
  'workflow_required', 'safety_critical', 'compliance_required', 'emergency',
]);

/** True when a user is allowed to suppress (mute) a notification of this criticality. */
export function canSuppressNotification(criticality: NotificationCriticality): boolean {
  return !UNSUPPRESSIBLE_NOTIFICATION.has(criticality);
}

export interface NotificationDeliveryDescriptor {
  type: string;
  module?: string | null;
  severity?: string | null;
  actionRequired?: boolean;
  dueAt?: string | null;
  criticality?: NotificationCriticality;
}

/**
 * Resolve the protection class at the delivery boundary. Callers may provide an
 * explicit class; the fallback keeps older event producers safe while they are
 * migrated to the richer contract.
 */
export function resolveNotificationCriticality(
  notification: NotificationDeliveryDescriptor,
): NotificationCriticality {
  if (notification.criticality) return notification.criticality;

  const type = notification.type.toLowerCase();
  const module = notification.module?.toLowerCase() ?? '';
  const severity = notification.severity?.toLowerCase() ?? 'info';

  if (type.includes('emergency') || module === 'emergency') return 'emergency';
  if (
    type.includes('security') || type.includes('compliance') || type.startsWith('auth.') ||
    module === 'security' || module === 'access_control'
  ) return 'compliance_required';
  if (severity === 'critical' || severity === 'blocker') return 'safety_critical';
  if (notification.actionRequired && notification.dueAt) return 'workflow_required';
  if (severity === 'warning' || severity === 'high') return 'important';
  return 'normal';
}

export interface QuietModeDeliveryDecision {
  criticality: NotificationCriticality;
  /** A Notification Center row is mandatory while quiet, and for protected alerts. */
  forceNotificationCenter: boolean;
  suppressToast: boolean;
  suppressExternalChannels: boolean;
}

/**
 * Quiet Mode is a delivery policy, never a delete policy. Routine alerts remain
 * unread in Notification Center while their transient popup/external fan-out is
 * paused; protected workflow, safety, security and emergency alerts pass through.
 */
export function quietModeDeliveryDecision(
  notification: NotificationDeliveryDescriptor,
  quietModeActive: boolean,
): QuietModeDeliveryDecision {
  const criticality = resolveNotificationCriticality(notification);
  const protectedDelivery = !canSuppressNotification(criticality);
  const suppressRoutineDelivery = quietModeActive && !protectedDelivery;

  return {
    criticality,
    forceNotificationCenter: quietModeActive || protectedDelivery,
    suppressToast: suppressRoutineDelivery,
    suppressExternalChannels: suppressRoutineDelivery,
  };
}

export type MessageDeliveryClass =
  | 'personal' | 'module_context' | 'workflow_required' | 'safety_critical' | 'compliance_required' | 'admin_broadcast';

const UNSUPPRESSIBLE_MESSAGE = new Set<MessageDeliveryClass>([
  'workflow_required', 'safety_critical', 'compliance_required', 'admin_broadcast',
]);

/** True when a user is allowed to mute a message thread of this delivery class. */
export function canUserSuppressMessage(deliveryClass: MessageDeliveryClass): boolean {
  return !UNSUPPRESSIBLE_MESSAGE.has(deliveryClass);
}

export class DeliveryProtectionError extends Error {
  statusCode = 403;
  constructor(message: string) { super(message); this.name = 'DeliveryProtectionError'; }
}

export interface ParticipantGuardRow {
  is_required: boolean;
  can_be_removed_by_user: boolean;
}

/**
 * Spec §22 — guard a participant removal. `canRemoveRequired` is true when the
 * actor holds communications.participants.remove_required (or is superadmin),
 * which overrides both the required flag and a module lock.
 */
export function assertCanRemoveParticipant(params: { participant: ParticipantGuardRow; canRemoveRequired: boolean }): void {
  const { participant, canRemoveRequired } = params;
  if (canRemoveRequired) return;
  if (participant.is_required) {
    throw new DeliveryProtectionError('Required participants cannot be removed from this thread.');
  }
  if (!participant.can_be_removed_by_user) {
    throw new DeliveryProtectionError('This participant is locked by the source module.');
  }
}
