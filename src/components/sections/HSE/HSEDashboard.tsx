/**
 * src/components/sections/HSE/HSEDashboard.tsx
 *
 * HSE Dashboard — T&T command view.
 * Layout: AreaHero (dark) → spark-row → approvals strip → chart+queue → incidents → bottom grid
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useWorkflow } from '@lib/workflow';
import { AreaHero } from './_shared';
import {
  mockTrend, mockQueue,
  mockHseIncidents, mockSiteRisk, mockPermits, mockReadiness,
  HSE_HEALTH_SCORE,
  hseStatusClass, splitSiteDetail,
  HSE_SITE_OPTIONS, HSE_PERIOD_OPTIONS, HSE_RISK_OPTIONS, HSE_OWNER_OPTIONS,
  type Permit, type QueueItem, type ReadinessRow, type SiteRisk,
} from './types';

// ── Colour tokens ─────────────────────────────────────────────────────────────

const C = {
  red:   'var(--hse-red)',
  amber: 'var(--hse-amber)',
  green: 'var(--hse-green)',
  blue:  'var(--hse-blue)',
};

// ── Drilldown drawer ──────────────────────────────────────────────────────────

interface DD { title: string; subtitle: string; rows: [string, string][]; }

function Drawer({ data, onClose }: { data: DD | null; onClose: () => void }): VNode {
  return (
    <>
      <div class={`hse-drawer-backdrop${data ? ' show' : ''}`} onClick={onClose} />
      <aside class={`hse-drawer${data ? ' show' : ''}`} role="dialog" aria-modal="true" aria-hidden={!data}>
        <div class="hse-drawer-head">
          <div><h3>{data?.title ?? ''}</h3><p>{data?.subtitle ?? ''}</p></div>
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

const drillRows = (value: string): [string, string][] => [
  ['Current value',  value],
  ['Owner',          'HSE / Site Manager'],
  ['Evidence',       'OSH log, PTW, EMA/CEC file, contractor records'],
  ['Next action',    'Review controls, attach evidence, assign owner'],
];

// ── Tiny sparkline helpers ────────────────────────────────────────────────────

const SW = 110, SH = 30;
function sparkPath(vals: number[], close = false): string {
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * SW},${SH - 3 - (v / max) * (SH - 6)}`);
  if (close) return `M0,${SH} L${pts.join(' L')} L${SW},${SH} Z`;
  return `M${pts.join(' L')}`;
}
function sparkDot(vals: number[], color: string): VNode {
  const max  = Math.max(...vals, 1);
  const i    = vals.length - 1;
  const v    = vals[i]!;
  const cx   = SW;
  const cy   = SH - 3 - (v / max) * (SH - 6);
  return <circle cx={cx} cy={cy} r="3.5" fill={color} stroke="var(--bg-card)" stroke-width="1.5" />;
}

function DeltaChip({ d, goodDown = false }: { d: number; goodDown?: boolean }): VNode {
  const good = goodDown ? d <= 0 : d >= 0;
  const cls  = d === 0 ? 'flat' : (goodDown ? (d < 0 ? 'down' : 'up') : (d > 0 ? 'down' : 'up'));
  return (
    <span class={`hse-spark-delta ${cls}`}>
      <i class={`fas ${d === 0 ? 'fa-minus' : d < 0 ? 'fa-arrow-down' : 'fa-arrow-up'}`} />
      {Math.abs(d)}
    </span>
  );
}

// ── Unified spark-row (KPIs + trends in one strip) ────────────────────────────

function SparkRow(): VNode {
  const pts    = mockTrend;
  const last   = pts[pts.length - 1]!;
  const prev   = pts[pts.length - 2]!;
  const months = pts.map(p => p.month);
  const iVals  = pts.map(p => p.incidents);
  const nVals  = pts.map(p => p.nearMisses);
  const cVals  = pts.map(p => p.capaClosure);
  const ytd    = pts.reduce((s, p) => s + p.incidents, 0);

  const sevMix = [
    { label: 'Critical / High', count: 3, color: C.red   },
    { label: 'Medium',          count: 2, color: C.amber  },
    { label: 'Low',             count: 2, color: C.green  },
  ];

  return (
    <div class="hse-spark-row">

      {/* 1 — Incidents MTD */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">Incidents MTD</span>
          <DeltaChip d={last.incidents - prev.incidents} goodDown />
        </div>
        <div class="hse-spark-val" style={{ color: C.red }}>{last.incidents}</div>
        <div class="hse-spark-sub">YTD: {ytd} · Target ≤3/mo</div>
        <svg viewBox={`0 0 ${SW} ${SH}`} width={SW} height={SH} style={{ marginTop: 8, overflow: 'visible', display: 'block' }}>
          <path d={sparkPath(iVals, true)} fill="rgba(228,12,12,.08)" />
          <path d={sparkPath(iVals)} fill="none" stroke={C.red} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          {sparkDot(iVals, C.red)}
        </svg>
        <div class="hse-spark-months">{months.map(m => <span key={m}>{m}</span>)}</div>
      </div>

      {/* 2 — Near Misses MTD */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">Near Misses MTD</span>
          <DeltaChip d={last.nearMisses - prev.nearMisses} />
        </div>
        <div class="hse-spark-val" style={{ color: C.amber }}>{last.nearMisses}</div>
        <div class="hse-spark-sub">Near misses should exceed incidents</div>
        <svg viewBox={`0 0 ${SW} ${SH}`} width={SW} height={SH} style={{ marginTop: 8, overflow: 'visible', display: 'block' }}>
          <path d={sparkPath(nVals, true)} fill="rgba(245,158,11,.08)" />
          <path d={sparkPath(nVals)} fill="none" stroke={C.amber} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          {sparkDot(nVals, C.amber)}
        </svg>
        <div class="hse-spark-months">{months.map(m => <span key={m}>{m}</span>)}</div>
      </div>

      {/* 3 — CAPA Closure */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">CAPA Closure</span>
          <DeltaChip d={last.capaClosure - prev.capaClosure} />
        </div>
        <div class="hse-spark-val" style={{ color: last.capaClosure >= 90 ? C.green : C.amber }}>
          {last.capaClosure}%
        </div>
        <div class="hse-spark-sub">
          Target 95% · {last.capaClosure >= 95 ? 'On target' : `${95 - last.capaClosure}% below target`}
        </div>
        <div class="hse-spark-bar-track" style={{ marginTop: 10 }}>
          <div class="hse-spark-bar-fill"
            style={{ width: `${last.capaClosure}%`, background: last.capaClosure >= 90 ? C.green : C.amber }} />
        </div>
        <div style={{ position: 'relative', height: 14, marginTop: 2 }}>
          <div style={{ position: 'absolute', left: '95%', top: 0, width: 1.5, height: 8, background: C.red }} />
          <span style={{ position: 'absolute', left: 'calc(95% + 3px)', top: 1, fontSize: '0.55rem', color: C.red, fontWeight: 700 }}>95%</span>
        </div>
        <div class="hse-spark-months">{months.map(m => <span key={m}>{m}</span>)}</div>
      </div>

      {/* 4 — Severity Mix YTD */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">Severity Mix · YTD</span>
        </div>
        <div class="hse-spark-val" style={{ color: 'var(--siomac-navy)' }}>{ytd}</div>
        <div class="hse-spark-sub">Total incidents across all T&T sites</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
          {sevMix.map(s => (
            <div key={s.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginBottom: 2 }}>
                <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                <span style={{ color: s.color, fontWeight: 700 }}>{s.count}</span>
              </div>
              <div style={{ height: 4, borderRadius: 999, background: 'var(--bg-subtle, #e2e8f0)' }}>
                <div style={{ width: `${(s.count / 7) * 100}%`, height: '100%', borderRadius: 'inherit', background: s.color }} />
              </div>
            </div>
          ))}
        </div>
        <div class="hse-spark-sub" style={{ marginTop: 6 }}>OSH Recordables: 3 under review</div>
      </div>

    </div>
  );
}

