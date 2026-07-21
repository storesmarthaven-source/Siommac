/**
 * src/components/sections/Finance/payRunDetail/parts.tsx
 *
 * Small shared atoms + helpers for the full-page run workspace: F-02 policy /
 * calendar chips, the lifecycle-step derivation, a compact money formatter, and
 * initials — all scoped to the `.prw` page CSS.
 */

import { type VNode } from 'preact';
import { type PayrollRun } from '@api/finance/payroll';

// ── Formatting ──────────────────────────────────────────────────────────────────

/** Compact TTD for the metric tiles (e.g. 9,243,600 → "TTD 9.24M"). */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `TTD ${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `TTD ${(n / 1_000).toFixed(1)}K`;
  return `TTD ${n.toLocaleString('en-US')}`;
}

export function initials(name: string | null | undefined, fallback = '—'): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function monthLabel(periodMonth: string): string {
  // periodMonth is YYYY-MM-01; render "July 2026"
  const d = new Date(periodMonth);
  return Number.isNaN(d.getTime())
    ? periodMonth.slice(0, 7)
    : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function dayLabel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A friendly run title: pay group (or frequency) + period month. */
export function runTitle(run: PayrollRun): string {
  const group = run.payGroup ?? `${humanFreq(run.payFrequency)} (ad-hoc)`;
  return `${monthLabel(run.periodMonth)} · ${group}`;
}

function humanFreq(f: string): string {
  return f.replace(/_/g, '-').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Status pill tone (mockup .pill colour intents) ──────────────────────────────

export type PillIntent = 'green' | 'amber' | 'red' | 'grey' | 'blue';

export function statusIntent(status: string): PillIntent {
  switch (status) {
    case 'locked': case 'approved': case 'released': return 'green';
    case 'pending_approval': case 'calculated': case 'input_locked': return 'amber';
    case 'returned': case 'cancelled': case 'calculation_failed': return 'red';
    default: return 'grey';
  }
}

// ── Lifecycle stepper derivation ────────────────────────────────────────────────

export interface LifecycleStep { key: string; label: string; state: 'done' | 'cur' | 'pend' | 'fail'; }

const LIFECYCLE_ORDER = [
  { key: 'draft',            label: 'Draft' },
  { key: 'input_locked',     label: 'Inputs Locked' },
  { key: 'calculated',       label: 'Calculated' },
  { key: 'pending_approval', label: 'Approval' },
  { key: 'approved',         label: 'Approved' },
  { key: 'locked',           label: 'Locked' },
  { key: 'released',         label: 'Released' },
];

/** Map a run status onto the 7-step lifecycle (index + optional fail marker). */
export function lifecycleSteps(status: string): LifecycleStep[] {
  // where the run currently sits on the happy path
  const indexByStatus: Record<string, number> = {
    draft: 0, input_locked: 1, calculated: 2, calculation_failed: 2,
    pending_approval: 3, returned: 3, approved: 4, locked: 5, exported: 5, released: 6, cancelled: 0,
  };
  const failStatuses = new Set(['returned', 'calculation_failed', 'cancelled']);
  const cur = indexByStatus[status] ?? 0;
  const isFail = failStatuses.has(status);
  return LIFECYCLE_ORDER.map((s, i) => ({
    ...s,
    state: isFail && i === cur ? 'fail'
      : i < cur ? 'done'
      : i === cur ? 'cur'
      : 'pend',
  }));
}

// ── F-02 chips (UI-PPR-001) ─────────────────────────────────────────────────────

export function PolicyChip({ run }: { run: PayrollRun }): VNode | null {
  const pp = run.payPolicy;
  if (!pp) return null;
  return (
    <span class="evchip policy" title={pp.checksum ? `checksum ${pp.checksum}` : undefined}>
      <span class="k">Policy</span>
      <strong>{pp.policyName ?? 'Pinned policy'}</strong>
      {pp.versionNo != null && <span>v{pp.versionNo}</span>}
      {pp.checksum && <code>{pp.checksum.slice(0, 8)}</code>}
    </span>
  );
}

export function CalendarChip({ run }: { run: PayrollRun }): VNode | null {
  const cal = run.payPolicy?.calendar;
  if (!cal) return null;
  return (
    <span class="evchip calendar" title={cal.workCalendarChecksum ? `work-calendar ${cal.workCalendarChecksum}` : undefined}>
      <span class="k">Working days</span>
      <strong>{cal.periodDenominator ?? '—'} days</strong>
      {cal.scope && <span>{cal.scope.replace(/_/g, ' ')}</span>}
    </span>
  );
}
