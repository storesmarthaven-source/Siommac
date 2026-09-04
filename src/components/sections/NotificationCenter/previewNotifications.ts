import { type CanonicalNotification } from '@api/communications';
import jordanAvatar from '../../../assets/avatars/roster-planner/jordan-peters.jpg';
import aliciaAvatar from '../../../assets/avatars/roster-planner/alicia-moore.jpg';
import marcusAvatar from '../../../assets/avatars/roster-planner/marcus-allen.jpg';
import sofiaAvatar from '../../../assets/avatars/roster-planner/sofia-reyes.jpg';

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Local presentation catalog for demonstrating every supported notification
 * treatment. These records never enter Supabase and can never be confused with
 * live user notifications because every id is namespaced with `preview-`.
 */
export function createPreviewNotifications(): CanonicalNotification[] {
  return [
    {
      id: 'preview-critical-approval',
      type: 'hse.permit.approval_required',
      module: 'hse.ptw',
      severity: 'critical',
      title: 'Hot Work Permit Requires Approval',
      body: 'A permit for the North Process Area is waiting for your decision before the crew can begin work.',
      source_type: 'permit_to_work',
      source_id: 'PTW-2026-0842',
      action_route: 's-hse-ptw',
      metadata: { siteName: 'Pelican Platform', actorName: 'Jordan Peters', actorPhotoUrl: jordanAvatar },
      is_read: false,
      action_required: true,
      action_status: 'pending',
      due_at: minutesFromNow(35),
      created_at: minutesAgo(3),
    },
    {
      id: 'preview-file-evidence',
      type: 'hse.investigation.evidence_attached',
      module: 'hse.investigations',
      severity: 'info',
      title: 'New Investigation Evidence Added',
      body: 'Maria attached supporting evidence to the dropped-object investigation.',
      source_type: 'hse_investigation',
      source_id: 'INV-2026-0148',
      action_route: 's-hse-investigations',
      metadata: {
        projectName: 'North Deck Upgrade', actorName: 'Sofia Reyes', actorPhotoUrl: sofiaAvatar,
        fileName: 'Incident-evidence-photo.jpg', fileSize: 2_840_576,
      },
      is_read: false,
      action_required: false,
      action_status: 'none',
      due_at: null,
      created_at: minutesAgo(18),
    },
    {
      id: 'preview-broadcast',
      type: 'communications.broadcast',
      module: 'communications',
      severity: 'warning',
      title: 'Weather Stand-Down at Coastal Sites',
      body: 'Outdoor lifting operations are paused until the 2:00 PM weather review. Supervisors should secure open work fronts.',
      source_type: 'broadcast',
      source_id: 'BRD-2026-0027',
      action_route: 's-notification-center',
      metadata: { siteName: 'All Coastal Sites' },
      is_read: false,
      action_required: false,
      action_status: 'none',
      due_at: null,
      created_at: minutesAgo(41),
    },
    {
      id: 'preview-assignment',
      type: 'hr.onboarding.task_assigned',
      module: 'hr',
      severity: 'info',
      title: 'Onboarding Task Assigned to You',
      body: 'Complete the employment-document review for the incoming Mechanical Technician.',
      source_type: 'onboarding_case',
      source_id: 'ONB-2026-0319',
      action_route: 's-hr-onboarding',
      metadata: { caseNo: 'ONB-2026-0319', actorName: 'Alicia Moore', actorPhotoUrl: aliciaAvatar },
      is_read: false,
      action_required: true,
      action_status: 'pending',
      due_at: minutesFromNow(1_440),
      created_at: minutesAgo(67),
    },
    {
      id: 'preview-payroll-comment',
      type: 'finance.payroll.finding.comment',
      module: 'finance_payroll',
      severity: 'info',
      title: 'New Note on Payroll Control Finding',
      body: 'Marcus added: “The overtime variance is supported by the approved shutdown roster.”',
      source_type: 'payroll_control_finding',
      source_id: 'PAY-FND-0094',
      action_route: 's-finance-payroll',
      metadata: { runNo: 'PAY-2026-18', actorName: 'Marcus Allen', actorPhotoUrl: marcusAvatar },
      is_read: true,
      action_required: false,
      action_status: 'none',
      due_at: null,
      created_at: minutesAgo(132),
    },
    {
      id: 'preview-calendar',
      type: 'calendar.event.reminder',
      module: 'calendar',
      severity: 'info',
      title: 'Shift Handover Starts in 15 Minutes',
      body: 'Operations handover for Pelican Platform begins at 6:00 PM.',
      source_type: 'calendar_entry',
      source_id: 'CAL-2026-4021',
      action_route: 's-calendar',
      metadata: { siteName: 'Pelican Platform' },
      is_read: true,
      action_required: false,
      action_status: 'none',
      due_at: minutesFromNow(15),
      created_at: minutesAgo(145),
    },
    {
      id: 'preview-success',
      type: 'finance.expense.approved',
      module: 'finance',
      severity: 'success',
      title: 'Expense Claim Approved',
      body: 'Your travel expense claim was approved and is ready for reimbursement processing.',
      source_type: 'expense_claim',
      source_id: 'EXP-2026-1187',
      action_route: 's-finance-expenses',
      metadata: { claimNo: 'EXP-2026-1187' },
      is_read: true,
      action_required: false,
      action_status: 'completed',
      due_at: null,
      created_at: minutesAgo(1_540),
    },
    {
      id: 'preview-document',
      type: 'finance.payroll.payslip.ready',
      module: 'finance_payroll',
      severity: 'success',
      title: 'Payslip Ready',
      body: 'Your latest payslip is available to review.',
      source_type: 'payroll_run',
      source_id: 'PAY-2026-18',
      action_route: 's-my-payslips',
      metadata: { payslipNo: 'PS-2026-00418', fileName: 'Payslip-August-2026.pdf', fileSize: 184_320 },
      is_read: true,
      action_required: false,
      action_status: 'none',
      due_at: null,
      created_at: minutesAgo(1_680),
    },
    {
      id: 'preview-archived',
      type: 'workflow.approval.completed',
      module: 'workflow',
      severity: 'success',
      title: 'Purchase Request Completed',
      body: 'The approval workflow was completed and the purchase request moved to procurement.',
      source_type: 'workflow_instance',
      source_id: 'WF-2026-0761',
      action_route: 's-workflows',
      metadata: { entityName: 'Emergency Pump Spares' },
      is_read: true,
      action_required: false,
      action_status: 'dismissed',
      due_at: null,
      created_at: minutesAgo(3_200),
    },
  ];
}

