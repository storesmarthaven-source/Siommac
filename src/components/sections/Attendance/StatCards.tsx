/**
 * src/components/sections/Attendance/StatCards.tsx
 *
 * Four summary stat cards for the Attendance section.
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
    <div
      style={{
        flex:            '1',
        minWidth:        '160px',
        background:      '#fff',
        borderRadius:    '12px',
        boxShadow:       '0 1px 4px rgba(0,0,0,0.08)',
        padding:         '20px',
        display:         'flex',
        flexDirection:   'column',
        gap:             '10px',
      }}
    >
      <style>{`
        @keyframes siomac-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        .siomac-skel { animation: siomac-pulse 1.4s ease-in-out infinite; background: #e5e7eb; border-radius: 6px; }
      `}</style>
      <div class="siomac-skel" style={{ height: '16px', width: '60%' }} />
      <div class="siomac-skel" style={{ height: '32px', width: '40%' }} />
      <div class="siomac-skel" style={{ height: '12px', width: '50%' }} />
    </div>
  );
}

// ── Single card ───────────────────────────────────────────────────────────────

interface StatCardProps {
  label:     string;
  value:     string | number;
  icon:      string;
  accentColor: string;
  subtitle?: string;
}

function StatCard({ label, value, icon, accentColor, subtitle }: StatCardProps): VNode {
  return (
    <div
      style={{
        flex:          '1',
        minWidth:      '160px',
        background:    '#fff',
        borderRadius:  '12px',
        boxShadow:     '0 1px 4px rgba(0,0,0,0.08)',
        padding:       '20px',
        display:       'flex',
        flexDirection: 'column',
        gap:           '8px',
      }}
    >
      {/* Icon + label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            width:          '32px',
            height:         '32px',
            borderRadius:   '8px',
            background:     `${accentColor}18`,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            flexShrink:     0,
          }}
        >
          <i
            class={`fas ${icon}`}
            aria-hidden="true"
            style={{ color: accentColor, fontSize: '14px' }}
          />
        </div>
        <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: '500' }}>{label}</span>
      </div>

      {/* Value */}
      <div style={{ fontSize: '28px', fontWeight: '700', color: '#111827', lineHeight: '1' }}>
        {value}
      </div>

      {/* Optional subtitle */}
      {subtitle !== undefined && (
        <div style={{ fontSize: '12px', color: '#9ca3af' }}>{subtitle}</div>
      )}
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
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
      <StatCard
        label={isSingleDay ? 'Present Today' : 'Check-ins'}
        value={stats?.present ?? 0}
        icon="fa-user-check"
        accentColor="#2E7D32"
      />
      <StatCard
        label="Late Arrivals"
        value={stats?.late ?? 0}
        icon="fa-clock"
        accentColor="#D97706"
      />
      <StatCard
        label="Absent / Leave"
        value={stats?.absent ?? 0}
        icon="fa-user-slash"
        accentColor="#DC2626"
      />
      <StatCard
        label={isSingleDay ? 'Attendance Rate' : 'Avg Daily Rate'}
        value={`${stats?.rate ?? 0}%`}
        icon="fa-chart-line"
        accentColor="#2563EB"
      />
    </div>
  );
}
