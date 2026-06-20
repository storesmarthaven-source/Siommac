/**
 * src/components/sections/HSE/HSEDashboard.tsx
 *
 * HSE Dashboard — ERP-style 5-layer T&T command view.
 *
 *  Layer 1 — Command KPIs (dark navy hero, calculated from module data)
 *  Layer 2 — Alerts & Approvals (escalation list + workflow inbox)
 *  Layer 3 — Module Health (rich horizontal rows: status · metric · progress · alerts · counts)
 *  Layer 4 — Analytics (safety trend line chart + open-actions donut)
 *  Layer 5 — Site Intelligence (per-site risk table)
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useWorkflow } from '@lib/workflow';
import { AreaHero } from './_shared';
import {
  mockHseKpis, mockTrend, mockQueue,
  mockHseIncidents, mockSiteRisk, mockPermits, mockReadiness,
  mockIncidents, mockCapa, mockPermitRows, mockInspections, mockFindings,
  mockCertifications, mockToolboxTalks, mockHseDocs, mockSds, mockPpeItems,
  HSE_HEALTH_SCORE,
  hseStatusClass, splitSiteDetail, riskRating,
  HSE_SITE_OPTIONS, HSE_PERIOD_OPTIONS, HSE_RISK_OPTIONS, HSE_OWNER_OPTIONS,
  type Permit, type QueueItem, type SiteRisk, type ReadinessRow,
} from './types';

// ── colour tokens ──────────────────────────────────────────────────────────────

const C = {
  red:   'var(--hse-red)',
  amber: 'var(--hse-amber)',
  green: 'var(--hse-green)',
  blue:  'var(--hse-blue)',
  navy:  '#1b2d54',
};

// ── drilldown drawer ───────────────────────────────────────────────────────────

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

const drill = (value: string): [string, string][] => [
  ['Current value', value],
  ['Owner',         'HSE / Site Manager'],
  ['Evidence',      'OSH log, PTW, EMA/CEC file, contractor records'],
  ['Next action',   'Review controls, attach evidence, assign owner'],
];

// ── SVG donut ring ─────────────────────────────────────────────────────────────

function DonutRing({ pct, color, trackColor, size = 52 }: {
  pct: number; color: string; trackColor: string; size?: number;
}): VNode {
  const r    = (size - 7) / 2;
  const cx   = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const off  = circ * 0.25;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={trackColor} stroke-width="5.5" />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} stroke-width="5.5"
        stroke-dasharray={`${dash} ${circ - dash}`}
        stroke-dashoffset={off}
        stroke-linecap="round"
      />
      <text x={cx} y={cx + 4} text-anchor="middle" font-size="11" font-weight="700" fill={color}>
        {pct}%
      </text>
    </svg>
  );
}

// ── bar sparkline ──────────────────────────────────────────────────────────────

function BarSpark({ vals, color }: { vals: number[]; color: string }): VNode {
  const max    = Math.max(...vals, 1);
  const maxIdx = vals.indexOf(Math.max(...vals));
  return (
    <div class="hse-bar-spark">
      {vals.map((v, i) => (
        <span key={i} style={{
          height:     `${Math.max(20, (v / max) * 100)}%`,
          background: i === maxIdx ? color : 'var(--hse-spark-bar-base)',
          borderRadius: '3px 3px 0 0', flex: 1,
        }} />
      ))}
    </div>
  );
}

// ── Dropify KPI card anatomy ───────────────────────────────────────────────────

const KPI_TRENDS: Record<string, number[]> = {
  'OSH Recordables': [1, 2, 3, 2, 3, 3],
  'Lost Time Cases': [0, 1, 0, 1, 0, 1],
  'HiPo Events':     [2, 3, 4, 3, 4, 4],
  'CAPA Closure':    [72, 78, 74, 81, 88, 87],
  'HSE Training':    [88, 90, 91, 92, 93, 94],
  'PPE Compliance':  [88, 90, 89, 91, 90, 91],
};

const KPI_ICON: Record<string, string> = {
  'OSH Recordables': 'fa-triangle-exclamation',
  'Lost Time Cases': 'fa-person-walking-arrow-right',
  'HiPo Events':     'fa-bolt',
  'CAPA Closure':    'fa-list-check',
  'HSE Training':    'fa-graduation-cap',
  'PPE Compliance':  'fa-helmet-safety',
};

const SEV_TINT: Record<string, { bg: string; text: string; track: string }> = {
  danger:  { bg: 'var(--hse-red-tint)',   text: 'var(--hse-red)',   track: 'var(--hse-red-tint)'   },
  warning: { bg: 'var(--hse-amber-tint)', text: 'var(--hse-amber)', track: 'var(--hse-amber-tint)' },
  success: { bg: 'var(--hse-green-tint)', text: 'var(--hse-green)', track: 'var(--hse-green-tint)' },
  info:    { bg: 'var(--hse-blue-tint)',  text: 'var(--hse-blue)',  track: 'var(--hse-blue-tint)'  },
};

function deltaChip(vals: number[], goodDown = false): VNode | null {
  if (vals.length < 2) return null;
  const d = vals[vals.length - 1]! - vals[vals.length - 2]!;
  if (d === 0) return null;
  const isGood = goodDown ? d < 0 : d > 0;
  return (
    <span class={`hse-delta-chip ${isGood ? 'good' : 'bad'}`}>
      <i class={`fas ${d < 0 ? 'fa-arrow-down' : 'fa-arrow-up'}`} />
      {Math.abs(d)}{vals[0]! > 10 ? '%' : ''}
    </span>
  );
}

function KpiRow({ onOpen, wf }: { onOpen: (d: DD) => void; wf: ReturnType<typeof useWorkflow> }): VNode {
  const pendingApprovals = wf.state.approvals.filter(a => /pending|in_review/.test(a.status)).length;
  const kpis = mockHseKpis.map(k => {
    if (k.label === 'CAPA Closure')   return { ...k, note: `Target 95% · ${pendingApprovals} pending approvals` };
    if (k.label === 'PPE Compliance') return { ...k, note: `${wf.openCount} workflows open` };
    return k;
  });
  return (
    <div class="hse-kpi-row">
      {kpis.map(k => {
        const tint  = SEV_TINT[k.severity] ?? SEV_TINT.info!;
        const col   = tint.text;
        const isPct = k.value.includes('%');
        const pct   = isPct ? parseInt(k.value, 10) : 0;
        const tvals = KPI_TRENDS[k.label] ?? [0];
        const isDown = k.severity === 'danger';
        return (
          <article key={k.label} class="hse-kpi-card"
            onClick={() => onOpen({ title: k.label, subtitle: k.subtitle, rows: drill(k.value) })}>
            <div class="hse-kpi-top-row">
              <span class="hse-kpi-label">{k.label}</span>
              <div class="hse-kpi-icon-circle" style={{ background: tint.bg, color: col }}>
                <i class={`fas ${KPI_ICON[k.label] ?? 'fa-chart-simple'}`} />
              </div>
            </div>
            <div class="hse-kpi-value-row">
              {isPct
                ? <DonutRing pct={pct} color={col} trackColor={tint.track} size={52} />
                : <div class="hse-kpi-big" style={{ color: col }}>{k.value}</div>
              }
              {deltaChip(tvals, isDown)}
            </div>
            <div class="hse-kpi-note">{k.note}</div>
            {!isPct
              ? <BarSpark vals={tvals} color={col} />
              : <div class="hse-kpi-track"><div class="hse-kpi-track-fill" style={{ width: `${pct}%`, background: col }} /></div>
            }
          </article>
        );
      })}
    </div>
  );
}

// ── Layer 2: Alerts & Approvals ────────────────────────────────────────────────

interface AlertItem {
  severity: 'red' | 'amber' | 'blue';
  title: string;
  sub: string;
  chip: string;
  chipClass: 'chip-red' | 'chip-amb' | 'chip-blue';
}

const ESCALATION_ALERTS: AlertItem[] = [
  { severity: 'red',   title: 'Diesel spill · EMA notification overdue',              sub: 'INC-2026-041 · Point Lisas Plant · HSE Lead',       chip: 'Overdue',  chipClass: 'chip-red' },
  { severity: 'red',   title: 'PTW-0032 hot work permit expired at 16:00',            sub: 'Point Lisas Plant · T. Baptiste',                    chip: 'Blocked',  chipClass: 'chip-red' },
  { severity: 'amber', title: 'CA-303 cut-resistant gloves — 3 days overdue',         sub: 'CAPA · La Brea Yard · L. Ramnarine',                 chip: 'Overdue',  chipClass: 'chip-amb' },
  { severity: 'amber', title: 'INSP-203 housekeeping audit overdue',                  sub: 'Piarco Logistics · L. Ramnarine',                    chip: 'Overdue',  chipClass: 'chip-amb' },
  { severity: 'amber', title: 'CERT-1103 First Aid — Andre Williams expired',         sub: 'Training · Point Lisas Plant',                       chip: 'Expired',  chipClass: 'chip-amb' },
  { severity: 'blue',  title: 'DOC-HSE-0205 Emergency Response Plan — review due',   sub: 'Documents · Review date: 30 Jun 2026',               chip: 'Due soon', chipClass: 'chip-blue' },
];

function AlertsLayer({ wf, onOpen }: { wf: ReturnType<typeof useWorkflow>; onOpen: (d: DD) => void }): VNode {
  const pending = wf.state.approvals.filter(a => /pending|in_review/.test(a.status));
  const recent  = wf.state.audit.slice(0, 5);

  return (
    <div class="hse-alerts-grid">
      {/* escalation panel */}
      <div class="hse-alert-panel">
        <div class="hse-alert-panel-head">
          <i class="fas fa-triangle-exclamation" style={{ color: C.red }} />
          <span class="hse-alert-panel-title">Escalations — needs action today</span>
          <span class="hse-panel-count hse-panel-count--red">{ESCALATION_ALERTS.filter(a => a.severity === 'red').length} critical</span>
        </div>
        {ESCALATION_ALERTS.map((a, i) => (
          <div class="hse-alert-row" key={i}
            onClick={() => onOpen({ title: a.title, subtitle: a.sub, rows: drill(a.chip) })}>
            <div class={`hse-alert-bar hse-alert-bar--${a.severity}`} />
            <div>
              <div class="hse-alert-title">{a.title}</div>
              <div class="hse-alert-sub">{a.sub}</div>
            </div>
            <span class={`hse-alert-chip ${a.chipClass}`}>{a.chip}</span>
          </div>
        ))}
      </div>

      {/* approvals inbox — ppe-signals-panel style */}
      <aside class="ppe-signals-panel hse-appr-signals">
        <h4><i class="fas fa-inbox" /> Approvals inbox
          {pending.length > 0 && <span class="hse-appr-count-badge">{pending.length}</span>}
        </h4>
        <div class="ppe-signals-list">
          {pending.length === 0 ? (
            <div class="ppe-signal">
              <i class="fas fa-circle-check is-ok" />
              <div class="ppe-signal-text"><strong>All clear</strong><span>No pending approvals.</span></div>
            </div>
          ) : pending.map(a => (
            <div class="ppe-signal" key={a.id}>
              <i class="fas fa-file-circle-check is-info" />
              <div class="ppe-signal-text">
                <strong>{a.title}</strong>
                <span>{a.recordRef} · {a.approverRole}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                <button class="hse-appr-inline-btn hse-appr-inline-btn--ok"
                  onClick={e => { e.stopPropagation(); wf.decide(a.id, 'approve', 'Approved via dashboard'); }}>
                  Approve
                </button>
                <button class="hse-appr-inline-btn hse-appr-inline-btn--ret"
                  onClick={e => { e.stopPropagation(); wf.decide(a.id, 'return', 'Returned for review'); }}>
                  Return
                </button>
              </div>
            </div>
          ))}
        </div>
        {recent.length > 0 && (
          <>
            <div class="hse-panel-divider" />
            <h4><i class="fas fa-shield-halved" /> Recent audit</h4>
            <div class="ppe-signals-list">
              {recent.slice(0, 4).map((ev, i) => (
                <div class="ppe-signal" key={i}>
                  <i class="fas fa-clock-rotate-left is-info" />
                  <div class="ppe-signal-text">
                    <strong>{ev.event}</strong>
                    <span>{ev.actor} · {new Date(ev.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div class="hse-panel-divider" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span class="ppe-signal-tag is-info">{wf.openCount} workflows</span>
          <span class="ppe-signal-tag">{wf.state.audit.length} audit events</span>
          <span class="ppe-signal-tag">{wf.state.handoffs.length} handoffs</span>
        </div>
      </aside>
    </div>
  );
}

// ── Layer 3: Module Health Rows ────────────────────────────────────────────────

interface ModAlertItem { color: 'red' | 'amber' | 'blue'; text: string; ref: string; }
interface ModStat      { label: string; value: string | number; color?: string; }
interface ProgItem     { label: string; pct: number; color: string; valueLabel: string; }

interface ModuleHealthProps {
  icon:    string;
  iconBg:  string;
  iconCol: string;
  name:    string;
  desc:    string;
  statusLabel: string;
  statusClass: 'sp-crit' | 'sp-warn' | 'sp-ok' | 'sp-info';
  headlineLabel: string;
  headlineVal: string | number;
  headlineColor: string;
  headlineSub: string;
  headlineDelta?: { dir: 'up' | 'down' | 'flat'; label: string; good: boolean };
  progress: ProgItem[];
  alerts: ModAlertItem[];
  stats: ModStat[];
  openLabel: string;
  onOpen?: () => void;
}

function ModuleHealthRow(p: ModuleHealthProps): VNode {
  return (
    <div class="hse-mod-row">
      {/* identity strip */}
      <div class="hse-mod-id">
        <div>
          <div class="hse-mod-id-top">
            <div class="hse-mod-icon" style={{ background: p.iconBg, color: p.iconCol }}>
              <i class={`fas ${p.icon}`} />
            </div>
            <div>
              <div class="hse-mod-name">{p.name}</div>
              <div class="hse-mod-desc">{p.desc}</div>
            </div>
          </div>
          <div class={`hse-mod-status-pill ${p.statusClass}`}>
            <span class="hse-mod-status-dot" />{p.statusLabel}
          </div>
        </div>
      </div>

      {/* headline metric */}
      <div class="hse-mod-metric">
        <div class="hse-mod-metric-label">{p.headlineLabel}</div>
        <div>
          <div class="hse-mod-metric-big" style={{ color: p.headlineColor }}>{p.headlineVal}</div>
          <div class="hse-mod-metric-sub">{p.headlineSub}</div>
          {p.headlineDelta && (
            <span class={`hse-mod-delta ${p.headlineDelta.good ? 'good' : p.headlineDelta.dir === 'flat' ? 'flat' : 'bad'}`}>
              <i class={`fas ${p.headlineDelta.dir === 'up' ? 'fa-arrow-up' : p.headlineDelta.dir === 'down' ? 'fa-arrow-down' : 'fa-minus'}`} />
              {p.headlineDelta.label}
            </span>
          )}
        </div>
      </div>

      {/* progress bars */}
      <div class="hse-mod-prog">
        <div class="hse-mod-prog-label">Progress</div>
        {p.progress.map((pr, i) => (
          <div class="hse-mod-prog-row" key={i}>
            <div class="hse-mod-prog-head">
              <span class="hse-mod-prog-lbl">{pr.label}</span>
              <span class="hse-mod-prog-val" style={{ color: pr.color }}>{pr.valueLabel}</span>
            </div>
            <div class="hse-mod-prog-track">
              <div class="hse-mod-prog-fill" style={{ width: `${pr.pct}%`, background: pr.color }} />
            </div>
          </div>
        ))}
      </div>

      {/* alert list */}
      <div class="hse-mod-alerts">
        <div class="hse-mod-alerts-label">Critical items</div>
        {p.alerts.map((a, i) => (
          <div class="hse-mod-alert-item" key={i}>
            <div class={`hse-mod-alert-dot hse-mod-alert-dot--${a.color}`} />
            <div>
              <div class="hse-mod-alert-text">{a.text}</div>
              <div class="hse-mod-alert-ref">{a.ref}</div>
            </div>
          </div>
        ))}
      </div>

      {/* action counts + open button */}
      <div class="hse-mod-action">
        <div class="hse-mod-action-counts">
          {p.stats.map((s, i) => (
            <div class="hse-mod-ac-row" key={i}>
              <span class="hse-mod-ac-lbl">{s.label}</span>
              <span class="hse-mod-ac-val" style={s.color ? { color: s.color } : {}}>{s.value}</span>
            </div>
          ))}
        </div>
        <button class="hse-mod-open-btn" onClick={p.onOpen}>
          <i class="fas fa-arrow-right" /> {p.openLabel}
        </button>
      </div>
    </div>
  );
}

function ModuleHealthLayer(): VNode {
  // derive counts from real mock data
  const openIncidents   = mockIncidents.filter(x => x.status !== 'Closed').length;
  const openCapas       = mockCapa.filter(x => x.status !== 'Closed').length;
  const overdueCapas    = mockCapa.filter(x => x.status === 'Overdue').length;
  const hipoCount       = mockIncidents.filter(x => x.type === 'Near Miss' && x.severity === 'danger').length;
  const blockedPermits  = mockPermitRows.filter(x => x.status === 'Blocked').length;
  const overduePermits  = mockPermitRows.filter(x => x.status === 'Overdue').length;
  const overdueInsp     = mockInspections.filter(x => x.status === 'Overdue').length;
  const openFindings    = mockFindings.filter(x => x.status === 'Open').length;
  const expiredCerts    = mockCertifications.filter(x => x.status === 'Expired').length;
  const dueCerts        = mockCertifications.filter(x => x.status === 'Due').length;
  const talksThisWeek   = mockToolboxTalks.filter(x => x.status === 'Complete').length;
  const reviewDueDocs   = mockHseDocs.filter(x => x.status === 'Review Due').length;
  const expiredSds      = mockSds.filter(x => x.status === 'Expired').length;
  const lowStockPpe     = mockPpeItems.filter(x => x.status === 'low').length;
  const expiredPpe      = mockPpeItems.filter(x => x.status === 'expired').length;

  return (
    <div class="hse-mod-health">
      <ModuleHealthRow
        icon="fa-triangle-exclamation"
        iconBg="var(--hse-red-tint)" iconCol="var(--hse-red)"
        name="Incidents" desc="OSH recordables, near misses, HiPo events"
        statusLabel="Critical — action required" statusClass="sp-crit"
        headlineLabel="OSH recordables YTD" headlineVal={3} headlineColor={C.red}
        headlineSub="Target: 0 · 1 pending EMA notification"
        headlineDelta={{ dir: 'up', label: '+2 vs last yr', good: false }}
        progress={[
          { label: 'CAPA closure',        pct: 87,  color: C.amber, valueLabel: '87%' },
          { label: 'Investigations open', pct: 100, color: C.red,   valueLabel: '2 of 2' },
          { label: 'Near miss ratio',     pct: 75,  color: C.green, valueLabel: '9:1' },
        ]}
        alerts={[
          { color: 'red',   text: 'EMA notification overdue — diesel spill',     ref: 'INC-2026-041 · Point Lisas' },
          { color: 'red',   text: 'Confined space near miss — no rescue plan',    ref: 'NM-2026-118 · Galeota' },
          { color: 'amber', text: 'CA-303 glove restock overdue 3 days',          ref: 'CAPA · La Brea Yard' },
        ]}
        stats={[
          { label: 'Open incidents',  value: openIncidents, color: C.red   },
          { label: 'Open CAPAs',      value: openCapas,     color: C.amber },
          { label: 'Overdue CAPAs',   value: overdueCapas,  color: C.red   },
          { label: 'HiPo events',     value: hipoCount,     color: C.red   },
        ]}
        openLabel="Open Incidents"
      />

      <ModuleHealthRow
        icon="fa-id-badge"
        iconBg="var(--hse-amber-tint)" iconCol="var(--hse-amber)"
        name="Permits to Work" desc="Hot work, confined space, height, electrical"
        statusLabel="Blocked — permits held" statusClass="sp-crit"
        headlineLabel="Active permits today" headlineVal={mockPermitRows.length} headlineColor={C.amber}
        headlineSub={`${mockPermitRows.filter(x => x.status === 'Live').length} live · ${blockedPermits} blocked · ${overduePermits} overdue`}
        headlineDelta={{ dir: 'up', label: `${blockedPermits + overduePermits} require action`, good: false }}
        progress={[
          { label: 'Gas test / rescue plan', pct: 0,   color: C.red,   valueLabel: 'Missing' },
          { label: 'Fire watch / gas-free',  pct: 20,  color: C.red,   valueLabel: 'Overdue' },
          { label: 'Harness / edge control', pct: 100, color: C.green, valueLabel: 'Complete' },
        ]}
        alerts={[
          { color: 'red',   text: 'PTW-0033 confined space — gas test missing',    ref: 'Galeota Marine Base · expires today 18:00' },
          { color: 'red',   text: 'PTW-0032 hot work — expired at 16:00',           ref: 'Point Lisas Plant · T. Baptiste' },
          { color: 'amber', text: 'PTW-0040 LOTO verification on hold',             ref: 'Point Lisas Plant · T. Baptiste' },
        ]}
        stats={[
          { label: 'Live permits', value: mockPermitRows.filter(x => x.status === 'Live').length,   color: C.green },
          { label: 'Blocked',      value: blockedPermits,  color: C.red   },
          { label: 'Overdue',      value: overduePermits,  color: C.red   },
          { label: 'On hold',      value: mockPermitRows.filter(x => x.status === 'Hold').length,   color: C.amber },
        ]}
        openLabel="Open Permits"
      />

      <ModuleHealthRow
        icon="fa-school"
        iconBg="var(--hse-green-tint)" iconCol="var(--hse-green)"
        name="Training & Competency" desc="Certifications, competency matrix, renewals"
        statusLabel="Watch — renewals due" statusClass="sp-warn"
        headlineLabel="Workforce compliance" headlineVal="94%" headlineColor={C.green}
        headlineSub="75 of 80 required certs current"
        headlineDelta={{ dir: 'up', label: '+2% vs last month', good: true }}
        progress={[
          { label: 'Confined space', pct: 88, color: C.amber, valueLabel: '88%' },
          { label: 'Work at height', pct: 95, color: C.green, valueLabel: '95%' },
          { label: 'First aid',      pct: 78, color: C.red,   valueLabel: '78%' },
        ]}
        alerts={[
          { color: 'red',   text: 'CERT-1103 First Aid — Andre Williams expired',  ref: 'Expired 20 Jan 2026 · Point Lisas' },
          { color: 'amber', text: 'CERT-1101 Confined Space — Reza Khan due',       ref: 'Due 12 Jul 2026 · Galeota' },
          { color: 'amber', text: 'CERT-1105 Spill Response — K. Persad due',       ref: 'Due 08 Jun 2026 · Point Lisas' },
        ]}
        stats={[
          { label: 'Compliant certs', value: 75,           color: C.green },
          { label: 'Due this month',  value: dueCerts,     color: C.amber },
          { label: 'Expired',         value: expiredCerts, color: C.red   },
          { label: 'Workers at gap',  value: 2,            color: C.amber },
        ]}
        openLabel="Open Training"
      />

      <ModuleHealthRow
        icon="fa-helmet-safety"
        iconBg="var(--hse-amber-tint)" iconCol="var(--hse-amber)"
        name="PPE Manager" desc="Inventory, compliance, assignments, renewals"
        statusLabel="Watch — 3 stock outs" statusClass="sp-warn"
        headlineLabel="Field compliance" headlineVal="91%" headlineColor={C.amber}
        headlineSub="3 hot spots · 9 item types tracked"
        headlineDelta={{ dir: 'flat', label: 'Flat vs last month', good: false }}
        progress={[
          { label: 'Leather gloves (8 units)', pct: 28,  color: C.red,   valueLabel: 'Low' },
          { label: 'Fall harness (5 units)',    pct: 45,  color: C.amber, valueLabel: 'Low' },
          { label: 'Ear muffs (0 units)',       pct: 0,   color: C.red,   valueLabel: 'Expired' },
        ]}
        alerts={[
          { color: 'red',   text: 'Ear muffs — 0 units, item expired Aug 2026',     ref: 'Vehicle 12 · 3M brand' },
          { color: 'red',   text: 'Leather gloves below threshold (8 vs 15 min)',    ref: 'Site B · Ironclad' },
          { color: 'amber', text: 'Welding shields low — 3 of 5 threshold',          ref: 'Warehouse A · Fibre-Metal' },
        ]}
        stats={[
          { label: 'Available items', value: mockPpeItems.filter(x => x.status === 'available').length, color: C.green },
          { label: 'Low stock',       value: lowStockPpe,  color: C.amber },
          { label: 'Expired',         value: expiredPpe,   color: C.red   },
          { label: 'Compliance %',    value: '91%',        color: C.amber },
        ]}
        openLabel="Open PPE"
      />

      <ModuleHealthRow
        icon="fa-clipboard-check"
        iconBg="var(--hse-amber-tint)" iconCol="var(--hse-amber)"
        name="Inspections & Risk" desc="Audits, findings, hazard register, JSAs"
        statusLabel="Overdue items" statusClass="sp-warn"
        headlineLabel="Inspection completion" headlineVal="75%" headlineColor={C.amber}
        headlineSub="3 of 4 scheduled this month done"
        headlineDelta={{ dir: 'down', label: `${overdueInsp} overdue`, good: false }}
        progress={[
          { label: 'Inspections complete',        pct: 75,  color: C.amber, valueLabel: '75%' },
          { label: 'Findings closed',             pct: 33,  color: C.red,   valueLabel: '33%' },
          { label: 'Critical hazards controlled', pct: 100, color: C.green, valueLabel: '100%' },
        ]}
        alerts={[
          { color: 'red',   text: 'INSP-203 housekeeping — 2 open findings',       ref: 'Piarco Logistics · overdue' },
          { color: 'red',   text: 'FND-051 emergency exit blocked in bay 3',        ref: 'Piarco Logistics · danger' },
          { color: 'amber', text: 'RA-2026-13 vessel entry — still in review',      ref: 'Risk assessment · Galeota' },
        ]}
        stats={[
          { label: 'Inspections overdue', value: overdueInsp,   color: C.red   },
          { label: 'Open findings',       value: openFindings,  color: C.red   },
          { label: 'Active hazards',      value: 5,             color: C.amber },
          { label: 'High/critical risk',  value: 2,             color: C.red   },
        ]}
        openLabel="Open Inspections"
      />

      <ModuleHealthRow
        icon="fa-files"
        iconBg="var(--hse-blue-tint)" iconCol="var(--hse-blue)"
        name="Documents & Toolbox" desc="Controlled docs, SDS library, talks log"
        statusLabel="Review due" statusClass="sp-info"
        headlineLabel="Toolbox talks this week" headlineVal={talksThisWeek} headlineColor={C.green}
        headlineSub="22 attendees · 1 scheduled tomorrow"
        headlineDelta={{ dir: 'up', label: 'All major sites covered', good: true }}
        progress={[
          { label: 'Docs published',     pct: 50, color: C.green, valueLabel: '2 of 4' },
          { label: 'SDS current',        pct: 75, color: C.amber, valueLabel: '75%' },
          { label: 'Talk site coverage', pct: 80, color: C.amber, valueLabel: '80%' },
        ]}
        alerts={[
          { color: 'amber', text: 'DOC-HSE-0205 Emergency Response Plan — review due 30 Jun', ref: 'Documents · HSE · v1.4' },
          { color: 'amber', text: 'SDS-004 Hydraulic Oil — expired revision 2023',             ref: 'SDS Library · Lubricants Ltd' },
          { color: 'blue',  text: 'Galeota Marine Base — no toolbox talk this week',           ref: 'Toolbox Talks · coverage gap' },
        ]}
        stats={[
          { label: 'Docs review due',      value: reviewDueDocs, color: C.amber },
          { label: 'Draft pending approval', value: mockHseDocs.filter(x => x.status === 'Draft').length, color: C.amber },
          { label: 'SDS expired',          value: expiredSds,    color: C.red   },
          { label: 'Site coverage gap',    value: 1,             color: C.blue  },
        ]}
        openLabel="Open Documents"
      />

      <ModuleHealthRow
        icon="fa-id-card-clip"
        iconBg="var(--hse-blue-tint)" iconCol="var(--hse-blue)"
        name="Contractor Management" desc="STOW induction, HSE files, site access gates"
        statusLabel="Watch — files expiring" statusClass="sp-warn"
        headlineLabel="Active contractors" headlineVal={6} headlineColor={C.blue}
        headlineSub="STOW passports · insurance · medicals"
        headlineDelta={{ dir: 'flat', label: 'Stable this quarter', good: true }}
        progress={[
          { label: 'STOW passport current',  pct: 83, color: C.green, valueLabel: '5 of 6' },
          { label: 'Insurance valid',         pct: 100,color: C.green, valueLabel: '6 of 6' },
          { label: 'Medical clearance',       pct: 83, color: C.amber, valueLabel: '5 of 6' },
        ]}
        alerts={[
          { color: 'amber', text: 'Caribbean Scaffold — STOW passport expires 30 Jun', ref: 'CTR-2026-006 · Galeota' },
          { color: 'amber', text: 'TI Consulting — medical clearance lapsed',          ref: 'CTR-2026-005 · PoS Office' },
        ]}
        stats={[
          { label: 'Active contractors', value: 6,   color: C.blue  },
          { label: 'Files expiring',      value: 2,   color: C.amber },
          { label: 'Site access denials', value: 1,   color: C.red   },
          { label: 'Inductions this mth', value: 4,   color: C.green },
        ]}
        openLabel="Open Contractors"
      />

      <ModuleHealthRow
        icon="fa-scale-balanced"
        iconBg="var(--hse-green-tint)" iconCol="var(--hse-green)"
        name="Legal & Compliance" desc="OSH Act obligations, EMA permits, breach log"
        statusLabel="On track — minor gaps" statusClass="sp-ok"
        headlineLabel="OSH obligations compliant" headlineVal="87%" headlineColor={C.green}
        headlineSub="EMA permits current · 1 active breach"
        headlineDelta={{ dir: 'up', label: '+5% vs Q1', good: true }}
        progress={[
          { label: 'OSH Act obligations',   pct: 87,  color: C.green, valueLabel: '7 of 8' },
          { label: 'EMA permits current',   pct: 80,  color: C.amber, valueLabel: '4 of 5' },
          { label: 'Breach log closed',     pct: 67,  color: C.amber, valueLabel: '2 of 3' },
        ]}
        alerts={[
          { color: 'amber', text: 'EMA trade effluent permit — La Brea expires Aug 2026', ref: 'EMA-TT-00441 · La Brea Yard' },
          { color: 'amber', text: 'Breach #3 safety officer absence — action in progress', ref: 'BRE-003 · OSH Act S.18' },
        ]}
        stats={[
          { label: 'OSH obligations',  value: 8,    color: C.blue  },
          { label: 'EMA permits',       value: 5,    color: C.green },
          { label: 'Open breaches',     value: 1,    color: C.red   },
          { label: 'Calendar events',   value: 6,    color: C.blue  },
        ]}
        openLabel="Open Compliance"
      />

      <ModuleHealthRow
        icon="fa-truck-medical"
        iconBg="var(--hse-red-tint)" iconCol="var(--hse-red)"
        name="Emergency Response" desc="Plans, muster points, drills, ERT members"
        statusLabel="Watch — review due" statusClass="sp-warn"
        headlineLabel="Drills completed YTD" headlineVal={4} headlineColor={C.green}
        headlineSub="Avg score 88% · SOPEP & MOB current at Galeota"
        headlineDelta={{ dir: 'up', label: 'On schedule', good: true }}
        progress={[
          { label: 'Emergency plans current',    pct: 71,  color: C.amber, valueLabel: '5 of 7' },
          { label: 'Drill score ≥ 85%',          pct: 75,  color: C.green, valueLabel: '3 of 4' },
          { label: 'ERT members active',          pct: 80,  color: C.amber, valueLabel: '4 of 5' },
        ]}
        alerts={[
          { color: 'amber', text: 'La Brea — Medical Emergency Plan review due',         ref: 'ERP-005 · due 20 Nov 2026' },
          { color: 'amber', text: 'L. Ramnarine ERT first aid cert expired',             ref: 'ERT-005 · Piarco Logistics' },
          { color: 'blue',  text: 'Piarco evacuation drill scheduled 25 Jun 2026',       ref: 'DRL-026 · Full loading bay' },
        ]}
        stats={[
          { label: 'Emergency plans',  value: 7,  color: C.blue  },
          { label: 'Muster points',     value: 7,  color: C.blue  },
          { label: 'Plans review due',  value: 2,  color: C.amber },
          { label: 'ERT renewal req.',  value: 1,  color: C.red   },
        ]}
        openLabel="Open Emergency"
      />

      <ModuleHealthRow
        icon="fa-leaf"
        iconBg="var(--hse-green-tint)" iconCol="var(--hse-green)"
        name="Environmental Management" desc="Spills, waste manifests, EMA notifications, monitoring"
        statusLabel="Watch — open spill" statusClass="sp-warn"
        headlineLabel="Spills YTD" headlineVal={4} headlineColor={C.amber}
        headlineSub="1 open · Tier 2 EMA notification submitted"
        headlineDelta={{ dir: 'down', label: '-1 vs H1 2025', good: true }}
        progress={[
          { label: 'Waste manifested',          pct: 60,  color: C.amber, valueLabel: '3 of 5' },
          { label: 'Monitoring compliant',       pct: 67,  color: C.amber, valueLabel: '4 of 6' },
          { label: 'EMA notifications on time',  pct: 100, color: C.green, valueLabel: '2 of 2' },
        ]}
        alerts={[
          { color: 'red',   text: 'SPI-2026-001 diesel spill to storm drain — open',    ref: 'Point Lisas Plant · EMA submitted' },
          { color: 'amber', text: 'Air particulate monitoring sample due Q3',            ref: 'MON-004 · Point Lisas Plant' },
          { color: 'amber', text: 'Battery acid waste manifest pending',                 ref: 'WST-004 · Piarco Logistics' },
        ]}
        stats={[
          { label: 'Spills YTD',          value: 4, color: C.amber },
          { label: 'Open spills',          value: 1, color: C.red   },
          { label: 'Waste records',        value: 5, color: C.blue  },
          { label: 'Monitoring due',       value: 2, color: C.amber },
        ]}
        openLabel="Open Environmental"
      />
    </div>
  );
}

// ── Layer 4: Analytics ─────────────────────────────────────────────────────────

const SW = 110, SH = 30;
function sparkPath(vals: number[], close = false): string {
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * SW},${SH - 3 - (v / max) * (SH - 6)}`);
  if (close) return `M0,${SH} L${pts.join(' L')} L${SW},${SH} Z`;
  return `M${pts.join(' L')}`;
}
function SparkDot({ vals, color }: { vals: number[]; color: string }): VNode {
  const max = Math.max(...vals, 1);
  const cy  = SH - 3 - (vals[vals.length - 1]! / max) * (SH - 6);
  return <circle cx={SW} cy={cy} r="3.5" fill={color} stroke="var(--bg-card)" stroke-width="1.5" />;
}
function Delta({ d, goodDown = false }: { d: number; goodDown?: boolean }): VNode {
  const cls = d === 0 ? 'flat' : (goodDown ? (d < 0 ? 'down' : 'up') : (d > 0 ? 'down' : 'up'));
  return (
    <span class={`hse-spark-delta ${cls}`}>
      <i class={`fas ${d === 0 ? 'fa-minus' : d < 0 ? 'fa-arrow-down' : 'fa-arrow-up'}`} />
      {Math.abs(d)}
    </span>
  );
}

function AnalyticsLayer(): VNode {
  const pts   = mockTrend;
  const last  = pts[pts.length - 1]!;
  const prev  = pts[pts.length - 2]!;
  const months = pts.map(p => p.month);
  const iVals  = pts.map(p => p.incidents);
  const nVals  = pts.map(p => p.nearMisses);
  const cVals  = pts.map(p => p.capaClosure);

  // open actions donut segments (approximate ring from chart)
  const T_W = 520, T_H = 160, T_PAD = 16;
  type Pt3 = [number, number, number];
  const tPts = (vals: number[], max: number): Pt3[] =>
    vals.map((v, i) => [
      Math.round(T_PAD + i * ((T_W - T_PAD * 2) / (vals.length - 1))),
      Math.round(T_H - T_PAD - (v / max) * (T_H - T_PAD * 2)),
      v,
    ]);
  const lPath = (pts: Pt3[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const aPath = (pts: Pt3[]) => {
    const f = pts[0], l = pts[pts.length - 1];
    if (!f || !l) return '';
    return `${lPath(pts)} L${l[0]} ${T_H - T_PAD} L${f[0]} ${T_H - T_PAD} Z`;
  };

  const incPts  = tPts(iVals, 80);
  const nearPts = tPts(nVals, 80);
  const closPts = tPts(cVals, 100);

  const donutSlices = [
    { color: C.red,   label: 'Incidents / CAPA', val: 34, pct: 47 },
    { color: C.amber, label: 'Permits / Inspections', val: 21, pct: 29 },
    { color: C.blue,  label: 'Training / Certs', val: 11, pct: 15 },
    { color: C.green, label: 'Docs / PPE', val: 6, pct: 8 },
  ];

  return (
    <div class="hse-analytics-row">
      {/* safety trend */}
      <div class="hse-chart-card">
        <div class="hse-chart-head">
          <h3><i class="fas fa-chart-line" /> Safety Performance Trend</h3>
          <span>Jan – Jun 2026</span>
        </div>
        <div class="hse-analytics-summaries">
          <div class="hse-analytics-summary hse-analytics-summary--inc">
            <span>Incidents MTD</span>
            <strong style={{ color: C.red }}>{last.incidents}</strong>
            <Delta d={last.incidents - prev.incidents} goodDown />
          </div>
          <div class="hse-analytics-summary hse-analytics-summary--near">
            <span>Near Misses MTD</span>
            <strong style={{ color: C.amber }}>{last.nearMisses}</strong>
            <Delta d={last.nearMisses - prev.nearMisses} />
          </div>
          <div class="hse-analytics-summary hse-analytics-summary--capa">
            <span>CAPA Closure</span>
            <strong style={{ color: C.green }}>{last.capaClosure}%</strong>
            <Delta d={last.capaClosure - prev.capaClosure} />
          </div>
        </div>
        <svg class="hse-analytics-svg" viewBox={`0 0 ${T_W} ${T_H}`} preserveAspectRatio="none">
          {[20, 40, 60, 80].map(pct => {
            const y = T_H - T_PAD - (pct / 100) * (T_H - T_PAD * 2);
            return <line key={pct} x1={T_PAD} y1={y} x2={T_W - T_PAD} y2={y}
              stroke="var(--border)" stroke-width="1" opacity="0.5" />;
          })}
          <path d={aPath(nearPts)} fill="rgba(217,119,6,.07)" />
          <path d={aPath(incPts)}  fill="rgba(228,12,12,.08)" />
          <path d={lPath(nearPts)} fill="none" stroke={C.amber} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d={lPath(incPts)}  fill="none" stroke={C.red}   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d={lPath(closPts)} fill="none" stroke={C.green} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6 3" />
          {incPts.map( (p, i) => <circle key={`i${i}`} cx={p[0]} cy={p[1]} r={3.5} fill={C.red}   stroke="var(--bg-card)" stroke-width="1.5"><title>{months[i]}: {p[2]}</title></circle>)}
          {nearPts.map((p, i) => <circle key={`n${i}`} cx={p[0]} cy={p[1]} r={3.5} fill={C.amber} stroke="var(--bg-card)" stroke-width="1.5"><title>{months[i]}: {p[2]}</title></circle>)}
          {closPts.map((p, i) => <circle key={`c${i}`} cx={p[0]} cy={p[1]} r={3.5} fill={C.green} stroke="var(--bg-card)" stroke-width="1.5"><title>{months[i]}: {p[2]}%</title></circle>)}
        </svg>
        <div class="hse-trend-axis">{months.map(m => <span key={m}>{m}</span>)}</div>
        <div class="hse-legend">
          <span><i style={{ background: C.red }}   />Incidents</span>
          <span><i style={{ background: C.amber }} />Near misses</span>
          <span><i style={{ background: C.green }} />CAPA closure</span>
        </div>
      </div>

      {/* open actions donut */}
      <div class="hse-chart-card">
        <div class="hse-chart-head">
          <h3><i class="fas fa-circle-half-stroke" /> Open actions by module</h3>
          <span>72 total</span>
        </div>
        <div class="hse-donut-wrap">
          <svg width="100" height="100" viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
            <circle cx="50" cy="50" r="38" fill="none" stroke="var(--border)" stroke-width="14" />
            {/* stacked ring segments */}
            <circle cx="50" cy="50" r="38" fill="none" stroke={C.red}   stroke-width="14" stroke-dasharray="112 227" stroke-dashoffset="56.75"  stroke-linecap="butt" />
            <circle cx="50" cy="50" r="38" fill="none" stroke={C.amber} stroke-width="14" stroke-dasharray="66 227"  stroke-dashoffset="-55.25" stroke-linecap="butt" />
            <circle cx="50" cy="50" r="38" fill="none" stroke={C.blue}  stroke-width="14" stroke-dasharray="34 227"  stroke-dashoffset="-121.25" stroke-linecap="butt" />
            <circle cx="50" cy="50" r="38" fill="none" stroke={C.green} stroke-width="14" stroke-dasharray="18 227"  stroke-dashoffset="-155.25" stroke-linecap="butt" />
            <text x="50" y="45" text-anchor="middle" font-size="18" font-weight="800" fill="var(--siomac-navy)">72</text>
            <text x="50" y="59" text-anchor="middle" font-size="9"  fill="var(--text-muted)">open</text>
          </svg>
          <div class="hse-donut-legend">
            {donutSlices.map(s => (
              <div class="hse-donut-row" key={s.label}>
                <div class="hse-donut-dot" style={{ background: s.color }} />
                <span class="hse-donut-lbl">{s.label}</span>
                <span class="hse-donut-val">{s.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Layer 5: Site Intelligence ─────────────────────────────────────────────────

const SITE_DATA = [
  { name: 'Galeota Marine Base',  sub: 'Marine transfer · confined space', chip: 'Critical', chipClass: 'chip-red',  riskPct: 88, incidents: 2, ptw: '1 blocked', capas: 3, readiness: 74,  readColor: C.amber },
  { name: 'Point Lisas Plant',    sub: 'Hot work · chemicals · process',   chip: 'High',     chipClass: 'chip-amb',  riskPct: 72, incidents: 2, ptw: '2 active',  capas: 4, readiness: 81,  readColor: C.amber },
  { name: 'Piarco Logistics',     sub: 'Forklifts · pedestrian traffic',   chip: 'Medium',   chipClass: 'chip-amb',  riskPct: 55, incidents: 1, ptw: '—',         capas: 2, readiness: 88,  readColor: C.green },
  { name: 'La Brea Yard',         sub: 'Manual handling · chemicals',      chip: 'Medium',   chipClass: 'chip-amb',  riskPct: 48, incidents: 1, ptw: '—',         capas: 1, readiness: 91,  readColor: C.green },
  { name: 'Port of Spain Office', sub: 'Work at height · facilities',      chip: 'Low',      chipClass: 'chip-blue', riskPct: 28, incidents: 1, ptw: '1 live',    capas: 0, readiness: 96,  readColor: C.green },
] as const;

const RISK_COLOR: Record<string, string> = {
  'chip-red':  C.red,
  'chip-amb':  C.amber,
  'chip-blue': C.blue,
};

function SiteIntelligenceLayer({ onOpen }: { onOpen: (d: DD) => void }): VNode {
  return (
    <section class="hse-site-table">
      <div class="hse-site-thead">
        <div class="hse-site-th">Site</div>
        <div class="hse-site-th">Risk level</div>
        <div class="hse-site-th" style={{ textAlign: 'center' }}>Incidents</div>
        <div class="hse-site-th" style={{ textAlign: 'center' }}>PTWs</div>
        <div class="hse-site-th" style={{ textAlign: 'center' }}>CAPAs</div>
        <div class="hse-site-th">Readiness</div>
        <div class="hse-site-th" />
      </div>
      {SITE_DATA.map(s => (
        <div class="hse-site-row" key={s.name}
          onClick={() => onOpen({ title: s.name, subtitle: s.sub, rows: [
            ['Risk level', s.chip],
            ['Open incidents', String(s.incidents)],
            ['Active PTWs', s.ptw],
            ['Open CAPAs', String(s.capas)],
            ['Readiness score', `${s.readiness}%`],
          ] })}>
          <div>
            <div class="hse-site-name">{s.name}</div>
            <div class="hse-site-loc">{s.sub}</div>
          </div>
          <div>
            <span class={`hse-alert-chip ${s.chipClass}`} style={{ marginBottom: 5, display: 'inline-flex' }}>{s.chip}</span>
            <div class="hse-site-risk-bar-wrap">
              <div class="hse-site-risk-bar" style={{ width: `${s.riskPct}%`, background: RISK_COLOR[s.chipClass] ?? C.amber }} />
            </div>
          </div>
          <div class="hse-site-num" style={{ color: s.incidents >= 2 ? C.red : 'var(--text-default)' }}>{s.incidents}</div>
          <div class="hse-site-num" style={{ color: s.ptw.includes('blocked') ? C.red : 'var(--text-default)' }}>{s.ptw}</div>
          <div class="hse-site-num" style={{ color: s.capas >= 3 ? C.red : s.capas >= 1 ? C.amber : C.green }}>{s.capas}</div>
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: s.readColor }}>{s.readiness}%</div>
            <div class="hse-site-risk-bar-wrap" style={{ marginTop: 3 }}>
              <div class="hse-site-risk-bar" style={{ width: `${s.readiness}%`, background: s.readColor }} />
            </div>
          </div>
          <button class="hse-site-go-btn" onClick={e => e.stopPropagation()}>Open site ↗</button>
        </div>
      ))}
    </section>
  );
}

// ── section heading ────────────────────────────────────────────────────────────

function LayerLabel({ children }: { children: string }): VNode {
  return <div class="hse-layer-label">{children}</div>;
}

// ── main dashboard ─────────────────────────────────────────────────────────────

export function HSEDashboard(): VNode {
  const [drawer, setDrawer] = useState<DD | null>(null);
  const [search, setSearch] = useState('');
  const [site,   setSite]   = useState('all');
  const [risk,   setRisk]   = useState('all');
  const wf = useWorkflow();

  const pendingCount = wf.state.approvals.filter(a => /pending|in_review/.test(a.status)).length;

  return (
    <div class="hse-tab hse-dash">

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

      {/* filter bar */}
      <div class="hse-filter-bar">
        <div class="hse-live-pulse"><span class="hse-live-dot" /><span>Live</span></div>
        <label class="hse-search-box" style={{ flex: '1 1 200px' }}>
          <i class="fas fa-search" />
          <input value={search}
            onInput={e => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Search records, sites, owners…" />
        </label>
        <select class="hse-filter-sel" value={site}
          onChange={e => setSite((e.target as HTMLSelectElement).value)}>
          <option value="all">All T&amp;T sites</option>
          {HSE_SITE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select class="hse-filter-sel">
          {HSE_PERIOD_OPTIONS.map(o => <option key={o}>{o}</option>)}
        </select>
        <select class="hse-filter-sel" value={risk}
          onChange={e => setRisk((e.target as HTMLSelectElement).value)}>
          <option value="all">All risk levels</option>
          {HSE_RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select class="hse-filter-sel">
          <option>All owners</option>
          {HSE_OWNER_OPTIONS.map(o => <option key={o}>{o}</option>)}
        </select>
      </div>

      {/* Layer 1 — Command KPIs */}
      <LayerLabel>Command KPIs</LayerLabel>
      <KpiRow onOpen={d => setDrawer(d)} wf={wf} />

      {/* Layer 2 — Alerts & Approvals */}
      <LayerLabel>Real-time Alerts & Approvals</LayerLabel>
      <AlertsLayer wf={wf} onOpen={d => setDrawer(d)} />

      {/* Layer 3 — Module Health */}
      <LayerLabel>Module Health</LayerLabel>
      <ModuleHealthLayer />

      {/* Layer 4 — Analytics */}
      <LayerLabel>Analytics & Trends</LayerLabel>
      <AnalyticsLayer />

      {/* Layer 5 — Site Intelligence */}
      <LayerLabel>Site Intelligence</LayerLabel>
      <SiteIntelligenceLayer onOpen={d => setDrawer(d)} />

      <Drawer data={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