export interface PreviewNotificationCounts {
  total: number;
  unread: number;
  actionRequired: number;
  archived: number;
}

export function isArchivedNotification(notification: CanonicalNotification): boolean {
  return notification.action_status === 'dismissed' || notification.action_status === 'expired';
}

export function countPreviewNotifications(rows: readonly CanonicalNotification[]): PreviewNotificationCounts {
  return rows.reduce<PreviewNotificationCounts>((counts, notification) => {
    if (isArchivedNotification(notification)) {
      counts.archived += 1;
      return counts;
    }
    counts.total += 1;
    if (!notification.is_read) counts.unread += 1;
    if (notification.action_required && notification.action_status === 'pending') counts.actionRequired += 1;
    return counts;
  }, { total: 0, unread: 0, actionRequired: 0, archived: 0 });
}

export function markPreviewNotificationRead(
  rows: readonly CanonicalNotification[], notificationId: string,
): CanonicalNotification[] {
  return rows.map(notification => notification.id === notificationId
    ? { ...notification, is_read: true }
    : notification);
}

export function markAllPreviewNotificationsRead(rows: readonly CanonicalNotification[]): CanonicalNotification[] {
  return rows.map(notification => isArchivedNotification(notification) || notification.is_read
    ? notification
    : { ...notification, is_read: true });
}

export function archivePreviewNotification(
  rows: readonly CanonicalNotification[], notificationId: string,
): CanonicalNotification[] {
  return rows.map(notification => notification.id === notificationId
    ? { ...notification, is_read: true, action_status: 'dismissed' }
    : notification);
}

export function archiveAllReadPreviewNotifications(
  rows: readonly CanonicalNotification[],
): CanonicalNotification[] {
  return rows.map(notification => !isArchivedNotification(notification) && notification.is_read
    ? { ...notification, action_status: 'dismissed' }
    : notification);
}
