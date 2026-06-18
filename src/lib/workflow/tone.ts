/**
 * src/lib/workflow/tone.ts
 *
 * Maps engine statuses/priorities to the app's `.vt-pill` tone classes, so every
 * workflow surface renders status chips consistently. Pure, exhaustive.
 */

import type { WorkflowStatus, Priority } from './types';

/** Workflow/approval status → .vt-pill variant. */
export function statusPill(status: WorkflowStatus): string {
  switch (status) {
    case 'approved':
    case 'closed':    return 'vt-pill is-on';
    case 'pending':
    case 'in_review':
    case 'returned':  return 'vt-pill is-warn';
    case 'rejected':
    case 'blocked':   return 'vt-pill is-off';
    case 'draft':     return 'vt-pill is-info';
    default:          return 'vt-pill is-info';
  }
}

/** Priority → .vt-pill variant. */
export function priorityPill(p: Priority): string {
  switch (p) {
    case 'critical': return 'vt-pill is-off';
    case 'high':     return 'vt-pill is-warn';
    case 'normal':   return 'vt-pill is-info';
    case 'low':      return 'vt-pill is-on';
  }
}

/** Human label for a status. */
export function statusLabel(status: WorkflowStatus): string {
  return status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}
