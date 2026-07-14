/**
 * ManagerDashboard.tsx
 *
 * Manager overview: department stats + employee status table + leave management.
 * Replaces: loadDepartmentData, displayDepartmentStats, loadDepartmentEmployees,
 *           displayDepartmentEmployees, loadManagerLeaveApplications from employees.js.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }            from 'preact';
import { Spinner }               from '@shared/Spinner';
import { StatCard }              from './StatCard';
// LeaveSection REMOVED — managers access leave approvals via HR ▸ Leave & Absence (HR/LeaveOverview).
import { useDeptStats, useDeptEmployees } from './hooks';
import { fmtLocalTime, TODAY_STATUS_COLOR, TODAY_STATUS_LABEL } from './utils';
import type { DeptEmployee }     from './types';

interface ManagerDashboardProps {
  currentUsername: string;
}

export function ManagerDashboard({ currentUsername }: ManagerDashboardProps): VNode {
  const { data: stats, isLoading: statsLoading }       = useDeptStats(currentUsername);
  const { data: employees = [], isLoading: empLoading } = useDeptEmployees(currentUsername);

  return (
    <div style={{ padding: '24px' }}>

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 'var(--font-weight-bold)', color: '#111827' }}>My Department</h1>
        <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#6b7280' }}>Real-time overview of your team's attendance.</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '28px' }}>
        <StatCard icon="fa-users"        label="Department Staff" value={stats?.total   ?? 0} color="#2563eb" loading={statsLoading} />
        <StatCard icon="fa-check-circle" label="Present Today"    value={stats?.present ?? 0} color="#16a34a" loading={statsLoading} />
        <StatCard icon="fa-calendar-alt" label="On Leave"         value={stats?.onLeave ?? 0} color="#d97706" loading={statsLoading} />
        <StatCard icon="fa-clock"        label="Late Today"       value={stats?.late    ?? 0} color="#dc2626" loading={statsLoading} />
      </div>

      {/* Employee status table */}
      <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.08)', marginBottom: '32px', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', fontWeight: '600', fontSize: '15px', color: '#111827' }}>
          Team Status
        </div>
        {empLoading ? (
          <div style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}>
            <Spinner size={32} label="Loading team…" />
          </div>
        ) : employees.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>
            No employees in your department.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                  {['Name', 'Position', 'Status', 'Last Activity', 'Location'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 'var(--font-weight-bold)', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, idx) => (
                  <DeptEmpRow key={idx} emp={emp} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Leave management for manager — now in HR ▸ Leave & Absence (HR/LeaveOverview). */}

    </div>
  );
}

function DeptEmpRow({ emp }: { emp: DeptEmployee }): VNode {
  const color = TODAY_STATUS_COLOR[emp.status];
  const label = TODAY_STATUS_LABEL[emp.status];

  return (
    <tr style={{ borderBottom: '1px solid #f9fafb' }}>
      <td style={{ padding: '10px 16px', fontWeight: '600', color: '#111827' }}>{emp.name}</td>
      <td style={{ padding: '10px 16px', color: '#6b7280' }}>{emp.position || '—'}</td>
      <td style={{ padding: '10px 16px' }}>
        <span style={{
          display:      'inline-flex',
          alignItems:   'center',
          gap:          '5px',
          padding:      '3px 10px',
          borderRadius: '999px',
          fontSize:     '12px',
          fontWeight:   '600',
          background:   `${color}18`,
          color,
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, display: 'inline-block' }} />
          {label}
        </span>
      </td>
      <td style={{ padding: '10px 16px', color: '#6b7280' }}>{emp.lastActivity ? fmtLocalTime(emp.lastActivity) : '—'}</td>
      <td style={{ padding: '10px 16px', color: '#9ca3af', fontSize: '12px' }}>{emp.location || '—'}</td>
    </tr>
  );
}
