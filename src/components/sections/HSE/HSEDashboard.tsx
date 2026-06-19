/**
 * src/components/sections/HSE/HSEDashboard.tsx
 *
 * HSE Dashboard — T&T HSE command view.
 * Pattern: AreaHero (dark) → light card body below, matching every other HSE area.
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useWorkflow } from '@lib/workflow';
import { AreaHero } from './_shared';
import {
  mockHseKpis, mockTrend, mockQueue,
  mockHseIncidents, mockSiteRisk, mockPermits, mockReadiness,
  HSE_HEALTH_SCORE,
  hseStatusClass, splitSiteDetail,
  HSE_SITE_OPTIONS, HSE_PERIOD_OPTIONS, HSE_RISK_OPTIONS, HSE_OWNER_OPTIONS,
  type HseIncident, type Permit, type QueueItem, type ReadinessRow, type SiteRisk,
} from './types';

// ── Colour helpers ────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  danger:  'var(--hse-red)',
  warning: 'var(--hse-amber)',
  success: 'var(--hse-green)',
  info:    'var(--hse-blue)',
};

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

// ── Tiny SVG sparkline ────────────────────────────────────────────────────────

const SW = 110, SH = 30;
function sparkPath(vals: number[], close = false): string {
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * SW},${SH - 3 - ((v / max) * (SH - 6))}`);
  if (close) return `M0,${SH} L${pts.join(' L')} L${SW},${SH} Z`;
  return `M${pts.join(' L')}`;
}

// ── Trend sparkline strip (4 panels) ─────────────────────────────────────────

function TrendStrip(): VNode {
  const pts  = mockTrend;
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  const months = pts.map(p => p.month);
  const iVals  = pts.map(p => p.incidents);
  const nVals  = pts.map(p => p.nearMisses);
  const cVals  = pts.map(p => p.capaClosure);
  const iDelta = last.incidents  - prev.incidents;
  const nDelta = last.nearMisses - prev.nearMisses;
  const cDelta = last.capaClosure - prev.capaClosure;
  const ytdInc = pts.reduce((s, p) => s + p.incidents, 0);

  function DeltaChip({ d, goodDown = false }: { d: number; goodDown?: boolean }): VNode {
    const positive = goodDown ? d < 0 : d > 0;
    const cls = d === 0 ? 'flat' : positive ? 'down' : 'up';
    return (
      <span class={`hse-spark-delta ${cls}`}>
        <i class={`fas ${d === 0 ? 'fa-minus' : d < 0 ? 'fa-arrow-down' : 'fa-arrow-up'}`} />{Math.abs(d)}
      </span>
    );
  }

  const sevMix = [
    { label: 'Critical / High', count: 3, color: 'var(--hse-red)' },
    { label: 'Medium',          count: 2, color: 'var(--hse-amber)' },
    { label: 'Low',             count: 2, color: 'var(--hse-green)' },
  ];

  return (
    <div class="hse-spark-row">
      {/* Incidents MTD */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">Incidents MTD</span>
          <DeltaChip d={iDelta} goodDown />
        </div>
        <div class="hse-spark-val" style={{ color: 'var(--hse-red)' }}>{last.incidents}</div>
        <div class="hse-spark-sub">YTD total: {ytdInc} · Target ≤3/mo</div>
        <svg viewBox={`0 0 ${SW} ${SH}`} width={SW} height={SH} style={{ marginTop: '8px', overflow: 'visible', display: 'block' }}>
          <path d={sparkPath(iVals, true)} fill="rgba(228,12,12,.08)" />
          <path d={sparkPath(iVals)} fill="none" stroke="var(--hse-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          {(() => { const max = Math.max(...iVals, 1); const i = iVals.length - 1; return <circle cx={(i / (iVals.length - 1)) * SW} cy={SH - 3 - ((iVals[i]! / max) * (SH - 6))} r="3.5" fill="var(--hse-red)" stroke="var(--bg-card)" stroke-width="1.5" />; })()}
        </svg>
        <div class="hse-spark-months">{months.map(m => <span key={m}>{m}</span>)}</div>
      </div>

      {/* Near Misses MTD */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">Near Misses MTD</span>
          <DeltaChip d={nDelta} />
        </div>
        <div class="hse-spark-val" style={{ color: 'var(--hse-amber)' }}>{last.nearMisses}</div>
        <div class="hse-spark-sub">Near misses should exceed incidents — leading indicator</div>
        <svg viewBox={`0 0 ${SW} ${SH}`} width={SW} height={SH} style={{ marginTop: '8px', overflow: 'visible', display: 'block' }}>
          <path d={sparkPath(nVals, true)} fill="rgba(245,158,11,.08)" />
          <path d={sparkPath(nVals)} fill="none" stroke="var(--hse-amber)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          {(() => { const max = Math.max(...nVals, 1); const i = nVals.length - 1; return <circle cx={(i / (nVals.length - 1)) * SW} cy={SH - 3 - ((nVals[i]! / max) * (SH - 6))} r="3.5" fill="var(--hse-amber)" stroke="var(--bg-card)" stroke-width="1.5" />; })()}
        </svg>
        <div class="hse-spark-months">{months.map(m => <span key={m}>{m}</span>)}</div>
      </div>

      {/* CAPA Closure */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">CAPA Closure</span>
          <DeltaChip d={cDelta} />
        </div>
        <div class="hse-spark-val" style={{ color: last.capaClosure >= 90 ? 'var(--hse-green)' : 'var(--hse-amber)' }}>{last.capaClosure}%</div>
        <div class="hse-spark-sub">Target 95% · {last.capaClosure >= 95 ? 'On target' : `${95 - last.capaClosure}% below target`}</div>
        <div class="hse-spark-bar-track" style={{ marginTop: '10px' }}>
          <div class="hse-spark-bar-fill" style={{ width: `${last.capaClosure}%`, background: last.capaClosure >= 90 ? 'var(--hse-green)' : 'var(--hse-amber)' }} />
        </div>
        <div style={{ position: 'relative', height: '14px', marginTop: '2px' }}>
          <div style={{ position: 'absolute', left: '95%', top: 0, width: '1.5px', height: '8px', background: 'var(--hse-red)' }} />
          <span style={{ position: 'absolute', left: 'calc(95% + 3px)', top: '1px', fontSize: '0.55rem', color: 'var(--hse-red)', fontWeight: 700 }}>95%</span>
        </div>
        <div class="hse-spark-months">{months.map(m => <span key={m}>{m}</span>)}</div>
      </div>

      {/* Severity Mix YTD */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">Severity Mix · YTD</span>
        </div>
        <div class="hse-spark-val" style={{ color: 'var(--siomac-navy)' }}>{ytdInc}</div>
        <div class="hse-spark-sub">YTD: {ytdInc} total incidents across all sites</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
          {sevMix.map(s => (
            <div key={s.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginBottom: '3px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                <span style={{ color: s.color, fontWeight: 700 }}>{s.count}</span>
              </div>
              <div style={{ height: '5px', borderRadius: '999px', background: 'var(--bg-subtle, #e2e8f0)' }}>
                <div style={{ width: `${(s.count / 7) * 100}%`, height: '100%', borderRadius: 'inherit', background: s.color }} />
              </div>
            </div>
          ))}
        </div>
        <div class="hse-spark-sub" style={{ marginTop: '8px' }}>OSH Recordables: 3 cases under review</div>
      </div>
    </div>
  );
}

// ── KPI grid ─────────────────────────────────────────────────────────────────

const KPI_ICON: Record<string, string> = {
  'OSH Recordables': 'fa-triangle-exclamation',
  'Lost Time Cases': 'fa-person-walking-arrow-right',
  'HiPo Events':     'fa-bolt',
  'CAPA Closure':    'fa-list-check',
  'HSE Training':    'fa-graduation-cap',
  'PPE Compliance':  'fa-helmet-safety',
};

function KpiGrid({ onOpen }: { onOpen: (d: DrawerData) => void }): VNode {
  return (
    <div class="hse-kpi-grid">
      {mockHseKpis.map(k => (
        <article
          key={k.label}
          class={`hse-kpi-card hse-kpi-card--${k.severity}`}
          onClick={() => onOpen({ title: k.label, subtitle: k.subtitle, rows: DRILL_ROWS(k.value) })}
        >
          <div class="hse-kpi-top">
            <div class={`hse-kpi-icon hse-kpi-icon--${k.severity}`}>
              <i class={`fas ${KPI_ICON[k.label] ?? 'fa-chart-simple'}`} />
            </div>
            <span class="hse-kpi-pill">{k.note}</span>
          </div>
          <div class="hse-kpi-value">{k.value}</div>
          <div class="hse-kpi-label">{k.label}</div>
          <div class="hse-kpi-sub">{k.subtitle}</div>
          <div class={`hse-kpi-accent hse-kpi-accent--${k.severity}`} />
        </article>
      ))}
    </div>
  );
}

// ── Full trend chart ──────────────────────────────────────────────────────────

const T_W = 720, T_H = 200, T_PAD = 24;
type Pt = [number, number, number];

function trendPoints(values: number[], maxValue: number): Pt[] {
  return values.map((v, i) => {
    const x = T_PAD + i * ((T_W - T_PAD * 2) / (values.length - 1));
    const y = T_H - T_PAD - (v / maxValue) * (T_H - T_PAD * 2);
    return [Math.round(x), Math.round(y), v];
  });
}
const linePath = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
const areaPath = (pts: Pt[]) => {
  const first = pts[0], lastPt = pts[pts.length - 1];
  if (!first || !lastPt) return '';
  return `${linePath(pts)} L${lastPt[0]} ${T_H - T_PAD} L${first[0]} ${T_H - T_PAD} Z`;
};

function TrendChart(): VNode {
  const months     = mockTrend.map(t => t.month);
  const incPts     = trendPoints(mockTrend.map(t => t.incidents), 80);
  const nearPts    = trendPoints(mockTrend.map(t => t.nearMisses), 80);
  const closurePts = trendPoints(mockTrend.map(t => t.capaClosure), 100);
  const last = mockTrend[mockTrend.length - 1] ?? { incidents: 0, nearMisses: 0, capaClosure: 0 };

  return (
    <div class="hse-trend-chart">
      <div class="hse-trend-summary">
        <div class="hse-trend-card incident"><span>Incidents</span><strong>{last.incidents}</strong></div>
        <div class="hse-trend-card near"><span>Near Misses</span><strong>{last.nearMisses}</strong></div>
        <div class="hse-trend-card closure"><span>Closure Rate</span><strong>{last.capaClosure}%</strong></div>
      </div>
      <svg class="hse-trend-svg" viewBox={`0 0 ${T_W} ${T_H}`} preserveAspectRatio="none" role="img" aria-label="Safety performance trend">
        {[20, 40, 60, 80].map(pct => {
          const y = T_H - T_PAD - (pct / 100) * (T_H - T_PAD * 2);
          return <line key={pct} x1={T_PAD} y1={y} x2={T_W - T_PAD} y2={y} stroke="var(--border)" stroke-width="1" opacity="0.6" />;
        })}
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
        <span><i style={{ background: 'var(--hse-red)' }} />Incidents</span>
        <span><i style={{ background: 'var(--hse-amber)' }} />Near misses</span>
        <span><i style={{ background: 'var(--hse-green)' }} />CAPA closure</span>
      </div>
    </div>
  );
}

// ── Critical work queue ───────────────────────────────────────────────────────

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

// ── Approvals strip ───────────────────────────────────────────────────────────

function ApprovalsStrip(): VNode {
  const wf      = useWorkflow();
  const pending = wf.state.approvals.filter(a => /pending|in_review/.test(a.status)).length;
  const recent  = wf.state.audit.slice(0, 4);

  return (
    <div class="hse-approvals-strip">
      <div class="hse-approvals-kpis">
        <div class={`hse-appr-tile${pending > 0 ? ' urgent' : ''}`}>
          <i class="fas fa-inbox" />
          <div><strong>{pending}</strong><span>Pending approvals</span></div>
        </div>
        <div class="hse-appr-tile">
          <i class="fas fa-diagram-project" />
          <div><strong>{wf.openCount}</strong><span>Open workflows</span></div>
        </div>
        <div class="hse-appr-tile">
          <i class="fas fa-shield-halved" />
          <div><strong>{wf.state.audit.length}</strong><span>Audit events logged</span></div>
        </div>
        <div class="hse-appr-tile">
          <i class="fas fa-handshake" />
          <div><strong>{wf.state.handoffs.length}</strong><span>Cross-module handoffs</span></div>
        </div>
      </div>
      {pending > 0 && (
        <div class="hse-appr-queue">
          <div class="hse-appr-queue-head"><i class="fas fa-bell" /> Awaiting your decision</div>
          {wf.state.approvals.filter(a => /pending|in_review/.test(a.status)).map(a => (
            <div class="hse-appr-item" key={a.id}>
              <div class="hse-appr-item-icon"><i class="fas fa-file-circle-check" /></div>
              <div class="hse-appr-item-body">
                <strong>{a.title}</strong>
                <span>{a.recordRef} · {a.approverRole}</span>
              </div>
              <div class="hse-appr-item-actions">
                <button class="hse-appr-btn approve" onClick={() => wf.decide(a.id, 'approve', 'Approved via dashboard')}>
                  <i class="fas fa-check" /> Approve
                </button>
                <button class="hse-appr-btn return" onClick={() => wf.decide(a.id, 'return', 'Returned for review')}>
                  <i class="fas fa-rotate-left" /> Return
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div class="hse-audit-feed">
          <div class="hse-appr-queue-head"><i class="fas fa-shield-halved" /> Recent audit events</div>
          {recent.map((ev, i) => (
            <div class="hse-audit-row" key={i}>
              <span class="hse-audit-ts">{new Date(ev.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span class="hse-audit-event">{ev.event}</span>
              <span class="hse-audit-user">{ev.actor}</span>
            </div>
          ))}
        </div>
      )}
      {pending === 0 && recent.length === 0 && (
        <div class="hse-appr-empty">
          <i class="fas fa-circle-check" />
          <span>No pending approvals · Submit an incident, permit, or document to see workflow activity here.</span>
        </div>
      )}
    </div>
  );
}

// ── Site risk card ────────────────────────────────────────────────────────────

function SiteCard({ s, onOpen }: { s: SiteRisk; onOpen: (d: DrawerData) => void }): VNode {
  const color = SEV_COLOR[s.severity] ?? 'var(--hse-blue)';
  return (
    <article class={`hse-site-item hse-site-item--${s.severity}`}
      onClick={() => onOpen({ title: s.site, subtitle: s.detail, rows: DRILL_ROWS(s.level) })}>
      <header>
        <strong>{s.site}</strong>
        <span class={`hse-status-badge ${hseStatusClass(s.level)}`}>{s.level}</span>
      </header>
      <p>{s.detail}</p>
      <div class="hse-progress hse-progress-new">
        <i style={{ width: `${s.score}%`, background: color }} />
      </div>
      <div class="hse-kpi-sub">{s.open} open · {s.overdue} overdue</div>
    </article>
  );
}

// ── Readiness card ────────────────────────────────────────────────────────────

function ReadyCard({ r, onOpen }: { r: ReadinessRow; onOpen: (d: DrawerData) => void }): VNode {
  const pct   = parseInt(r.value, 10) || 0;
  const color = SEV_COLOR[r.severity] ?? 'var(--hse-blue)';
  return (
    <article class={`hse-ready-item hse-ready-item--${r.severity}`}
      onClick={() => onOpen({ title: r.label, subtitle: r.detail, rows: DRILL_ROWS(r.value) })}>
      <header>
        <strong>{r.label}</strong>
        <span class="hse-ready-value" style={{ color }}>{r.value}</span>
      </header>
      <p>{r.detail}</p>
      <div class="hse-progress hse-progress-new">
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
    </article>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function HSEDashboard(): VNode {
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const [search, setSearch] = useState('');
  const [site,   setSite]   = useState('all');
  const [risk,   setRisk]   = useState('all');
  const wf = useWorkflow();
  const open = (d: DrawerData) => setDrawer(d);

  const q = search.toLowerCase().trim();
  const s = site.toLowerCase();
  const r = risk.toLowerCase();
  const match = (text: string) =>
    (!q || text.toLowerCase().includes(q)) &&
    (s === 'all' || text.toLowerCase().includes(s)) &&
    (r === 'all' || text.toLowerCase().includes(r));

  const queue     = useMemo(() => mockQueue.filter(x => match(`${x.title} ${x.detail} ${x.status}`)), [q, s, r]);
  const incidents = useMemo(() => mockHseIncidents.filter(x => match(`${x.ref} ${x.site} ${x.event} ${x.klass} ${x.status} ${x.owner}`)), [q, s, r]);
  const sites     = useMemo(() => mockSiteRisk.filter(x => match(`${x.site} ${x.level} ${x.detail}`)), [q, s, r]);
  const permits   = useMemo(() => mockPermits.filter(x => match(`${x.ref} ${x.site} ${x.gate} ${x.status}`)), [q, s, r]);
  const readiness = useMemo(() => mockReadiness.filter(x => match(`${x.label} ${x.detail}`)), [q, s, r]);

  const pending = wf.state.approvals.filter(a => /pending|in_review/.test(a.status)).length;

  const heroStats = [
    { icon: 'fa-users',                 label: 'Workers & contractors', value: 418,               color: 'blue'  },
    { icon: 'fa-triangle-exclamation',  label: 'Open HSE work',         value: 72,                color: 'gold'  },
    { icon: 'fa-ban',                   label: 'OSH/EMA blockers',      value: 6,                 color: 'red'   },
    { icon: 'fa-id-badge',              label: 'PTW active',            value: 11,                color: 'blue'  },
    { icon: 'fa-inbox',                 label: 'Pending approvals',     value: pending,           color: pending > 0 ? 'gold' : 'green' },
  ];

  return (
    <div class="hse-tab hse-dash">

      {/* Dark hero — same pattern as every other HSE area */}
      <AreaHero
        icon="fa-helmet-safety"
        areaIcon="fa-shield-halved"
        title="HSE Dashboard"
        crumb="Dashboard"
        context={['Trinidad & Tobago Operations', '2026 HSE Programme']}
        badges={[
          { icon: 'fa-calendar',      label: 'Jan – Jun 2026'   },
          { icon: 'fa-location-dot',  label: '5 Active Sites'   },
          { icon: 'fa-gavel',         label: 'OSH Act 2004'     },
          { icon: 'fa-leaf',          label: 'EMA Compliance'   },
        ]}
        stats={heroStats}
        metrics={[
          { label: 'HSE Health Score',       value: `${HSE_HEALTH_SCORE}%`, highlight: HSE_HEALTH_SCORE >= 80 },
          { label: 'LTI-free days',          value: '47',                   highlight: true },
          { label: 'LTIFR (per 200k hrs)',   value: '0.48' },
          { label: 'CAPA closure rate',      value: '87%' },
          { label: 'Avg. response time',     value: '< 30 min' },
        ]}
      />

      {/* Filter + search bar */}
      <div class="hse-filter-bar">
        <div class="hse-live-pulse">
          <span class="hse-live-dot" />
          <span>Live</span>
        </div>
        <label class="hse-search-box" style={{ flex: '1 1 220px' }}>
          <i class="fas fa-search" />
          <input value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search records, sites, owners…" />
        </label>
        <select class="hse-filter-sel" value={site} onChange={e => setSite((e.target as HTMLSelectElement).value)}>
          <option value="all">All T&amp;T sites</option>
          {HSE_SITE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select class="hse-filter-sel">
          {HSE_PERIOD_OPTIONS.map(o => <option key={o}>{o}</option>)}
        </select>
        <select class="hse-filter-sel" value={risk} onChange={e => setRisk((e.target as HTMLSelectElement).value)}>
          <option value="all">All risk levels</option>
          {HSE_RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select class="hse-filter-sel">
          <option>All owners</option>
          {HSE_OWNER_OPTIONS.map(o => <option key={o}>{o}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <KpiGrid onOpen={open} />

      {/* Trend strip (4 sparkline panels) */}
      <TrendStrip />

      {/* Live workflow / approvals */}
      <ApprovalsStrip />

      {/* Trend chart + critical work queue */}
      <div class="hse-perf-grid">
        <article class="hse-card">
          <div class="hse-card-head">
            <h3><i class="fas fa-chart-column" /> Safety Performance Trend</h3>
            <span>Incidents, near misses, CAPA closure</span>
          </div>
          <div class="hse-card-body"><TrendChart /></div>
        </article>
        <aside class="hse-card hse-queue-card">
          <div class="hse-card-head">
            <h3><i class="fas fa-bell" /> Critical Work Queue</h3>
            <span>Escalate today</span>
          </div>
          <div class="hse-card-body hse-queue-list">
            {queue.map(x => <QueueCard key={x.title} q={x} onOpen={open} />)}
          </div>
        </aside>
      </div>

      {/* Recent incidents register */}
      <section class="hse-card hse-incident-register">
        <div class="hse-card-head">
          <h3><i class="fas fa-clipboard-list" /> Recent Incidents</h3>
          <span>OSH recordables, near misses, environmental events</span>
        </div>
        <div class="hse-table-scroll">
          <table class="hse-data-table hse-incident-table">
            <thead><tr><th>Record</th><th>Site</th><th>Event</th><th>Class</th><th>Status</th><th>Owner</th></tr></thead>
            <tbody>
              {incidents.length === 0
                ? <tr><td colspan={6} class="hse-empty">No incidents match.</td></tr>
                : incidents.map(i => (
                  <tr key={i.ref} onClick={() => open({ title: `${i.ref} ${i.klass}`, subtitle: i.event, rows: DRILL_ROWS(i.status) })}>
                    <td class="hse-rec-cell"><strong>{i.ref}</strong><span>{i.date}</span></td>
                    <td>{i.site}</td>
                    <td class="hse-event-cell">{i.event}<span class="hse-incident-detail">{i.action}</span></td>
                    <td><span class={`hse-record-pill ${hseStatusClass(i.status)}`}><i />{i.klass}</span></td>
                    <td><span class={`hse-status-badge ${hseStatusClass(i.status)}`}>{i.status}</span></td>
                    <td class="hse-muted">{i.owner}</td>
                  </tr>
                ))}
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
