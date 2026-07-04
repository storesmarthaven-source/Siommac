/**
 * src/components/common/actions/actionModalAdapters.ts
 *
 * Small helpers that build an ActionRecord (the "affected record" shown in the
 * ActionModal) from domain objects, so call sites stay terse and consistent.
 */

import type { ActionRecord, ActionRecordField, ActionRecordBadge } from './actionModalTypes';

/** Generic builder — drops null/undefined fields so the record stays clean. */
export function toActionRecord(args: {
  title: string;
  subtitle?: string;
  icon?: string;
  badges?: ActionRecordBadge[];
  fields?: Array<ActionRecordField | null | undefined | false>;
}): ActionRecord {
  return {
    title: args.title,
    subtitle: args.subtitle,
    icon: args.icon,
    badges: args.badges,
    fields: (args.fields ?? []).filter(Boolean) as ActionRecordField[],
  };
}

/** Map a lifecycle status string to a badge tone (green active/approved, amber pending, red rejected). */
export function statusBadge(status: string): ActionRecordBadge {
  const s = status.toLowerCase();
  const tone =
    ['active', 'approved', 'verified', 'locked', 'paid', 'published'].includes(s) ? 'success'
    : ['pending_approval', 'pending_verification', 'submitted', 'in_review', 'calculated'].includes(s) ? 'warning'
    : ['rejected', 'cancelled', 'retired', 'archived'].includes(s) ? 'danger'
    : 'default';
  return { label: status.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), tone };
}
