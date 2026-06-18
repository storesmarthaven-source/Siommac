/**
 * src/components/sections/HSE/HSEDashboard.tsx
 *
 * HSE Dashboard — a Trinidad & Tobago HSE command view, ported 1:1 from the
 * hse-erp.html mockup and tailored to Siomac navy/red. UI-only (static data from
 * types.ts mock*). Full feature set:
 *   • Dark overview hero (profile pill + 4 summary stats + HSE health ring)
 *   • Topbar (live dot + Snapshot / Daily Brief) and a 4-up filter bar
 *   • 6 rich KPI cards (value / label / subtitle / trend pill, severity-tinted)
 *   • Hand-built SVG safety-performance trend chart + Critical Work Queue
 *   • Recent Incidents register (record-pills, two-line cells)
 *   • Site Risk (progress bars) + Active Permits + Readiness
 *   • Slide-in drilldown drawer wired to every clickable card / row
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { ProfilePill } from '@shared/ProfilePill';
import {
  mockHeroStats, HSE_HEALTH_SCORE, mockHseKpis, mockTrend, mockQueue,
  mockHseIncidents, mockSiteRisk, mockPermits, mockReadiness,
  hseStatusClass, splitSiteDetail,
  HSE_SITE_OPTIONS, HSE_PERIOD_OPTIONS, HSE_RISK_OPTIONS, HSE_OWNER_OPTIONS,
  type HseKpi, type HseIncident, type Permit, type QueueItem,
  type ReadinessRow, type SiteRisk,
} from './types';

// ── Drilldown drawer ──────────────────────────────────────────────────────────

interface DrawerData { title: string; subtitle: string; rows: [string, string][]; }

function Drawer({ data, onClose }: { data: DrawerData | null; onClose: () => void }): VNode {
  return (
    <>
      <div class={`hse-drawer-backdrop${data ? ' show' : ''}`} onClick={onClose} />
      <aside class={`hse-drawer${data ? ' show' : ''}`} role="dialog" aria-modal="true" aria-hidden={!data}>
        <div class="hse-drawer-head">
          <div><h3>{data?.title ?? 'Details'}</h3><p>{data?.subtitle ?? ''}</p></div>
          <button class="hse-icon-btn" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>
        <div class="hse-drawer-body">
          <div class="hse-drawer-grid">
            {(data?.rows ?? []).map(([k, v]) => (
              <div class="hse-drawer-card" key={k}><span>{k}</span><strong>{v}</strong></div>
            ))}
          </div>
        </div>
        <div class="hse-drawer-foot">
          <button class="hse-btn">Export</button>
          <button class="hse-btn accent">Open Action</button>
        </div>
      </aside>
    </>
  );
}

const DRILL_ROWS = (value: string): [string, string][] => [
  ['Current value', value],
  ['Owner', 'HSE / Site Manager'],
  ['Local evidence', 'OSH log, PTW, EMA/CEC file, contractor evidence'],
  ['Next action', 'Review controls, attach evidence, assign owner'],
];

// ── KPI card ──────────────────────────────────────────────────────────────────

function HseKpiCard({ kpi, onOpen }: { kpi: HseKpi; onOpen: (d: DrawerData) => void }): VNode {
  return (
    <article
      class={`hse-kpi-card hse-kpi-card--${kpi.severity}`}
      onClick={() => onOpen({ title: kpi.label, subtitle: kpi.subtitle, rows: DRILL_ROWS(kpi.value) })}
    >
      <span class="hse-kpi-label">{kpi.label}</span>
      <div class="hse-kpi-value">{kpi.value}</div>
      <div class="hse-kpi-sub">{kpi.subtitle}</div>
      <span class="hse-kpi-pill">{kpi.note}</span>
    </article>
  );
}

// ── SVG safety-performance trend chart (hand-built, mirrors the source) ─────────

const T_W = 720, T_H = 220, T_PAD = 26;

type Pt = [number, number, number];
function trendPoints(values: number[], maxValue: number): Pt[] {
  return values.map((value, i) => {
    const x = T_PAD + i * ((T_W - T_PAD * 2) / (values.length - 1));
    const y = T_H - T_PAD - (value / maxValue) * (T_H - T_PAD * 2);
    return [Math.round(x), Math.round(y), value];
  });
}
const linePath = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
const areaPath = (pts: Pt[]) => {
  const first = pts[0], lastPt = pts[pts.length - 1];
  if (!first || !lastPt) return '';
  return `${linePath(pts)} L${lastPt[0]} ${T_H - T_PAD} L${first[0]} ${T_H - T_PAD} Z`;
};

function TrendChart(): VNode {
  const months   = mockTrend.map(t => t.month);
  const incPts    = trendPoints(mockTrend.map(t => t.incidents), 80);
  const nearPts   = trendPoints(mockTrend.map(t => t.nearMisses), 80);
  const closurePts = trendPoints(mockTrend.map(t => t.capaClosure), 100);
  const last = mockTrend[mockTrend.length - 1] ?? { incidents: 0, nearMisses: 0, capaClosure: 0 };

  return (
    <div class="hse-trend-chart">
      <div class="hse-trend-summary">
        <div class="hse-trend-card incident"><span>Incidents</span><strong>{last.incidents}</strong></div>
        <div class="hse-trend-card near"><span>Near Misses</span><strong>{last.nearMisses}</strong></div>
        <div class="hse-trend-card closure"><span>Closure Rate</span><strong>{last.capaClosure}%</strong></div>
      </div>
      <svg class="hse-trend-svg" viewBox={`0 0 ${T_W} ${T_H}`} preserveAspectRatio="none" role="img"
           aria-label="Safety performance trend for incidents, near misses, and closure rate">
        <path class="area-near" d={areaPath(nearPts)} />
        <path class="area-incidents" d={areaPath(incPts)} />
        <path class="line-near" d={linePath(nearPts)} />
        <path class="line-incidents" d={linePath(incPts)} />
        <path class="line-closure" d={linePath(closurePts)} />
        {incPts.map((p, i)     => <circle key={`i${i}`} cx={p[0]} cy={p[1]} r={5} class="dot-incidents"><title>{months[i]} incidents: {p[2]}</title></circle>)}
        {nearPts.map((p, i)    => <circle key={`n${i}`} cx={p[0]} cy={p[1]} r={5} class="dot-near"><title>{months[i]} near misses: {p[2]}</title></circle>)}
        {closurePts.map((p, i) => <circle key={`c${i}`} cx={p[0]} cy={p[1]} r={5} class="dot-closure"><title>{months[i]} closure rate: {p[2]}%</title></circle>)}
        {closurePts.map((p, i) => i % 2 === 0
          ? <text key={`l${i}`} class="hse-trend-label" x={p[0]} y={p[1] - 11} text-anchor="middle">{p[2]}%</text>
          : null)}
      </svg>
      <div class="hse-trend-axis">{months.map(m => <span key={m}>{m}</span>)}</div>
      <div class="hse-legend">
        <span><i style={{ background: 'var(--siomac-red)' }} />Incidents</span>
        <span><i style={{ background: '#d97706' }} />Near misses</span>
        <span><i style={{ background: '#2E7D32' }} />CAPA closure</span>
      </div>
    </div>
  );
}

// ── Queue item ──────────────────────────────────────────────────────────────────

function QueueCard({ q, onOpen }: { q: QueueItem; onOpen: (d: DrawerData) => void }): VNode {
  const { site, detail } = splitSiteDetail(q.detail);
  const urgent = q.status === 'Pending' ? '7 days' : 'Today';
  const lane   = q.severity === 'danger' ? 'Escalation' : 'HSE Review';
  return (
    <article
      class={`hse-queue-item hse-queue-item--${q.severity}`}
      onClick={() => onOpen({ title: q.title, subtitle: q.detail, rows: DRILL_ROWS(q.status) })}
    >
      <header>
        <div><strong>{q.title}</strong><p>{detail}</p></div>
        <span class={`hse-status-badge ${hseStatusClass(q.status)}`}>{q.status}</span>
      </header>
      <div class="hse-queue-meta">
        <span><i class="fas fa-location-dot" />{site}</span>
        <span><i class="fas fa-user-shield" />{lane}</span>
        <span><i class="fas fa-clock" />{urgent}</span>
      </div>
    </article>
  );
}

// ── Site / readiness cards ──────────────────────────────────────────────────────

function ProgressBar({ value, severity }: { value: number; severity: string }): VNode {
  return (
    <div class={`hse-progress hse-progress--${severity}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function SiteCard({ s, onOpen }: { s: SiteRisk; onOpen: (d: DrawerData) => void }): VNode {
  return (
    <article
      class={`hse-site-item hse-site-item--${s.severity}`}
      onClick={() => onOpen({ title: s.site, subtitle: s.detail, rows: DRILL_ROWS(s.level) })}
    >
      <header><strong>{s.site}</strong><span class={`hse-status-badge ${hseStatusClass(s.level)}`}>{s.level}</span></header>
      <p>{s.detail}</p>
      <ProgressBar value={s.score} severity={s.severity} />
      <div class="hse-kpi-sub">{s.open} open · {s.overdue} overdue</div>
    </article>
  );
}

function ReadyCard({ r, onOpen }: { r: ReadinessRow; onOpen: (d: DrawerData) => void }): VNode {
  return (
    <article
      class={`hse-ready-item hse-ready-item--${r.severity}`}
      onClick={() => onOpen({ title: r.label, subtitle: r.detail, rows: DRILL_ROWS(r.value) })}
    >
      <header><strong>{r.label}</strong><span class="hse-ready-value">{r.value}</span></header>
      <p>{r.detail}</p>
      <ProgressBar value={parseInt(r.value, 10) || 0} severity={r.severity} />
    </article>
  );
}

// ── Incident row ────────────────────────────────────────────────────────────────

function IncidentRow({ i, onOpen }: { i: HseIncident; onOpen: (d: DrawerData) => void }): VNode {
  return (
    <tr
      onClick={() => onOpen({ title: `${i.ref} ${i.klass}`, subtitle: i.event, rows: DRILL_ROWS(i.status) })}
    >
      <td class="hse-rec-cell"><strong>{i.ref}</strong><span>{i.date}</span></td>
      <td>{i.site}</td>
      <td class="hse-event-cell">{i.event}<span class="hse-incident-detail">{i.action}</span></td>
      <td><span class={`hse-record-pill ${hseStatusClass(i.status)}`}><i />{i.klass}</span></td>
      <td><span class={`hse-status-badge ${hseStatusClass(i.status)}`}>{i.status}</span></td>
      <td class="hse-muted">{i.owner}</td>
    </tr>
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────────────

export function HSEDashboard(): VNode {
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const [search, setSearch] = useState('');
  const [site, setSite]     = useState('all');
  const [risk, setRisk]     = useState('all');
  const open = (d: DrawerData) => setDrawer(d);

  // Source-faithful client-side filter: search text + site + risk match across
  // queue, incidents, sites, readiness, permits.
  const q = search.toLowerCase().trim();
  const s = site.toLowerCase();
  const r = risk.toLowerCase();
  const match = (text: string) =>
    (!q || text.toLowerCase().includes(q)) &&
    (s === 'all' || text.toLowerCase().includes(s)) &&
    (r === 'all' || text.toLowerCase().includes(r));

  const queue      = useMemo(() => mockQueue.filter(x => match(`${x.title} ${x.detail} ${x.status}`)), [q, s, r]);
  const incidents  = useMemo(() => mockHseIncidents.filter(x => match(`${x.ref} ${x.site} ${x.event} ${x.klass} ${x.status} ${x.owner}`)), [q, s, r]);
  const sites      = useMemo(() => mockSiteRisk.filter(x => match(`${x.site} ${x.level} ${x.detail}`)), [q, s, r]);
  const permits    = useMemo(() => mockPermits.filter(x => match(`${x.ref} ${x.site} ${x.gate} ${x.status}`)), [q, s, r]);
  const readiness  = useMemo(() => mockReadiness.filter(x => match(`${x.label} ${x.detail}`)), [q, s, r]);

  const briefDrill: DrawerData = {
    title: 'Daily Brief', subtitle: 'Generated T&T HSE summary',
    rows: [['Scope', site === 'all' ? 'All T&T sites' : site], ['Period', 'Month to date'],
           ['Includes', 'OSH, PTW, EMA/CEC, contractor HSE, PPE, readiness'], ['Status', 'Ready for review']],
  };

  return (
    <div class="hse-tab hse-dash">
      {/* Dark overview hero — kept as-is per design direction. */}
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
              {mockHeroStats.map(st => (
                <div class="hse-hero-stat" key={st.label}>
                  <strong>{st.value}</strong>
                  <span>{st.label}</span>
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

      {/* Topbar: live dot + search + Snapshot / Daily Brief */}
      <header class="hse-topbar">
        <div class="hse-topbar-left">
          <span class="hse-live-dot" />
          <h1>HSE Command <small>Live operational view</small></h1>
        </div>
        <div class="hse-topbar-actions">
          <label class="hse-search-box">
            <i class="fas fa-search" />
            <input value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search HSE records…" />
          </label>
          <button class="hse-btn" onClick={() => open({ title: 'Snapshot', subtitle: 'Generated T&T HSE summary', rows: briefDrill.rows })}>
            <i class="fas fa-camera" />Snapshot
          </button>
          <button class="hse-btn primary" onClick={() => open(briefDrill)}>
            <i class="fas fa-file-lines" />Daily Brief
          </button>
        </div>
      </header>

      {/* Filter bar */}
      <section class="hse-filters">
        <select value={site} onChange={e => setSite((e.target as HTMLSelectElement).value)}>
          <option value="all">All T&amp;T sites</option>
          {HSE_SITE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select>{HSE_PERIOD_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
        <select value={risk} onChange={e => setRisk((e.target as HTMLSelectElement).value)}>
          <option value="all">All risk</option>
          {HSE_RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select><option value="all">All owners</option>{HSE_OWNER_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
      </section>

      {/* KPI cards */}
      <div class="hse-kpi-grid">
        {mockHseKpis.map(k => <HseKpiCard key={k.label} kpi={k} onOpen={open} />)}
      </div>

      {/* Trend + critical work queue */}
      <div class="hse-perf-grid">
        <article class="hse-card hse-chart-card">
          <div class="hse-card-head"><h3><i class="fas fa-chart-column" /> Safety Performance Trend</h3><span>Incidents, near misses, CAPA closure</span></div>
          <div class="hse-card-body"><TrendChart /></div>
        </article>
        <aside class="hse-card hse-queue-card">
          <div class="hse-card-head"><h3><i class="fas fa-bell" /> Critical Work Queue</h3><span>Escalate today</span></div>
          <div class="hse-card-body hse-queue-list">
            {queue.map(x => <QueueCard key={x.title} q={x} onOpen={open} />)}
          </div>
        </aside>
      </div>

      {/* Recent incidents */}
      <section class="hse-card hse-incident-register">
        <div class="hse-card-head"><h3><i class="fas fa-clipboard-list" /> Recent Incidents</h3><span>OSH recordables, near misses, environmental events</span></div>
        <div class="hse-table-scroll">
          <table class="hse-data-table hse-incident-table">
            <thead><tr><th>Record</th><th>Site</th><th>Event</th><th>Class</th><th>Status</th><th>Owner</th></tr></thead>
            <tbody>
              {incidents.length === 0
                ? <tr><td colspan={6} class="hse-empty">No incidents match.</td></tr>
                : incidents.map(i => <IncidentRow key={i.ref} i={i} onOpen={open} />)}
            </tbody>
          </table>
        </div>
      </section>

      {/* Site risk + permits + readiness */}
      <div class="hse-bottom-grid">
        <article class="hse-card">
          <div class="hse-card-head"><h3><i class="fas fa-location-dot" /> Site Risk</h3><span>Core T&amp;T locations</span></div>
          <div class="hse-card-body hse-site-list">{sites.map(x => <SiteCard key={x.site} s={x} onOpen={open} />)}</div>
        </article>
        <article class="hse-card">
          <div class="hse-card-head"><h3><i class="fas fa-id-badge" /> Active Permits</h3><span>PTW control gates</span></div>
          <div class="hse-table-scroll">
            <table class="hse-data-table">
              <thead><tr><th>Permit</th><th>Site</th><th>Control Gate</th><th>Status</th></tr></thead>
              <tbody>
                {permits.map((p: Permit) => (
                  <tr key={p.ref} onClick={() => open({ title: p.ref, subtitle: p.gate, rows: DRILL_ROWS(p.status) })}>
                    <td><strong>{p.ref}</strong></td>
                    <td>{p.site}</td>
                    <td class="hse-muted">{p.gate}</td>
                    <td><span class={`hse-status-badge ${hseStatusClass(p.status)}`}>{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article class="hse-card">
          <div class="hse-card-head"><h3><i class="fas fa-user-check" /> Readiness</h3><span>Controls to keep healthy</span></div>
          <div class="hse-card-body hse-ready-list">{readiness.map(x => <ReadyCard key={x.label} r={x} onOpen={open} />)}</div>
        </article>
      </div>

      <Drawer data={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
