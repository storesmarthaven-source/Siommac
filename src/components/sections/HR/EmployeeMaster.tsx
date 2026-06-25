/**
 * src/components/sections/HR/EmployeeMaster.tsx
 *
 * HR ▸ Employee Master — the people register + dashboard KPIs (v36 §4/§5).
 * Built from the @ui kit per src/ui/PAGE_GUIDE.md (sub-module page shape:
 * PageHeader → 4 StatsCards → tab row → register table). Reads via the verified
 * Employee-Master backend (useHrEmployees / useHrDashboardStats).
 *
 * First cut is the read-only register + KPIs; the create wizard + profile drawer
 * are the next iterations.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { PageHeader, MetricRow, StatsCard, TabBar, RegisterTable, StatusPill } from '@ui';
import { toneColor, type Tone } from '@ui/status/statusTokens';
import { useHrEmployees, useHrDashboardStats, type TrainingStatus } from '@api/hr/employees';

const PAGE_TABS = [{ key: 'register', label: 'Register', icon: 'fa-table-list' }];

const TRAINING_TONE: Record<TrainingStatus, Tone> = {
  current: 'positive', due_soon: 'caution', expired: 'negative', none: 'neutral',
};

export function EmployeeMaster(): VNode {
  const [tab, setTab] = useState('register');
  const statsQ = useHrDashboardStats();
  const listQ  = useHrEmployees({ limit: 300 });

  const s    = statsQ.data;
  const rows = listQ.data ?? [];
  const aw = s?.active_workforce;
  const rd = s?.readiness;
  const wq = s?.hr_work_queue;
  const ex = s?.exceptions;

  return (
    <div class="hse-tab hse-dash" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <PageHeader
        icon="fa-users"
        module="HR"
        title="Employee Master"
        sub="The people register — identity, employment, statutory readiness and workflows."
        meta={[
          { icon: 'fa-users', label: `${aw?.total ?? rows.length} active` },
          { icon: 'fa-helmet-safety', label: `${aw?.contractors ?? 0} contractors` },
          { icon: 'fa-money-check-dollar', label: `${rd?.percent ?? 0}% payroll-ready` },
        ]}
      />

      <MetricRow pageKey="hr.employees" rowClass="ui-stat-row" cards={[
        { key: 'workforce', node: (
          <StatsCard icon="fa-users" title="Active Workforce"
            metric={aw?.total ?? 0} metricUnit="active"
            supporting={`${aw?.employees ?? 0} employees · ${aw?.contractors ?? 0} contractors`}
            statuses={[
              { label: 'Employees',   value: String(aw?.employees ?? 0),   color: toneColor('info') },
              { label: 'Contractors', value: String(aw?.contractors ?? 0), color: toneColor('caution') },
            ]}
          />
        ) },
        { key: 'readiness', node: (
          <StatsCard icon="fa-money-check-dollar" title="Payroll Readiness"
            metric={rd?.payroll_ready ?? 0} metricUnit="ready"
            percent={rd?.percent ?? 0} percentTarget={`${rd?.blocked ?? 0} blocked`}
            supporting={`${rd?.training_current ?? 0} training current`}
          />
        ) },
        { key: 'workqueue', node: (
          <StatsCard icon="fa-list-check" title="HR Work Queue" variant="navy"
            metric={wq?.total ?? 0} metricUnit="open"
            supporting={`${wq?.urgent ?? 0} urgent`}
            statuses={(wq?.mix ?? []).map(m => ({ label: m.type, value: String(m.count), color: toneColor('info') }))}
          />
        ) },
        { key: 'exceptions', node: (
          <StatsCard icon="fa-triangle-exclamation" title="Exceptions"
            metric={ex?.total ?? 0} metricUnit="items"
            statuses={(ex?.items ?? []).map(i => ({ label: i.type, value: String(i.count), color: toneColor('negative') }))}
          />
        ) },
      ]} />

      <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', marginTop: '20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TabBar tabs={PAGE_TABS} active={tab} onSelect={setTab} />
        </div>
      </div>

      <div class="hse-table-card" style={{ marginTop: '8px' }}>
        <div class="hse-table-card-top">
          <div class="vt-section-titlewrap">
            <i class="fas fa-users" />
            <div>
              <div class="vt-section-title">Employee Register</div>
              <div class="vt-section-sub">{listQ.isLoading ? 'Loading…' : `${rows.length} people`}</div>
            </div>
          </div>
        </div>
        <RegisterTable noun="employees" columns={[
          { label: 'Employee' },
          { label: 'Employee No.', width: '130px' },
          { label: 'Department' },
          { label: 'Position' },
          { label: 'Worker Type', width: '120px' },
          { label: 'Training', width: '120px' },
          { label: 'Status', width: '120px' },
        ]}>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.full_name ?? r.username}</td>
              <td>{r.employee_number ?? '—'}</td>
              <td>{r.departmentName ?? '—'}</td>
              <td>{r.position ?? '—'}</td>
              <td style={{ textTransform: 'capitalize' }}>{r.workerType}</td>
              <td><StatusPill tone={TRAINING_TONE[r.trainingStatus]} status={r.trainingStatus.replace('_', ' ')} /></td>
              <td><StatusPill status={r.status} /></td>
            </tr>
          ))}
        </RegisterTable>
      </div>
    </div>
  );
}
