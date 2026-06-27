/**
 * src/components/sections/HR/widgets/panels.tsx
 *
 * Real-data HR widget panels for the widget board. Computed client-side from the
 * employee list already loaded on the page — no new backend. Styled by `.hrw-*`
 * in HR.css (scoped under .hr-emp-master).
 */

import { type VNode } from 'preact';
import type { HrEmployeeRow } from '@api/hr/employees';

const DEPT_COLORS = ['#2f80ed', '#5db2dd', '#54bfae', '#68c487', '#38aab9', '#9b70dc'];

export function DeptDistributionPanel({ rows }: { rows: HrEmployeeRow[] }): VNode {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const d = r.departmentName ?? 'Unassigned';
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const total = rows.length || 1;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  let acc = 0;
  const stops = top.map(([, n], i) => {
    const start = (acc / total) * 100; acc += n; const end = (acc / total) * 100;
    return `${DEPT_COLORS[i % DEPT_COLORS.length]} ${start.toFixed(1)}% ${end.toFixed(1)}%`;
  });
  const gradient = stops.length ? `conic-gradient(${stops.join(', ')})` : '#e9eef5';

  return (
    <div class="hrw-dept">
      <div class="hrw-pie" style={{ background: gradient }} />
      <div class="hrw-legend">
        {top.map(([name, n], i) => (
          <div key={name}>
            <i class="hrw-dot" style={{ background: DEPT_COLORS[i % DEPT_COLORS.length] }} />
            <span>{name}</span>
            <b>{Math.round((n / total) * 100)}% ({n})</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DemographicsPanel({ rows }: { rows: HrEmployeeRow[] }): VNode {
  const now = Date.now();
  const YEAR = 365.25 * 864e5;
  const ages: number[] = [];
  const tenures: number[] = [];
  for (const r of rows) {
    if (r.date_of_birth) { const a = (now - new Date(r.date_of_birth).getTime()) / YEAR; if (a > 0 && a < 100) ages.push(a); }
    if (r.start_date)    { const t = (now - new Date(r.start_date).getTime())    / YEAR; if (t >= 0 && t < 60)  tenures.push(t); }
  }
  const avg = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  const avgAge = avg(ages);
  const avgTen = avg(tenures);
  const total = rows.length;
  const contractors = rows.filter(r => r.workerType === 'contractor').length;

  const tiles: { label: string; value: string }[] = [
    { label: 'Headcount',      value: String(total) },
    { label: 'Employees',      value: String(total - contractors) },
    { label: 'Contractors',    value: String(contractors) },
    { label: 'Average age',    value: avgAge != null ? avgAge.toFixed(1) : '—' },
    { label: 'Average tenure', value: avgTen != null ? `${avgTen.toFixed(1)} yrs` : '—' },
  ];

  return (
    <div class="hrw-demo">
      {tiles.map(t => (
        <div class="hrw-demo-tile" key={t.label}><small>{t.label}</small><strong>{t.value}</strong></div>
      ))}
    </div>
  );
}
