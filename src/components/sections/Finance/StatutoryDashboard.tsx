/**
 * src/components/sections/Finance/StatutoryDashboard.tsx
 *
 * Statutory Configuration dashboard — a self-contained enterprise page (its own
 * `.sdb` design system) rendered directly by StatutoryConfigOverview. Not a widget.
 *
 * Layout (matches conv-statutory-config-dashboard.html mockup):
 *   Header  →  6 stat cards  →  middle row (combo chart | readiness donut | upcoming dates)
 *   Bottom  →  tabbed table (Rate Versions / NIS / Components / Verify / Reports) + side stack
 *
 * Data binding notes (be honest — no fake numbers):
 *   REAL:
 *     - Active Version label + effective date         ← activeVer
 *     - Draft Versions count                          ← drafts
 *     - Pay Components count + inactive count         ← components / activeComponents
 *     - Verification Queue count                      ← verifyQueue
 *     - Pending Approvals count                       ← pending
 *     - Upcoming Effective Dates list                 ← versions with future effectiveFrom
 *     - Recent Activity list                          ← activityItems
 *     - Readiness donut segments                      ← version status distribution
 *
 *   PLACEHOLDER (clearly labelled, TODO comments in code):
 *     - NIS Classes count in stat card                ← no global count hook; shows active-ver info
 *     - Combo chart (Config Readiness / Rule Coverage / Effective Versions bars)
 *                                                     ← derived proxies; TODO real server metric
 *     - Mini-stat ring "Configuration Readiness %"    ← proxy: activeComponents/total components
 *     - Mini-stat "Rule Coverage %"                   ← proxy: statutory/active components ratio
 */

import { type VNode } from 'preact';
import { useMemo, useState, useEffect, useRef } from 'preact/hooks';
import {
  type StatutoryVersion, type PayComponent, type NisClass,
} from '@api/finance/statutory';
import { type ActivityItem } from '@ui';
import { fmtDate, fmtMoney, humanize, toRoman } from './financeShared';

// Re-export so the parent can reference the same literal type without a second import.
export type MainTab = 'versions' | 'nis' | 'components' | 'verify' | 'reports';

const TABS: { key: MainTab; label: string }[] = [
  { key: 'versions',   label: 'Rate Versions' },
  { key: 'nis',        label: 'NIS Classes' },
  { key: 'components', label: 'Pay Components' },
  { key: 'verify',     label: 'NIS Verification' },
  { key: 'reports',    label: 'Reports' },
];

export interface StatutoryDashboardProps {
  // ── Data ──────────────────────────────────────────────────────────────────
  versions: StatutoryVersion[];
  components: PayComponent[];
  activeVer: StatutoryVersion | null;
  /** NIS bands of the active version — powers the NIS contribution schedule chart. */
  activeNisClasses: NisClass[];
  /** Count of verified NIS profiles — for the NIS Verification readiness lens. */
  verifiedNisCount: number;
  drafts: number;
  pending: number;
  activeComponents: number;
  verifyQueue: number;
  activityItems: ActivityItem[];
  versionsLoading: boolean;
  // ── Quick-action handler — the readiness card's CTA opens the Verify tab. ──
  onVerifyNis: () => void;
  // ── Tab state (owned by parent so drawer/edit dialogs stay synced) ────────
  tab: MainTab;
  onTabChange: (t: MainTab) => void;
  // Fully-wired tab content rendered by the parent (VersionsTab / NisClassesTab / …)
  tabContent: VNode;
}

// ── SVG helpers ────────────────────────────────────────────────────────────────

/** Semicircle gauge (solid track + colored fill) — matches the obv MetricGauge.
 *  The fill sweeps LEFT→RIGHT from 0 to the value; the value shows in the copy. */
