/**
 * src/components/sections/Attendance/StatCards.tsx
 *
 * Four summary stat cards for the Attendance section.
 *
 * Uses the branded `.stat-card*` design system (navy values, coloured icon
 * chips) defined in views.css rather than ad-hoc inline styles.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode } from 'preact';
import type { AttendanceStats } from './types';

// ── Props ─────────────────────────────────────────────────────────────────────

interface AttendanceStatCardsProps {
  stats:       AttendanceStats | null;
  loading:     boolean;
  isSingleDay?: boolean;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard(): VNode {
  return (
    <div class="stat-card">
      <div class="stat-card-icon" />
      <div class="stat-card-body">
        <div class="stat-card-value" />
        <div class="stat-card-label" />
      </div>
    </div>
  );
}

// ── Single card ───────────────────────────────────────────────────────────────

/** Branded icon-chip colour variants. */
type StatColor = 'green' | 'gold' | 'red' | 'blue';

interface StatCardProps {
  label:    string;
  value:    string | number;
  icon:     string;
  color:    StatColor;
}

function StatCard({ label, value, icon, color }: StatCardProps): VNode {
  return (
    <div class="stat-card">
      <div class={`stat-card-icon ${color}`}>
        <i class={`fas ${icon}`} aria-hidden="true" />
      </div>
      <div class="stat-card-body">
        <div class="stat-card-value">{value}</div>
        <div class="stat-card-label">{label}</div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AttendanceStatCards({
  stats,
  loading,
  isSingleDay = false,
}: AttendanceStatCardsProps): VNode {
  if (loading) {
    return (
      <div class="dashboard-grid-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div class="dashboard-grid-4">
      <StatCard
        label={isSingleDay ? 'Present Today' : 'Check-ins'}
        value={stats?.present ?? 0}
        icon="fa-user-check"
        color="green"
      />
      <StatCard
        label="Late Arrivals"
        value={stats?.late ?? 0}
        icon="fa-clock"
        color="gold"
      />
      <StatCard
        label="Absent / Leave"
        value={stats?.absent ?? 0}
        icon="fa-user-slash"
        color="red"
      />
      <StatCard
        label={isSingleDay ? 'Attendance Rate' : 'Avg Daily Rate'}
        value={`${stats?.rate ?? 0}%`}
        icon="fa-chart-line"
        color="blue"
      />
    </div>
  );
}
