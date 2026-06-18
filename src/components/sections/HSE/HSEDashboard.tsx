/**
 * src/components/sections/HSE/HSEDashboard.tsx
 *
 * HSE Dashboard — a Trinidad & Tobago HSE command view. UI-only (static data
 * from types.ts mock*), rendered in Siomac navy/red:
 *   • Dark overview hero: profile pill + 4 summary stats + HSE health ring
 *   • 6 rich KPI cards (value/label/subtitle/status note, severity accent)
 *   • Safety-performance trend chart + Critical Work Queue
 *   • Recent Incidents register (search + filters ABOVE the table)
 *   • Site Risk + Active Permits + Readiness
 */

import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ProfilePill } from '@shared/ProfilePill';
import {
  mockHeroStats, HSE_HEALTH_SCORE, mockHseKpis, mockTrend, mockQueue,
  mockHseIncidents, mockSiteRisk, mockPermits, mockReadiness,
  hsePill, hseSeverityColor, type HseKpi, type ReadinessRow, type SiteRisk,
} from './types';

declare const Chart: any;

const NAVY = '#1b2d54', RED = '#E40C0C', GREEN = '#2E7D32';

function useChart(ref: { current: HTMLCanvasElement | null }, config: any): void {
  useEffect(() => {
    if (typeof Chart === 'undefined' || !ref.current) return;
    const chart = new Chart(ref.current.getContext('2d'), config);
    return () => chart.destroy();
  }, []);
}

// ── Rich KPI card ─────────────────────────────────────────────────────────────

function HseKpiCard({ kpi }: { kpi: HseKpi }): VNode {
  return (
    <article class="hse-kpi-card" style={{ '--accent': hseSeverityColor(kpi.severity) } as Record<string, string>}>
      <div class="hse-kpi-top">
        <span class="hse-kpi-label">{kpi.label}</span>
        <span class={`hse-kpi-note hse-kpi-note--${kpi.severity}`}>{kpi.note}</span>
      </div>
      <div class="hse-kpi-value">{kpi.value}</div>
      <div class="hse-kpi-sub">{kpi.subtitle}</div>
    </article>
  );
}