function HalfGauge({ pct, color }: { pct: number; color: string }): VNode {
  const p = Math.max(0, Math.min(100, pct));
  const rest = 100 - p; // dashoffset that reveals exactly the first p units (left→right)
  const ARC = 'M17 62 A42 42 0 0 1 101 62';
  const fillRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return; // element already rests at the correct offset via the attribute
    const anim = el.animate(
      [{ strokeDashoffset: 100 }, { strokeDashoffset: rest }],
      { duration: 1300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', delay: 80, fill: 'forwards' },
    );
    return () => anim.cancel();
  }, [rest]);

  return (
    <div class="sdb-gauge">
      <svg viewBox="0 0 118 78">
        <path d={ARC} pathLength={100} fill="none" stroke="#e9edf4" strokeWidth={13} strokeLinecap="round" />
        <path ref={fillRef} d={ARC} pathLength={100} fill="none" stroke={color} strokeWidth={13}
          strokeLinecap="round" strokeDasharray="100" strokeDashoffset={rest} />
      </svg>
    </div>
  );
}

// ── Activity icon helper ────────────────────────────────────────────────────────

function actIcon(icon: string): { bg: string; color: string; fa: string } {
  switch (icon) {
    case 'check':  return { bg: '#e4f8ea', color: '#16a34a', fa: 'fa-bolt' };
    case 'upload': return { bg: '#eaf1fe', color: '#2563eb', fa: 'fa-file-import' };
    case 'gavel':  return { bg: '#f2effe', color: '#8b5cf6', fa: 'fa-layer-group' };
    default:       return { bg: '#fdf3e0', color: '#f59e0b', fa: 'fa-clock' };
  }
}

// ── Time-ago helper ────────────────────────────────────────────────────────────

