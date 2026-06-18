/**
 * src/components/sections/HSE/HSEDashboard.tsx
 *
 * HSE Dashboard tab — incident KPI cards, Chart.js charts (Incident Trend / By
 * Type / Severity), and a Recent Incidents table. UI-only with static data.
 */

import { type VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { StatCard } from '../Employees/StatCard';
import { mockIncidents, ppePillClass } from './types';

// Chart.js is loaded as a CDN global (see index.html / charts.ts).
declare const Chart: any;

const NAVY = '#1b2d54';
const RED  = '#E40C0C';
const GOLD = '#FFB712';
const GREEN = '#2E7D32';
const BLUE  = '#2563eb';

/** Mount a Chart.js chart on a canvas ref, destroying it on unmount/redep. */
function useChart(ref: { current: HTMLCanvasElement | null }, config: any): void {
  useEffect(() => {
    if (typeof Chart === 'undefined' || !ref.current) return;
    const chart = new Chart(ref.current.getContext('2d'), config);
    return () => chart.destroy();
  }, []);
}

export function HSEDashboard(): VNode {
  const trendRef = useRef<HTMLCanvasElement>(null);
  const typeRef  = useRef<HTMLCanvasElement>(null);
  const sevRef   = useRef<HTMLCanvasElement>(null);

  useChart(trendRef, {
    type: 'line',
    data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], datasets: [{
      label: 'Incidents', data: [8, 6, 10, 7, 9, 7],
      borderColor: NAVY, backgroundColor: 'rgba(27,45,84,0.08)', tension: 0.3,
      pointBackgroundColor: NAVY, pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 4, fill: true,
    }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { stepSize: 2 } }, x: { grid: { display: false } } } },
  });

  useChart(typeRef, {
    type: 'doughnut',
    data: { labels: ['Safety', 'Environmental', 'Health', 'Security'], datasets: [{
      data: [18, 12, 10, 7], backgroundColor: [NAVY, BLUE, GOLD, RED], borderWidth: 0,
    }] },
    options: { responsive: true, maintainAspectRatio: true, cutout: '68%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 11 } } } } },
  });

  useChart(sevRef, {
    type: 'bar',
    data: { labels: ['High', 'Medium', 'Low'], datasets: [{
      label: 'Count', data: [8, 15, 24], backgroundColor: [RED, GOLD, GREEN], borderRadius: 4, borderSkipped: false,
    }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { stepSize: 5 } }, x: { grid: { display: false } } } },
  });

  return (
    <div class="hse-tab">
      {/* Incident KPI cards */}
      <div class="hse-kpi-row">
        <StatCard icon="fa-triangle-exclamation" label="Total Incidents"     value={47}  color="#dc2626" />
        <StatCard icon="fa-clock"                label="LTIFR"                value={1.8 as unknown as number} color="#d97706" />
        <StatCard icon="fa-user-graduate"        label="Training Completion" value={94}  color="#16a34a" />
        <StatCard icon="fa-calendar-check"       label="Days Since LTI"      value={186} color="#2563eb" />
        <StatCard icon="fa-recycle"              label="Env. Compliance"     value={98}  color="#7c3aed" />
      </div>

      {/* Charts */}
      <div class="hse-charts-row">
        <div class="hse-chart-card">
          <div class="hse-chart-head"><h3><i class="fas fa-chart-line" /> Incident Trend</h3></div>
          <canvas ref={trendRef} />
        </div>
        <div class="hse-chart-card">
          <div class="hse-chart-head"><h3><i class="fas fa-chart-pie" /> By Type</h3></div>
          <canvas ref={typeRef} />
        </div>
        <div class="hse-chart-card">
          <div class="hse-chart-head"><h3><i class="fas fa-chart-column" /> Severity</h3></div>
          <canvas ref={sevRef} />
        </div>
      </div>

      {/* Recent incidents */}
      <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
        <span class="vt-section-icon"><i class="fas fa-list-ul" /></span>
        <div>
          <div class="vt-section-title">Recent Incidents</div>
          <div class="vt-section-sub">Latest reported HSE events across all sites.</div>
        </div>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>ID</th><th>Title</th><th>Site</th><th>Severity</th><th>Status</th></tr></thead>
            <tbody>
              {mockIncidents.map(inc => (
                <tr key={inc.id}>
                  <td class="vt-cell-mono">{inc.id}</td>
                  <td><span class="vt-cell-name">{inc.title}</span></td>
                  <td style={{ color: 'var(--text-muted)' }}>{inc.site}</td>
                  <td><span class={ppePillClass(inc.severity === 'high' ? 'expired' : inc.severity === 'medium' ? 'pending' : 'available')} style={{ textTransform: 'capitalize' }}>{inc.severity}</span></td>
                  <td><span class={ppePillClass(inc.status)} style={{ textTransform: 'capitalize' }}>{inc.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