function ProgressBar({ value, severity }: { value: number; severity: string }): VNode {
  return (
    <div class={`hse-progress hse-progress--${severity}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function SiteCard({ s }: { s: SiteRisk }): VNode {
  return (
    <article class="hse-site-item">
      <header><strong>{s.site}</strong><span class={hsePill(s.level)}>{s.level}</span></header>
      <p>{s.detail}</p>
      <ProgressBar value={s.score} severity={s.severity} />
      <div class="hse-muted">{s.open} open · {s.overdue} overdue</div>
    </article>
  );
}

function ReadyCard({ r }: { r: ReadinessRow }): VNode {
  return (
    <article class="hse-ready-item">
      <header><strong>{r.label}</strong><span class="hse-ready-value">{r.value}</span></header>
      <p>{r.detail}</p>
      <ProgressBar value={parseInt(r.value, 10) || 0} severity={r.severity} />
    </article>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function HSEDashboard(): VNode {
  const trendRef = useRef<HTMLCanvasElement>(null);
  const [search, setSearch] = useState('');
  const [site, setSite]     = useState('all');
  const [status, setStatus] = useState('all');

  useChart(trendRef, {
    type: 'line',
    data: {
      labels: mockTrend.map(t => t.month),
      datasets: [
        { label: 'Incidents',   data: mockTrend.map(t => t.incidents),   borderColor: RED,   backgroundColor: 'rgba(228,12,12,0.06)',  tension: 0.35, fill: true, pointRadius: 3 },
        { label: 'Near misses', data: mockTrend.map(t => t.nearMisses),  borderColor: '#d97706', backgroundColor: 'transparent',       tension: 0.35, pointRadius: 3 },
        { label: 'CAPA closure',data: mockTrend.map(t => t.capaClosure), borderColor: GREEN, backgroundColor: 'transparent',           tension: 0.35, pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } },
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } },
    },
  });

  const incidents = useMemo(() => {
    const q = search.toLowerCase().trim();
    return mockHseIncidents.filter(i =>
      (site === 'all' || i.site === site) &&
      (status === 'all' || i.status === status) &&
      (!q || `${i.ref} ${i.site} ${i.event} ${i.klass} ${i.owner}`.toLowerCase().includes(q)));
  }, [search, site, status]);

  const sites = [...new Set(mockHseIncidents.map(i => i.site))];
  const statuses = [...new Set(mockHseIncidents.map(i => i.status))];

  return (
    <div class="hse-tab hse-dash">
      {/* Hero: pill + summary stats + health ring */}
      <div class="dash-overview-panel ppe-hero-panel hse-hero">
        <div class="dash-panel-content">
          <div class="overview-top-bar">
            <div class="overview-title-section">
              <i class="fas fa-helmet-safety" />
              <h2>HSE Dashboard <span class="hse-hero-sub">Trinidad &amp; Tobago</span></h2>
            </div>
            <ProfilePill variant="onDark" />
          </div>
          <div class="hse-hero-body">
            <div class="dash-stats-row hse-hero-stats">
              {mockHeroStats.map(s => (
                <div class="hse-hero-stat" key={s.label}>
                  <strong>{s.value}</strong>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
            <aside class="hse-score">
              <div class="hse-score-ring" style={{ '--score': `${HSE_HEALTH_SCORE}%` } as Record<string, string>}>
                <strong>{HSE_HEALTH_SCORE}</strong>
              </div>
              <span>HSE Health Score</span>
            </aside>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div class="hse-kpi-grid">
        {mockHseKpis.map(k => <HseKpiCard key={k.label} kpi={k} />)}
      </div>

      {/* Trend + critical work queue */}
      <div class="hse-perf-grid">
        <article class="vt-table-card hse-chart-card">
          <div class="hse-card-head"><h3><i class="fas fa-chart-column" /> Safety Performance Trend</h3><span>Incidents, near misses, CAPA closure</span></div>
          <div class="hse-chart-body"><canvas ref={trendRef} /></div>
        </article>
        <aside class="vt-table-card hse-queue-card">
          <div class="hse-card-head"><h3><i class="fas fa-bell" /> Critical Work Queue</h3><span>Escalate today</span></div>
          <div class="hse-queue-list">
            {mockQueue.map(q => (
              <div class="hse-queue-item" key={q.title} style={{ '--accent': hseSeverityColor(q.severity) } as Record<string, string>}>
                <div><strong>{q.title}</strong><span>{q.detail}</span></div>
                <span class={hsePill(q.status)}>{q.status}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Recent incidents — search + filters ABOVE the table */}
      <div class="vt-section-titlewrap" style={{ marginBottom: '12px' }}>
        <span class="vt-section-icon"><i class="fas fa-clipboard-list" /></span>
        <div>
          <div class="vt-section-title">Recent Incidents</div>
          <div class="vt-section-sub">OSH recordables, near misses, environmental events.</div>
        </div>
      </div>
      <div class="vt-toolbar">
        <div class="vt-search" style={{ flex: '1 1 240px' }}>
          <i class="fas fa-search" /><input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search incidents, site, owner…" />
        </div>
        <select class="emp-filter-select" value={site} onChange={e => setSite((e.target as HTMLSelectElement).value)}>
          <option value="all">All T&amp;T sites</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select class="emp-filter-select" value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="all">All status</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div class="vt-result-count">Showing {incidents.length} of {mockHseIncidents.length} records</div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Record</th><th>Site</th><th>Event</th><th>Class</th><th>Status</th><th>Owner</th></tr></thead>
            <tbody>
              {incidents.length === 0 ? (
                <tr><td colspan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '26px' }}>No incidents match.</td></tr>
              ) : incidents.map(i => (
                <tr key={i.ref}>
                  <td><span class="vt-cell-mono">{i.ref}</span><div class="hse-muted">{i.date}</div></td>
                  <td>{i.site}</td>
                  <td style={{ maxWidth: '320px' }}><span class="vt-cell-name" style={{ fontWeight: 500 }}>{i.event}</span><div class="hse-muted">{i.action}</div></td>
                  <td>{i.klass}</td>
                  <td><span class={hsePill(i.status)}>{i.status}</span></td>
                  <td style={{ color: 'var(--text-muted)' }}>{i.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Site risk + permits + readiness */}
      <div class="hse-bottom-grid">
        <article class="vt-table-card hse-pad">
          <div class="hse-card-head"><h3><i class="fas fa-location-dot" /> Site Risk</h3><span>Core T&amp;T locations</span></div>
          <div class="hse-site-list">{mockSiteRisk.map(s => <SiteCard key={s.site} s={s} />)}</div>
        </article>
        <article class="vt-table-card">
          <div class="hse-card-head hse-pad-head"><h3><i class="fas fa-id-badge" /> Active Permits</h3><span>PTW control gates</span></div>
          <div class="vt-table-scroll">
            <table class="vt-table">
              <thead><tr><th>Permit</th><th>Site</th><th>Control Gate</th><th>Status</th></tr></thead>
              <tbody>
                {mockPermits.map(p => (
                  <tr key={p.ref}>
                    <td><span class="vt-cell-mono">{p.ref}</span></td>
                    <td>{p.site}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{p.gate}</td>
                    <td><span class={hsePill(p.status)}>{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article class="vt-table-card hse-pad">
          <div class="hse-card-head"><h3><i class="fas fa-user-check" /> Readiness</h3><span>Controls to keep healthy</span></div>
          <div class="hse-ready-list">{mockReadiness.map(r => <ReadyCard key={r.label} r={r} />)}</div>
        </article>
      </div>
    </div>
  );
}
