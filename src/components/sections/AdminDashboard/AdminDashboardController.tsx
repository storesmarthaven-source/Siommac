/**
 * src/components/sections/AdminDashboard/AdminDashboardController.tsx
 *
 * Stat cards + recent-attendance table for the admin dashboard.
 * Rendered as proper JSX — no DOM writes, no innerHTML.
 *
 * Exports two slot components consumed directly by AdminSections.tsx:
 *   <AdminStatCards />   — six KPI tiles inside .dash-stats-row
 *   <AdminRecentTable /> — tbody rows inside .recent-att-table
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { type VNode }       from 'preact';
import { useQuery }         from '@tanstack/preact-query';
import { useSessionStore }  from '@store/session';
import { getAdminStats, getRecentAttendance } from './api';
import type { AdminStats, RecentAttendanceRow } from '../Employees/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch (_) { return '—'; }
}

type StatusKey = string;

const STATUS_COLOR: Record<string, string> = {
  'present':     '#2E7D32',
  'late':        '#c67c00',
  'checked out': '#1B2D55',
};

function statusColor(status: StatusKey): string {
  return STATUS_COLOR[(status ?? '').toLowerCase()] ?? '#888';
}

// ── Stat card definitions ─────────────────────────────────────────────────────

const STAT_CARDS = [
  { icon: 'fa-users',          key: 'totalEmployees'  as keyof AdminStats, label: 'Employees',      color: 'blue'  },
  { icon: 'fa-map-marker-alt', key: 'activeLocations' as keyof AdminStats, label: 'Locations',      color: 'blue'  },
  { icon: 'fa-user-check',     key: 'presentToday'    as keyof AdminStats, label: 'Present Today',  color: 'green' },
  { icon: 'fa-user-times',     key: 'absentToday'     as keyof AdminStats, label: 'Absent Today',   color: 'red'   },
  { icon: 'fa-calendar-minus', key: 'onLeaveToday'    as keyof AdminStats, label: 'On Leave Today', color: 'gold'  },
  { icon: 'fa-clock',          key: 'lateToday'       as keyof AdminStats, label: 'Late Today',     color: 'gold'  },
] as const;

// ── AdminStatCards ────────────────────────────────────────────────────────────

/**
 * Renders the six KPI stat cards inside .dash-stats-row.
 * Slot directly into AdminDashboardSection in AdminSections.tsx.
 */
export function AdminStatCards(): VNode {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);

  const { data: stats, isLoading } = useQuery({
    queryKey:        ['dashboard', 'admin-stats'],
    queryFn:         ({ signal }) => getAdminStats(signal),
    staleTime:       60_000,
    refetchInterval: 5 * 60_000,
    enabled:         isAuthenticated,
  });

  return (
    <>
      {STAT_CARDS.map(card => (
        <div class="stat-card" key={card.key}>
          <div class={`stat-card-icon ${card.color}`}>
            <i class={`fas ${card.icon}`} />
          </div>
          <div class="stat-card-content">
            <div class="stat-card-value">
              {isLoading ? (
                <span style="display:inline-block;width:28px;height:20px;background:#e5e7eb;border-radius:4px;animation:pulse 1.4s ease-in-out infinite;" />
              ) : (
                stats?.[card.key] ?? 0
              )}
            </div>
            <div class="stat-card-label">{card.label}</div>
          </div>
        </div>
      ))}
    </>
  );
}

// ── AdminRecentTable ──────────────────────────────────────────────────────────

/**
 * Renders tbody rows for the recent attendance table.
 * Slot directly into the <tbody> in AdminSections.tsx.
 */
export function AdminRecentTable(): VNode {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);

  const { data: rows = [], isLoading } = useQuery({
    queryKey:        ['dashboard', 'recent-attendance'],
    queryFn:         ({ signal }) => getRecentAttendance(10, signal),
    staleTime:       60_000,
    refetchInterval: 2 * 60_000,
    enabled:         isAuthenticated,
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={5} class="text-center text-muted" style="padding:28px;">
          <span style="display:inline-block;width:120px;height:14px;background:#e5e7eb;border-radius:4px;animation:pulse 1.4s ease-in-out infinite;" />
        </td>
      </tr>
    );
  }

  if (!rows.length) {
    return (
      <tr>
        <td colSpan={5} class="text-center text-muted" style="padding:28px;">
          No attendance recorded today
        </td>
      </tr>
    );
  }

  return (
    <>
      {rows.map((r, i) => (
        <RecentRow key={i} row={r} />
      ))}
    </>
  );
}

// ── Row sub-component ─────────────────────────────────────────────────────────

function RecentRow({ row }: { row: RecentAttendanceRow }): VNode {
  const color = statusColor(row.status ?? '');
  return (
    <tr>
      <td style="font-weight:600;">{row.name ?? '—'}</td>
      <td>{row.department ?? '—'}</td>
      <td>{fmtTime(row.checkIn)}</td>
      <td>{fmtTime(row.checkOut)}</td>
      <td>
        <span style={{ color, fontWeight: '600' }}>{row.status ?? '—'}</span>
      </td>
    </tr>
  );
}