function timeAgo(isoOrLabel: string): string {
  // activityItems already have a `meta` string like "Active · 01 Jan 2025" — just show it
  return isoOrLabel;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function StatutoryDashboard({
  versions, components, activeVer, activeNisClasses, verifiedNisCount, drafts, pending, activeComponents, verifyQueue,
  activityItems, versionsLoading,
  onVerifyNis,
  tab, onTabChange, tabContent,
}: StatutoryDashboardProps): VNode {

  const inactiveComponents = components.length - activeComponents;

  // ── Statutory compliance calendar (REAL recurring T&T deadlines) ────────────
  // NIS + PAYE/HS remit on the 15th of each month; TD4 certificates file by 28 Feb.
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [weekStart, setWeekStart] = useState<Date>(startOfToday);
  const [selectedDay, setSelectedDay] = useState<Date>(startOfToday);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; }),
    [weekStart],
  );
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const deadlinesOn = (d: Date): { title: string; note: string; tagLabel: string; tagCls: string }[] => {
    const out: { title: string; note: string; tagLabel: string; tagCls: string }[] = [];
    if (d.getDate() === 15) {
      out.push({ title: 'NIS Contribution Remittance', note: 'Monthly payment to NIBTT', tagLabel: 'NIS', tagCls: 'sdb-tag--upcoming' });
      out.push({ title: 'PAYE & Health Surcharge',     note: 'Monthly return to BIR',    tagLabel: 'BIR', tagCls: 'sdb-tag--pending' });
    }
    if (d.getMonth() === 1 && d.getDate() === 28) {
      out.push({ title: 'TD4 Certificates & Summary', note: 'Annual filing to BIR', tagLabel: 'Annual', tagCls: 'sdb-tag--planned' });
    }
    return out;
  };
  const selectedDeadlines = deadlinesOn(selectedDay);
  const shiftWeek = (dir: -1 | 1): void => {
    const d = new Date(weekStart); d.setDate(d.getDate() + dir * 7);
    setWeekStart(d); setSelectedDay(d);
  };

  // ── Statutory readiness lenses (switchable via ‹ ›) ─────────────────────────
  const [readyLens, setReadyLens] = useState(0);
  const readiness = useMemo(() => {
    // Config completeness — booleans over the active version's configuration.
    const checks = [
      !!activeVer,
      activeNisClasses.length > 0,
      !!activeVer && activeVer.payePersonalAllowance > 0 && activeVer.payeBand1Rate > 0 && activeVer.payeBand2Rate > 0,
      !!activeVer && activeVer.hsWeeklyHigh >= 0 && activeVer.hsWeeklyLow >= 0 && activeVer.hsMonthlyThreshold > 0,
      !!activeVer && activeVer.nisMonthyCeiling != null,
      components.some(c => c.isStatutory && c.isActive),
    ];
    const passed = checks.filter(Boolean).length;
    const configPct = Math.round((passed / checks.length) * 100);
    // NIS verification — verified vs (verified + pending) among submitted profiles.
    const verifyTotal = verifiedNisCount + verifyQueue;
    const verifyPct = verifyTotal === 0 ? 100 : Math.round((verifiedNisCount / verifyTotal) * 100);
    // Payroll readiness — the weakest gate (both must be high to run cleanly).
    const payrollPct = Math.min(configPct, verifyPct);
    return [
      {
        title: 'Config Completeness', color: '#16a34a', icon: 'fa-clipboard-check', pct: configPct,
        subtitle: 'PAYE, NIS & Health Surcharge on the active version.',
        sub: `${passed} of ${checks.length} configuration items set`,
        stats: [{ label: 'NIS Classes', value: String(activeNisClasses.length) }, { label: 'Pay Components', value: String(activeComponents) }],
        cta: 'Open active version', onCta: () => onTabChange('nis'),
      },
      {
        title: 'NIS Verification', color: '#2f5fe0', icon: 'fa-user-check', pct: verifyPct,
        subtitle: 'Employee NIS profiles cleared for payroll.',
        sub: verifyTotal === 0 ? 'No profiles awaiting verification' : `${verifiedNisCount} verified · ${verifyQueue} pending`,
        stats: [{ label: 'Verified', value: String(verifiedNisCount) }, { label: 'Pending', value: String(verifyQueue) }],
        cta: 'Open verification', onCta: onVerifyNis,
      },
      {
        title: 'Payroll Readiness', color: '#12b3a6', icon: 'fa-money-check-dollar', pct: payrollPct,
        subtitle: 'Ready to run a clean payroll cycle.',
        sub: `Config ${configPct}% · Verification ${verifyPct}%`,
        stats: [{ label: 'Config', value: `${configPct}%` }, { label: 'Verified NIS', value: `${verifyPct}%` }],
        cta: 'Review readiness', onCta: onVerifyNis,
      },
    ];
  }, [activeVer, activeNisClasses.length, components, activeComponents, verifiedNisCount, verifyQueue, onTabChange, onVerifyNis]);
  const lens = readiness[readyLens] ?? readiness[0]!;

  // ── NIS contribution schedule (REAL — the active version's earnings-class bands) ─
  const nis = useMemo(() => {
    const rows = [...activeNisClasses].sort((a, b) => a.classNo - b.classNo);
    const totals = rows.map(c => c.employeeWeekly + c.employerWeekly);
    const maxTotal = Math.max(1, ...totals);
    const top = rows[rows.length - 1];
    const bot = rows[0];
    return {
      rows, maxTotal,
      topTotal:    top ? top.employeeWeekly + top.employerWeekly : 0,
      topEmployee: top ? top.employeeWeekly : 0,
      topEmployer: top ? top.employerWeekly : 0,
      botTotal:    bot ? bot.employeeWeekly + bot.employerWeekly : 0,
    };
  }, [activeNisClasses]);

  // SVG plot geometry — 16 stacked bars (employee ⅓ bottom, employer ⅔ top).
  const NIS = { x0: 46, x1: 494, yTop: 22, yBase: 250 };
  const nisH = (v: number): number => Math.round((v / nis.maxTotal) * (NIS.yBase - NIS.yTop));
  const nisSlot = nis.rows.length > 0 ? (NIS.x1 - NIS.x0) / nis.rows.length : 0;
  const nisBarW = Math.min(20, Math.max(6, nisSlot * 0.6));
  const nisGrid = [0, 0.25, 0.5, 0.75, 1].map(f => ({ f, y: NIS.yBase - f * (NIS.yBase - NIS.yTop), val: nis.maxTotal * f }));
  // Contribution rate derived from the data (total ÷ assumed average), not hardcoded.
  const nisRatePct = (() => {
    const c = nis.rows.find(r => r.assumedAverageWeekly && r.assumedAverageWeekly > 0);
    if (!c || !c.assumedAverageWeekly) return null;
    return Math.round(((c.employeeWeekly + c.employerWeekly) / c.assumedAverageWeekly) * 1000) / 10;
  })();

  // ── Activity icon lookup ──────────────────────────────────────────────────────
  // activityItems come from parent (derived from versions list)

  return (
    <div class="sdb">

      {/* ── T&T statutory summary — the active version at a glance ──────────── */}
      {activeVer && (
        <div class="sdb-taxline">
          <span class="sdb-taxline-item">
            <b>PAYE</b> {Math.round(activeVer.payeBand1Rate * 100)}% / {Math.round(activeVer.payeBand2Rate * 100)}% · allowance {fmtMoney(activeVer.payePersonalAllowance)}
          </span>
          <span class="sdb-taxline-item">
            <b>NIS</b> {nisRatePct != null ? `${nisRatePct}%` : '—'} · {nis.rows.length} classes{activeVer.nisMonthyCeiling ? ` · ceiling ${fmtMoney(activeVer.nisMonthyCeiling)}/mo` : ''}
          </span>
          <span class="sdb-taxline-item">
            <b>Health Surcharge</b> {fmtMoney(activeVer.hsWeeklyHigh)} / {fmtMoney(activeVer.hsWeeklyLow)} per wk
          </span>
        </div>
      )}

      {/* ── 6-card stat row ────────────────────────────────────────────────── */}
      <div class="sdb-stats">

        {/* 1. Active Version — REAL */}
        <div class="sdb-card sdb-stat">
          <div class="sdb-stat-ic sdb-stat-ic--blue"><i class="fa-regular fa-file-lines" /></div>
          <div>
            <div class="sdb-stat-label">Active Version</div>
            <div class="sdb-stat-value">{versionsLoading ? '…' : (activeVer?.label ?? '—')}</div>
            <div class="sdb-stat-sub">
              {activeVer
                ? <><span class="sdb-dot sdb-dot--green" />Effective {fmtDate(activeVer.effectiveFrom)}</>
                : 'No active version'}
            </div>
          </div>
        </div>

        {/* 2. Draft Versions — REAL */}
        <div class="sdb-card sdb-stat">
          <div class="sdb-stat-ic sdb-stat-ic--purple"><i class="fa-regular fa-pen-to-square" /></div>
          <div>
            <div class="sdb-stat-label">Draft Versions</div>
            <div class="sdb-stat-value">{versionsLoading ? '…' : drafts}</div>
            <div class="sdb-stat-sub">
              {pending > 0 ? `${pending} awaiting review` : 'None awaiting review'}
            </div>
          </div>
        </div>

        {/* 3. Pay Components — REAL */}
        <div class="sdb-card sdb-stat">
          <div class="sdb-stat-ic sdb-stat-ic--teal"><i class="fa-solid fa-layer-group" /></div>
          <div>
            <div class="sdb-stat-label">Pay Components</div>
            <div class="sdb-stat-value">{activeComponents}</div>
            <div class="sdb-stat-sub">{inactiveComponents} inactive</div>
          </div>
        </div>

        {/* 4. NIS Classes — PLACEHOLDER (no global count; shows active-ver context)
             TODO: Add a GET /statutory/nis-classes/count backend endpoint that returns
                   the total class count across (or within) the active version so this
                   stat shows a real number rather than navigating to the NIS tab. */}
        <div class="sdb-card sdb-stat sdb-stat--clickable" onClick={() => onTabChange('nis')} role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onTabChange('nis'); }}>
          <div class="sdb-stat-ic sdb-stat-ic--blue"><i class="fa-solid fa-users" /></div>
          <div>
            <div class="sdb-stat-label">NIS Classes</div>
            <div class="sdb-stat-value">{activeVer ? 'View ▸' : '—'}</div>
            <div class="sdb-stat-sub">
              {activeVer
                ? <><span class="sdb-dot sdb-dot--green" />In {activeVer.label}</>
                : 'Select a version'}
            </div>
          </div>
        </div>

        {/* 5. Verification Queue — REAL */}
        <div class="sdb-card sdb-stat sdb-stat--clickable" onClick={() => verifyQueue > 0 && onTabChange('verify')} role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') verifyQueue > 0 && onTabChange('verify'); }}>
          <div class="sdb-stat-ic sdb-stat-ic--amber"><i class="fa-regular fa-clock" /></div>
          <div>
            <div class="sdb-stat-label">Verification Queue</div>
            <div class="sdb-stat-value">{verifyQueue}</div>
            <div class="sdb-stat-sub">
              {verifyQueue > 0
                ? <><span class="sdb-dot sdb-dot--amber" />Needs attention</>
                : 'Queue clear'}
            </div>
          </div>
        </div>

        {/* 6. Pending Approvals — REAL */}
        <div class="sdb-card sdb-stat">
          <div class="sdb-stat-ic sdb-stat-ic--coral"><i class="fa-solid fa-user-check" /></div>
          <div>
            <div class="sdb-stat-label">Pending Approvals</div>
            <div class="sdb-stat-value">{pending}</div>
            <div class="sdb-stat-sub">
              {pending > 0 ? `Across ${pending} item${pending !== 1 ? 's' : ''}` : 'None pending'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Middle row ─────────────────────────────────────────────────────── */}
      <div class="sdb-mid">

        {/* NIS Contribution Schedule — REAL: the active version's earnings-class bands. */}
        <div class="sdb-card sdb-ch">
          <div class="sdb-ch-hd">
            <h2>NIS Contribution Schedule</h2>
            <i class="fa-solid fa-circle-info sdb-info-ic" />
            <div class="sdb-ch-tools">
              <span class="sdb-pill-sel">
                <i class="fa-solid fa-scale-balanced" /> {activeVer ? activeVer.label : 'No active version'}
              </span>
            </div>
          </div>
          <div class="sdb-sum-body">
            {/* Stacked bar chart: employee ⅓ (bottom) + employer ⅔ (top) per class */}
            <div>
              {nis.rows.length === 0 ? (
                <div class="sdb-up-empty" style={{ padding: '48px 0' }}>
                  No NIS earnings classes configured for the active version.
                </div>
              ) : (
                <svg viewBox="0 0 520 300" width="100%" style={{ display: 'block' }}>
                  {/* Gridlines + left axis ($/wk) */}
                  <g fontSize="10" fill="#9aa4b6" textAnchor="end">
                    {nisGrid.map((g, i) => (
                      <text key={i} x={NIS.x0 - 6} y={g.y + 3}>{Math.round(g.val)}</text>
                    ))}
                  </g>
                  <g stroke="#eef1f7" strokeWidth="1">
                    {nisGrid.map((g, i) => <line key={i} x1={NIS.x0} y1={g.y} x2={NIS.x1} y2={g.y} />)}
                  </g>
                  {/* Bars */}
                  {nis.rows.map((c, i) => {
                    const x = NIS.x0 + i * nisSlot + (nisSlot - nisBarW) / 2;
                    const eeH = nisH(c.employeeWeekly);
                    const erH = nisH(c.employerWeekly);
                    const eeY = NIS.yBase - eeH;
                    const erY = eeY - erH;
                    return (
                      <g key={c.id}>
                        <rect x={x} y={erY} width={nisBarW} height={erH} fill="#9cc0f7" rx="2" />
                        <rect x={x} y={eeY} width={nisBarW} height={eeH} fill="#2f5fe0" rx="2" />
                        <text x={x + nisBarW / 2} y={NIS.yBase + 12} textAnchor="middle" fontSize="7.5" fill="#8593a8">
                          {toRoman(c.classNo)}
                        </text>
                      </g>
                    );
                  })}
                  <line x1={NIS.x0} y1={NIS.yBase} x2={NIS.x1} y2={NIS.yBase} stroke="#d7deea" strokeWidth="1" />
                  <text x={(NIS.x0 + NIS.x1) / 2} y="284" textAnchor="middle" fontSize="10.5" fill="#7a8698">
                    Earnings Class (I–{toRoman(nis.rows.length)}) · total weekly contribution ($)
                  </text>
                </svg>
              )}
              <div class="sdb-legend">
                <span><span class="sdb-lg-sq" style={{ background: '#2f5fe0' }} />Employee ⅓</span>
                <span><span class="sdb-lg-sq" style={{ background: '#9cc0f7' }} />Employer ⅔</span>
              </div>
            </div>
            {/* Compact NIS facts that AREN'T already in the summary strip / chart. */}
            <div class="sdb-mini">
              <div class="sdb-mini-item">
                <span class="sdb-mini-k">Weekly contribution range</span>
                <span class="sdb-mini-vv">{nis.botTotal ? fmtMoney(nis.botTotal) : '—'} – {nis.topTotal ? fmtMoney(nis.topTotal) : '—'}</span>
              </div>
              <div class="sdb-mini-item">
                <span class="sdb-mini-k">Top band (Class {toRoman(nis.rows.length)}) split</span>
                <span class="sdb-mini-vv">EE {fmtMoney(nis.topEmployee)} · ER {fmtMoney(nis.topEmployer)}</span>
              </div>
              {activeVer?.nisMonthyCeiling != null && (
                <div class="sdb-mini-item">
                  <span class="sdb-mini-k">Max insurable earnings</span>
                  <span class="sdb-mini-vv">{fmtMoney(activeVer.nisMonthyCeiling)}/mo</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Statutory Readiness — switchable lens (Config / Verification / Payroll) */}
        <div class="sdb-card sdb-ch sdb-ready">
          <div class="sdb-ready-head">
            <span class="sdb-ready-icon" style={{ color: lens.color }}><i class={`fa-solid ${lens.icon}`} /></span>
            <div class="sdb-ready-htext">
              <h2>{lens.title}</h2>
              <p>{lens.subtitle}</p>
            </div>
            <div class="sdb-ready-nav-group">
              <button type="button" class="sdb-ready-nav" aria-label="Previous readiness view"
                onClick={() => setReadyLens(l => (l + readiness.length - 1) % readiness.length)}>
                <i class="fa-solid fa-chevron-left" />
              </button>
              <button type="button" class="sdb-ready-nav" aria-label="Next readiness view"
                onClick={() => setReadyLens(l => (l + 1) % readiness.length)}>
                <i class="fa-solid fa-chevron-right" />
              </button>
            </div>
          </div>
          <div class="sdb-ready-score">
            <span class="sdb-ready-label">Current</span>
            <div class="sdb-gauge-wrap">
              <HalfGauge key={readyLens} pct={lens.pct} color={lens.color} />
              <div class="sdb-gauge-val" style={{ color: lens.color }}>{lens.pct}%</div>
            </div>
            <div class="sdb-ready-sub">{lens.sub}</div>
          </div>
          <div class="sdb-ready-grid">
            {lens.stats.map((s, i) => (
              <div key={i} class="sdb-ready-stat">
                <span>{s.label}</span>
                <strong>{s.value}</strong>
              </div>
            ))}
          </div>
          <div class="sdb-ready-dots" aria-hidden="true">
            {readiness.map((_, i) => (
              <span key={i} class={`sdb-ready-dot${i === readyLens ? ' is-on' : ''}`} />
            ))}
          </div>
          <button type="button" class="sdb-ready-cta" onClick={lens.onCta}>{lens.cta}</button>
        </div>

        {/* Statutory compliance calendar (REAL recurring T&T deadlines) */}
        <div class="sdb-card sdb-ch sdb-cal">
          <div class="sdb-ch-hd">
            <i class="fa-regular fa-calendar" style={{ color: '#2f5fe0' }} />
            <h2 style={{ fontSize: 14 }}>Upcoming Deadlines</h2>
            <div class="sdb-ch-tools">
              <button type="button" class="sdb-ready-nav" aria-label="Previous week" onClick={() => shiftWeek(-1)}><i class="fa-solid fa-chevron-left" /></button>
              <button type="button" class="sdb-ready-nav" aria-label="Next week" onClick={() => shiftWeek(1)}><i class="fa-solid fa-chevron-right" /></button>
            </div>
          </div>
          <div class="sdb-cal-month">{weekStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
          <div class="sdb-cal-strip">
            {weekDays.map(d => {
              const on = sameDay(d, selectedDay);
              const isToday = sameDay(d, today);
              const has = deadlinesOn(d).length > 0;
              return (
                <button type="button" key={d.toISOString()}
                  class={`sdb-cal-day${on ? ' is-on' : ''}${isToday ? ' is-today' : ''}${has ? ' has-deadline' : ''}`}
                  onClick={() => setSelectedDay(new Date(d))}>
                  <span>{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                  <strong>{d.getDate()}</strong>
                </button>
              );
            })}
          </div>
          <div class="sdb-cal-list">
            {selectedDeadlines.length === 0 ? (
              <div class="sdb-up-empty">
                No statutory deadlines on {selectedDay.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}. NIS &amp; PAYE fall on the 15th; TD4 by 28 Feb.
              </div>
            ) : (
              selectedDeadlines.map((d, i) => (
                <div key={i} class="sdb-cal-item">
                  <span class={`sdb-cal-dot ${d.tagCls}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div class="sdb-up-t">{d.title}</div>
                    <div class="sdb-up-s">{d.note}</div>
                  </div>
                  <span class={`sdb-tag ${d.tagCls}`}>{d.tagLabel}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom row ─────────────────────────────────────────────────────── */}
      <div class="sdb-bot">

        {/* Tabbed table card */}
        <div class="sdb-card sdb-table-card">
          {/* Tab strip */}
          <div class="sdb-tabs">
            {TABS.map(t => (
              <button key={t.key} type="button"
                class={`sdb-tab${tab === t.key ? ' sdb-tab--on' : ''}`}
                onClick={() => onTabChange(t.key)}>
                {t.label}
                {t.key === 'verify' && verifyQueue > 0 && (
                  <span class="sdb-tab-badge">{verifyQueue}</span>
                )}
              </button>
            ))}
          </div>
          {/* Tab content (rendered by parent) */}
          <div class="sdb-tab-body">
            {tabContent}
          </div>
        </div>

        {/* Side stack */}
        <div class="sdb-side">

          {/* Verification Queue breakdown — REAL counts, breakdown categories are PLACEHOLDER
               TODO: Add a /statutory/verify-queue-breakdown endpoint that splits the queue
                     into Unclassified Employees / Missing NIS Numbers / Class Mismatches /
                     Contribution Anomalies so each row shows a real sub-count. */}
          <div class="sdb-card">
            <div class="sdb-sc-hd">
              <i class="fa-regular fa-circle-check sdb-sc-lead" />
              <h3>Verification Queue</h3>
              <span class="sdb-view-all" onClick={() => onTabChange('verify')} role="button" tabIndex={0}>View all</span>
            </div>
            <div class="sdb-q-row">
              <span class="sdb-q-ic"><i class="fa-regular fa-circle-user" /></span>
              <span class="sdb-q-l">NIS Profiles Pending</span>
              <span class="sdb-q-n">{verifyQueue}</span>
            </div>
            {/* Breakdown rows below are placeholder — see TODO above */}
            <div class="sdb-q-row sdb-q-row--muted">
              <span class="sdb-q-ic"><i class="fa-solid fa-hashtag" /></span>
              <span class="sdb-q-l">Missing NIS Numbers</span>
              <span class="sdb-q-n sdb-placeholder-val" title="Placeholder — breakdown not yet available">—</span>
            </div>
            <div class="sdb-q-row sdb-q-row--muted">
              <span class="sdb-q-ic"><i class="fa-solid fa-triangle-exclamation" /></span>
              <span class="sdb-q-l">Class Mismatches</span>
              <span class="sdb-q-n sdb-placeholder-val" title="Placeholder — breakdown not yet available">—</span>
            </div>
            <div class="sdb-q-row sdb-q-row--muted">
              <span class="sdb-q-ic"><i class="fa-solid fa-chart-line" /></span>
              <span class="sdb-q-l">Contribution Anomalies</span>
              <span class="sdb-q-n sdb-placeholder-val" title="Placeholder — breakdown not yet available">—</span>
            </div>
            <div class="sdb-q-total">
              <span>Total items</span><span>{verifyQueue}</span>
            </div>
          </div>

          {/* Recent Activity — REAL (derived from versions list in parent) */}
          <div class="sdb-card">
            <div class="sdb-sc-hd">
              <i class="fa-regular fa-calendar sdb-sc-lead" />
              <h3>Recent Activity</h3>
            </div>
            {activityItems.length === 0 ? (
              <div class="sdb-act-empty">No recent activity.</div>
            ) : (
              activityItems.slice(0, 5).map((item, i) => {
                const ic = actIcon(item.icon ?? '');
                return (
                  <div key={i} class="sdb-act">
                    <span class="sdb-act-ic" style={{ background: ic.bg, color: ic.color }}>
                      <i class={`fa-solid ${ic.fa}`} />
                    </span>
                    <div style={{ flex: 1 }}>
                      <div class="sdb-act-t">{item.title}</div>
                      <div class="sdb-act-s">{item.meta}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
