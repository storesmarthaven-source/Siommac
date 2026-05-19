/**
 * src/components/shared/Badge.tsx
 *
 * Typed status pill.  All domain-specific status strings are mapped here
 * in one place so colour semantics stay consistent across every section.
 *
 * Usage:
 *   <Badge status="active" />
 *   <Badge status="pending" />
 *   <Badge status="late" label="Late check-in" />
 *   <Badge variant="success" label="Approved" />
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import type { VNode } from 'preact';

// ── Domain status types ───────────────────────────────────────────────────────

export type UserStatus        = 'active'   | 'inactive';
export type AttendanceStatus  = 'present'  | 'late'    | 'absent';
export type LeaveStatus       = 'pending'  | 'approved'| 'rejected';
export type PayrollStatus     = 'draft'    | 'pending' | 'approved' | 'paid';
export type SiteStatus        = 'active'   | 'inactive'| 'completed';
export type RealtimeStatus    = 'idle'     | 'connecting' | 'connected' | 'error';

export type DomainStatus =
  | UserStatus
  | AttendanceStatus
  | LeaveStatus
  | PayrollStatus
  | SiteStatus
  | RealtimeStatus;

// ── Visual variants ───────────────────────────────────────────────────────────

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'secondary' | 'primary';

// ── Status → variant mapping ──────────────────────────────────────────────────

const STATUS_VARIANT: Record<DomainStatus, BadgeVariant> = {
  // User
  active:      'success',
  inactive:    'secondary',
  // Attendance
  present:     'success',
  late:        'warning',
  absent:      'danger',
  // Leave
  pending:     'warning',
  approved:    'success',
  rejected:    'danger',
  // Payroll
  draft:       'secondary',
  paid:        'success',
  // Site
  completed:   'info',
  // Realtime
  idle:        'secondary',
  connecting:  'warning',
  connected:   'success',
  error:       'danger',
};

// Status → default display label (title-cased)
const STATUS_LABEL: Record<DomainStatus, string> = {
  active:     'Active',
  inactive:   'Inactive',
  present:    'Present',
  late:       'Late',
  absent:     'Absent',
  pending:    'Pending',
  approved:   'Approved',
  rejected:   'Rejected',
  draft:      'Draft',
  paid:       'Paid',
  completed:  'Completed',
  idle:       'Idle',
  connecting: 'Connecting',
  connected:  'Connected',
  error:      'Error',
};

// ── Variant → CSS colours ─────────────────────────────────────────────────────

const VARIANT_STYLE: Record<BadgeVariant, { background: string; color: string }> = {
  success:   { background: '#d1fae5', color: '#065f46' },
  warning:   { background: '#fef3c7', color: '#92400e' },
  danger:    { background: '#fee2e2', color: '#991b1b' },
  info:      { background: '#dbeafe', color: '#1e40af' },
  secondary: { background: '#f3f4f6', color: '#374151' },
  primary:   { background: '#e0f2fe', color: '#0369a1' },
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface BadgeProps {
  /** Domain status string — auto-maps to variant + label */
  status?:   DomainStatus;
  /** Explicit variant (overrides status-derived variant) */
  variant?:  BadgeVariant;
  /** Explicit label (overrides status-derived label) */
  label?:    string;
  /** Show a small dot indicator before the label */
  dot?:      boolean;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Badge({
  status,
  variant:  variantProp,
  label:    labelProp,
  dot       = false,
  className = '',
}: BadgeProps): VNode {
  const variant = variantProp ?? (status ? STATUS_VARIANT[status] : 'secondary');
  const label   = labelProp   ?? (status ? STATUS_LABEL[status]   : '');
  const style   = VARIANT_STYLE[variant];

  return (
    <span
      class={`siomac-badge siomac-badge--${variant} ${className}`}
      style={{
        display:       'inline-flex',
        alignItems:    'center',
        gap:           '5px',
        padding:       '3px 10px',
        borderRadius:  '999px',
        fontSize:      '12px',
        fontWeight:    '600',
        letterSpacing: '0.02em',
        whiteSpace:    'nowrap',
        lineHeight:    '1.4',
        background:    style.background,
        color:         style.color,
      }}
    >
      {dot && (
        <span
          aria-hidden="true"
          style={{
            width:        '6px',
            height:       '6px',
            borderRadius: '50%',
            background:   style.color,
            flexShrink:   0,
          }}
        />
      )}
      {label}
    </span>
  );
}