// ── Approvals strip ───────────────────────────────────────────────────────────

function ApprovalsStrip(): VNode {
  const wf      = useWorkflow();
  const pending = wf.state.approvals.filter(a => /pending|in_review/.test(a.status));
  const recent  = wf.state.audit.slice(0, 4);

  return (
    <div class="hse-approvals-strip">
      <div class="hse-approvals-kpis">
        <div class={`hse-appr-tile${pending.length > 0 ? ' urgent' : ''}`}>
          <i class="fas fa-inbox" />
          <div><strong>{pending.length}</strong><span>Pending approvals</span></div>
        </div>
        <div class="hse-appr-tile">
          <i class="fas fa-diagram-project" />
          <div><strong>{wf.openCount}</strong><span>Open workflows</span></div>
        </div>
        <div class="hse-appr-tile">
          <i class="fas fa-shield-halved" />
          <div><strong>{wf.state.audit.length}</strong><span>Audit events</span></div>
        </div>
        <div class="hse-appr-tile">
          <i class="fas fa-handshake" />
          <div><strong>{wf.state.handoffs.length}</strong><span>Handoffs</span></div>
        </div>
      </div>

      {pending.length > 0 && (
        <div class="hse-appr-queue">
          <div class="hse-appr-queue-head"><i class="fas fa-bell" /> Awaiting your decision</div>
          {pending.map(a => (
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

      {pending.length === 0 && recent.length === 0 && (
        <div class="hse-appr-empty">
          <i class="fas fa-circle-check" />
          <span>No pending approvals · Submit an incident, permit, or document to create workflow activity.</span>
        </div>
      )}
    </div>
  );
}

// ── Trend chart (full SVG) ────────────────────────────────────────────────────

const T_W = 720, T_H = 200, T_PAD = 24;
type Pt = [number, number, number];
function tPts(vals: number[], max: number): Pt[] {
  return vals.map((v, i) => [
    Math.round(T_PAD + i * ((T_W - T_PAD * 2) / (vals.length - 1))),
    Math.round(T_H - T_PAD - (v / max) * (T_H - T_PAD * 2)),
    v,
  ]);
}
const lPath = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
const aPath = (pts: Pt[]) => {
  const f = pts[0], l = pts[pts.length - 1];
  if (!f || !l) return '';
  return `${lPath(pts)} L${l[0]} ${T_H - T_PAD} L${f[0]} ${T_H - T_PAD} Z`;
};

function TrendChart(): VNode {
  const months  = mockTrend.map(t => t.month);
  const incPts  = tPts(mockTrend.map(t => t.incidents),   80);
  const nearPts = tPts(mockTrend.map(t => t.nearMisses),  80);
  const closPts = tPts(mockTrend.map(t => t.capaClosure), 100);
  const last    = mockTrend[mockTrend.length - 1] ?? { incidents: 0, nearMisses: 0, capaClosure: 0 };

  return (
    <div class="hse-trend-chart">
      <div class="hse-trend-summary">
        <div class="hse-trend-card incident"><span>Incidents</span><strong style={{ color: C.red }}>{last.incidents}</strong></div>
        <div class="hse-trend-card near"><span>Near Misses</span><strong style={{ color: C.amber }}>{last.nearMisses}</strong></div>
        <div class="hse-trend-card closure"><span>CAPA Closure</span><strong style={{ color: C.green }}>{last.capaClosure}%</strong></div>
      </div>
      <svg class="hse-trend-svg" viewBox={`0 0 ${T_W} ${T_H}`} preserveAspectRatio="none" role="img" aria-label="Safety trend">
        {[20, 40, 60, 80].map(pct => {
          const y = T_H - T_PAD - (pct / 100) * (T_H - T_PAD * 2);
          return <line key={pct} x1={T_PAD} y1={y} x2={T_W - T_PAD} y2={y} stroke="var(--border)" stroke-width="1" opacity="0.5" />;
        })}
        <path class="area-near"      d={aPath(nearPts)} />
        <path class="area-incidents" d={aPath(incPts)} />
        <path class="line-near"      d={lPath(nearPts)} />
        <path class="line-incidents" d={lPath(incPts)} />
        <path class="line-closure"   d={lPath(closPts)} />
        {incPts.map( (p, i) => <circle key={`i${i}`} cx={p[0]} cy={p[1]} r={4} class="dot-incidents"><title>{months[i]} incidents: {p[2]}</title></circle>)}
        {nearPts.map((p, i) => <circle key={`n${i}`} cx={p[0]} cy={p[1]} r={4} class="dot-near"><title>{months[i]} near misses: {p[2]}</title></circle>)}
        {closPts.map((p, i) => <circle key={`c${i}`} cx={p[0]} cy={p[1]} r={4} class="dot-closure"><title>{months[i]} closure: {p[2]}%</title></circle>)}
      </svg>
      <div class="hse-trend-axis">{months.map(m => <span key={m}>{m}</span>)}</div>
      <div class="hse-legend">
        <span><i style={{ background: C.red }}   />Incidents</span>
        <span><i style={{ background: C.amber }} />Near misses</span>
        <span><i style={{ background: C.green }} />CAPA closure</span>
      </div>
    </div>
  );
}

// ── Critical work queue ───────────────────────────────────────────────────────

function QueueCard({ q, onOpen }: { q: QueueItem; onOpen: (d: DD) => void }): VNode {
  const { site, detail } = splitSiteDetail(q.detail);
  return (
    <article class={`hse-queue-item hse-queue-item--${q.severity}`}
      onClick={() => onOpen({ title: q.title, subtitle: q.detail, rows: drillRows(q.status) })}>
      <header>
        <div><strong>{q.title}</strong><p>{detail}</p></div>
        <span class={`hse-status-badge ${hseStatusClass(q.status)}`}>{q.status}</span>
      </header>
      <div class="hse-queue-meta">
        <span><i class="fas fa-location-dot" />{site}</span>
        <span><i class="fas fa-clock" />{q.status === 'Pending' ? '7 days' : 'Today'}</span>
      </div>
    </article>
  );
}

// ── Site risk card ────────────────────────────────────────────────────────────

function SiteCard({ s, onOpen }: { s: SiteRisk; onOpen: (d: DD) => void }): VNode {
  const col = s.severity === 'danger' ? C.red : s.severity === 'warning' ? C.amber : C.green;
  return (
    <article class={`hse-site-item hse-site-item--${s.severity}`}
      onClick={() => onOpen({ title: s.site, subtitle: s.detail, rows: drillRows(s.level) })}>
      <header>
        <strong>{s.site}</strong>
        <span class={`hse-status-badge ${hseStatusClass(s.level)}`}>{s.level}</span>
      </header>
      <p>{s.detail}</p>
      <div class="hse-progress"><i style={{ width: `${s.score}%`, background: col }} /></div>
      <div class="hse-kpi-sub">{s.open} open · {s.overdue} overdue</div>
    </article>
  );
}

// ── Readiness card ────────────────────────────────────────────────────────────

function ReadyCard({ r, onOpen }: { r: ReadinessRow; onOpen: (d: DD) => void }): VNode {
  const pct = parseInt(r.value, 10) || 0;
  const col = r.severity === 'danger' ? C.red : r.severity === 'warning' ? C.amber : r.severity === 'success' ? C.green : C.blue;
  return (
    <article class={`hse-ready-item hse-ready-item--${r.severity}`}
      onClick={() => onOpen({ title: r.label, subtitle: r.detail, rows: drillRows(r.value) })}>
      <header>
        <strong>{r.label}</strong>
        <span class="hse-ready-value" style={{ color: col }}>{r.value}</span>
      </header>
      <p>{r.detail}</p>
      <div class="hse-progress"><i style={{ width: `${pct}%`, background: col }} /></div>
    </article>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function HSEDashboard(): VNode {
  const [drawer, setDrawer] = useState<DD | null>(null);
  const [search, setSearch] = useState('');
  const [site,   setSite]   = useState('all');
  const [risk,   setRisk]   = useState('all');
  const wf = useWorkflow();

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

  const pendingCount = wf.state.approvals.filter(a => /pending|in_review/.test(a.status)).length;

  return (
    <div class="hse-tab hse-dash">

      {/* Dark area hero */}
      <AreaHero
        icon="fa-helmet-safety"
        areaIcon="fa-shield-halved"
        title="HSE Dashboard"
        crumb="Dashboard"
        context={['Trinidad & Tobago Operations', '2026 HSE Programme']}
        badges={[
          { icon: 'fa-calendar',     label: 'Jan – Jun 2026' },
          { icon: 'fa-location-dot', label: '5 Active Sites' },
          { icon: 'fa-gavel',        label: 'OSH Act 2004'   },
          { icon: 'fa-leaf',         label: 'EMA Compliance' },
        ]}
        stats={[
          { icon: 'fa-users',                label: 'Workers & contractors', value: 418,          color: 'blue'  },
          { icon: 'fa-triangle-exclamation', label: 'Open HSE work',         value: 72,           color: 'gold'  },
          { icon: 'fa-ban',                  label: 'OSH/EMA blockers',      value: 6,            color: 'red'   },
          { icon: 'fa-id-badge',             label: 'PTW active',            value: 11,           color: 'blue'  },
          { icon: 'fa-inbox',                label: 'Pending approvals',     value: pendingCount, color: pendingCount > 0 ? 'gold' : 'green' },
        ]}
        metrics={[
          { label: 'HSE Health Score',     value: `${HSE_HEALTH_SCORE}%`, highlight: HSE_HEALTH_SCORE >= 80 },
          { label: 'LTI-free days',        value: '47',                   highlight: true },
          { label: 'LTIFR (per 200k hrs)', value: '0.48' },
          { label: 'CAPA closure',         value: '87%' },
          { label: 'Avg. response',        value: '< 30 min' },
        ]}
      />

      {/* Filter bar */}
      <div class="hse-filter-bar">
        <div class="hse-live-pulse"><span class="hse-live-dot" /><span>Live</span></div>
        <label class="hse-search-box" style={{ flex: '1 1 200px' }}>
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

      {/* Unified spark-row — KPIs + sparklines in one strip */}
      <SparkRow />

      {/* Workflow approvals */}
      <ApprovalsStrip />

      {/* Trend chart + critical queue */}
      <div class="hse-perf-grid">
        <article class="hse-card">
          <div class="hse-card-head">
            <h3><i class="fas fa-chart-line" /> Safety Performance Trend</h3>
            <span>Jan – Jun 2026</span>
          </div>
          <div class="hse-card-body"><TrendChart /></div>
        </article>
        <aside class="hse-card">
          <div class="hse-card-head">
            <h3><i class="fas fa-circle-exclamation" /> Critical Work Queue</h3>
            <span>Escalate today</span>
          </div>
          <div class="hse-card-body hse-queue-list">
            {queue.length === 0
              ? <div class="hse-appr-empty"><i class="fas fa-circle-check" /><span>No critical items.</span></div>
              : queue.map(x => <QueueCard key={x.title} q={x} onOpen={d => setDrawer(d)} />)}
          </div>
        </aside>
      </div>

      {/* Recent incidents register */}
      <section class="hse-card">
        <div class="hse-card-head">
          <h3><i class="fas fa-clipboard-list" /> Recent Incidents</h3>
          <span>OSH recordables, near misses, environmental events</span>
        </div>
        <div class="hse-table-scroll">
          <table class="hse-data-table">
            <thead>
              <tr><th>Record</th><th>Site</th><th>Event</th><th>Class</th><th>Status</th><th>Owner</th></tr>
            </thead>
            <tbody>
              {incidents.length === 0
                ? <tr><td colspan={6} class="hse-empty">No incidents match filter.</td></tr>
                : incidents.map(i => (
                  <tr key={i.ref} onClick={() => setDrawer({ title: `${i.ref} · ${i.klass}`, subtitle: i.event, rows: drillRows(i.status) })}>
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

      {/* Bottom grid — site risk / permits / readiness */}
      <div class="hse-bottom-grid">
        <article class="hse-card">
          <div class="hse-card-head"><h3><i class="fas fa-location-dot" /> Site Risk</h3><span>T&T locations</span></div>
          <div class="hse-card-body hse-site-list">
            {sites.map(x => <SiteCard key={x.site} s={x} onOpen={d => setDrawer(d)} />)}
          </div>
        </article>
        <article class="hse-card">
          <div class="hse-card-head"><h3><i class="fas fa-id-badge" /> Active Permits</h3><span>PTW control gates</span></div>
          <div class="hse-table-scroll">
            <table class="hse-data-table">
              <thead><tr><th>Permit</th><th>Site</th><th>Control Gate</th><th>Status</th></tr></thead>
              <tbody>
                {permits.map((p: Permit) => (
                  <tr key={p.ref} onClick={() => setDrawer({ title: p.ref, subtitle: p.gate, rows: drillRows(p.status) })}>
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
          <div class="hse-card-head"><h3><i class="fas fa-user-check" /> Readiness</h3><span>Controls health</span></div>
          <div class="hse-card-body hse-ready-list">
            {readiness.map(x => <ReadyCard key={x.label} r={x} onOpen={d => setDrawer(d)} />)}
          </div>
        </article>
      </div>

      <Drawer data={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
