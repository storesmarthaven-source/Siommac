/**
 * src/components/sections/HR/offboardingWidgets.tsx
 *
 * HR ▸ Offboarding — the composed, mixed-size widget dashboard that sits between the
 * page header and the cases table. Every widget is driven by REAL data:
 *   • enriched dashboard-stats (status/reason mix, task clearance, cross-module handoff
 *     clearance, access-removals, blockers, avg clearance time), and
 *   • the live cases list (upcoming exits, blocked & at-risk).
 * No mock numbers. Presentational only — all data + callbacks come from the page.
 * Scoped by `.ofw-*` in offboardingWidgets.css (app light palette).
 */
import { type VNode } from 'preact';
import type { OffboardingCaseRow, OffboardingDashboardStats, OffboardingReason, OffboardingStatus } from '../../../../types/hrOffboarding';
import './offboardingWidgets.css';

// ── meta / palette ──────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string }> = {
  in_progress:    { label: 'In progress',    color: '#2563eb' },
  ready_for_exit: { label: 'Ready for exit', color: '#7c3aed' },
  blocked:        { label: 'Blocked',        color: '#dc2626' },
  paused:         { label: 'Paused',         color: '#f59e0b' },
  open:           { label: 'Open',           color: '#0ea5e9' },
  draft:          { label: 'Draft',          color: '#94a3b8' },
  completed:      { label: 'Completed',      color: '#16a34a' },
  cancelled:      { label: 'Cancelled',      color: '#94a3b8' },
};
const REASON_META: Record<OffboardingReason, { label: string; color: string }> = {
  resignation:     { label: 'Resignation',     color: '#2563eb' },
  termination:     { label: 'Termination',     color: '#dc2626' },
  redundancy:      { label: 'Redundancy',      color: '#f59e0b' },
  end_of_contract: { label: 'End of contract', color: '#0ea5e9' },
  retirement:      { label: 'Retirement',      color: '#16a34a' },
};
const MODULE_META: Record<string, { label: string; sub: string; icon: string; color: string }> = {
  it:      { label: 'IT',      sub: 'Access & asset return', icon: 'fa-laptop-code',    color: '#2563eb' },
  finance: { label: 'Finance', sub: 'Final pay & settlement', icon: 'fa-coins',          color: '#16a34a' },
  hse:     { label: 'HSE',     sub: 'PPE return',             icon: 'fa-helmet-safety',  color: '#f59e0b' },
  hr:      { label: 'HR',      sub: 'Records & documents',    icon: 'fa-folder-open',    color: '#7c3aed' },
};
const moduleMeta = (m: string) => MODULE_META[m] ?? { label: m.toUpperCase(), sub: 'Cross-module handoff', icon: 'fa-arrow-right-arrow-left', color: '#64748b' };
const statusMeta = (s: string) => STATUS_META[s] ?? { label: s.replace(/_/g, ' '), color: '#94a3b8' };

// ── formatting helpers ────────────────────────────────────────────────────────────
const pct = (done: number, total: number): number => (total > 0 ? Math.round((done / total) * 100) : 0);
function humanize(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function fmtDay(iso: string): { mon: string; day: string } {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { mon: '—', day: '' };
  return { mon: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(), day: String(d.getDate()) };
}
function daysUntil(iso: string): number {
  const d = new Date(`${iso}T12:00:00`); const now = new Date(); now.setHours(12, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}
function relLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days}d`;
}

// ── primitive: half-circle gauge ──────────────────────────────────────────────────
function Gauge({ percent, color }: { percent: number; color: string }): VNode {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <svg class="ofw-gauge" viewBox="0 0 120 68" role="img" aria-label={`${p}%`}>
      <path class="ofw-gauge-track" d="M12 60 A48 48 0 0 1 108 60" pathLength={100} fill="none" stroke-width={11} stroke-linecap="round" />
      <path d="M12 60 A48 48 0 0 1 108 60" pathLength={100} fill="none" stroke={color} stroke-width={11} stroke-linecap="round" stroke-dasharray={`${p} 100`} />
    </svg>
  );
}

// ── primitive: donut ──────────────────────────────────────────────────────────────
function Donut({ slices, size = 128, thickness = 15 }: { slices: { label: string; value: number; color: string }[]; size?: number; thickness?: number }): VNode {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  // Pre-compute arc lengths and cumulative offsets without closure mutation.
  const activeSlices = slices.filter(s => s.value > 0);
  const { segs } = activeSlices.reduce<{ offset: number; segs: VNode[] }>(
    (acc, s) => {
      const len = (s.value / total) * c;
      const seg = (
        <circle key={s.label} cx={cx} cy={cx} r={r} fill="none" stroke={s.color} stroke-width={thickness}
          stroke-dasharray={`${len} ${c - len}`} stroke-dashoffset={-acc.offset} transform={`rotate(-90 ${cx} ${cx})`} />
      );
      return { offset: acc.offset + len, segs: [...acc.segs, seg] };
    },
    { offset: 0, segs: [] },
  );
  return (
    <svg class="ofw-donut-svg" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#eef2f7" stroke-width={thickness} />
      {segs}
    </svg>
  );
}

// ── metric strip (top) ─────────────────────────────────────────────────────────────
function MetricStrip({ stats }: { stats: OffboardingDashboardStats }): VNode {
  const clearance = pct(stats.taskClearance.done, stats.taskClearance.total);
  const readyBase = stats.activeCases + stats.readyForExit;
  const readyPct = pct(stats.readyForExit, readyBase);
  return (
    <div class="ofw-strip">
      <article class="ofw-metric ofw-metric-gauge">
        <div class="ofw-metric-head"><span class="ofw-metric-ico blue"><i class="fas fa-list-check" /></span><span>Exit clearance</span></div>
        <div class="ofw-metric-gaugewrap">
          <Gauge percent={clearance} color="#2563eb" />
          <div class="ofw-gauge-center"><strong>{clearance}%</strong></div>
        </div>
        <p class="ofw-metric-foot">{stats.taskClearance.done}/{stats.taskClearance.total} exit tasks done</p>
      </article>

      <article class="ofw-metric ofw-metric-gauge">
        <div class="ofw-metric-head"><span class="ofw-metric-ico purple"><i class="fas fa-door-open" /></span><span>Ready for exit</span></div>
        <div class="ofw-metric-gaugewrap">
          <Gauge percent={readyPct} color="#7c3aed" />
          <div class="ofw-gauge-center"><strong>{stats.readyForExit}</strong></div>
        </div>
        <p class="ofw-metric-foot">{readyPct}% of {readyBase} live cases</p>
      </article>

      <article class="ofw-metric">
        <div class="ofw-metric-head"><span class="ofw-metric-ico slate"><i class="fas fa-stopwatch" /></span><span>Avg clearance</span></div>
        <strong class="ofw-metric-num">{stats.avgClearanceDays ?? '—'}<em>{stats.avgClearanceDays != null ? ' days' : ''}</em></strong>
        <p class="ofw-metric-foot">Start → ready / complete</p>
      </article>

      <article class={`ofw-metric ${stats.pendingAccessRemovals > 0 ? 'is-alert' : ''}`}>
        <div class="ofw-metric-head"><span class="ofw-metric-ico red"><i class="fas fa-user-lock" /></span><span>Access removals</span></div>
        <strong class="ofw-metric-num">{stats.pendingAccessRemovals}</strong>
        <p class="ofw-metric-foot">Pending IT access cut-off</p>
      </article>
    </div>
  );
}

// ── large: exit readiness ──────────────────────────────────────────────────────────
function ExitReadinessCard({ stats, onReviewBlocked }: { stats: OffboardingDashboardStats; onReviewBlocked: () => void }): VNode {
  const clearance = pct(stats.taskClearance.done, stats.taskClearance.total);
  const facts: { label: string; value: number; tone?: string }[] = [
    { label: 'Active', value: stats.activeCases },
    { label: 'Ready', value: stats.readyForExit },
    { label: 'Blocked', value: stats.blocked, tone: stats.blocked ? 'red' : undefined },
    { label: 'Exited (mo)', value: stats.completedThisMonth, tone: 'green' },
  ];
  return (
    <article class="ofw-card ofw-lg ofw-readiness">
      <div class="ofw-readiness-top">
        <div>
          <span class="ofw-readiness-kicker"><i class="fas fa-shield-halved" /> Exit readiness</span>
          <h3>Clearance across live exits</h3>
          <p class="ofw-muted">Share of exit-clearance tasks completed on all in-flight cases.</p>
        </div>
        <div class="ofw-readiness-gauge">
          <Gauge percent={clearance} color="#2563eb" />
          <div class="ofw-gauge-center lg"><strong>{clearance}%</strong><span>cleared</span></div>
        </div>
      </div>
      <div class="ofw-readiness-facts">
        {facts.map(f => (
          <div class="ofw-fact" key={f.label}>
            <strong class={f.tone ? `tone-${f.tone}` : ''}>{f.value}</strong>
            <span>{f.label}</span>
          </div>
        ))}
      </div>
      <div class="ofw-readiness-foot">
        <span class="ofw-riskline">
          <i class="fas fa-triangle-exclamation" />
          <strong>{stats.blockingTasksOpen}</strong> blocking task{stats.blockingTasksOpen === 1 ? '' : 's'} · <strong>{stats.openBlockers}</strong> open blocker{stats.openBlockers === 1 ? '' : 's'}
          {stats.criticalBlockers > 0 ? <em class="crit"> · {stats.criticalBlockers} critical</em> : null}
        </span>
        <button class="ofw-btn" onClick={onReviewBlocked} disabled={stats.blocked === 0 && stats.openBlockers === 0}>Review blocked <i class="fas fa-arrow-right" /></button>
      </div>
    </article>
  );
}

// ── medium: cases by status donut ──────────────────────────────────────────────────
function StatusDonutCard({ stats, onPick }: { stats: OffboardingDashboardStats; onPick: (s: OffboardingStatus) => void }): VNode {
  const slices = stats.byStatus.map(s => ({ label: statusMeta(s.status).label, value: s.count, color: statusMeta(s.status).color }));
  const total = stats.byStatus.reduce((a, s) => a + s.count, 0);
  return (
    <article class="ofw-card ofw-md">
      <div class="ofw-card-head"><h3><i class="fas fa-chart-pie" /> Cases by status</h3></div>
      <div class="ofw-donut-body">
        <div class="ofw-donut-wrap">
          <Donut slices={slices} />
          <div class="ofw-donut-center"><strong>{total}</strong><span>cases</span></div>
        </div>
        <div class="ofw-legend">
          {stats.byStatus.length === 0 ? <p class="ofw-muted">No cases yet.</p> : stats.byStatus.map(s => {
            const m = statusMeta(s.status);
            return (
              <button class="ofw-legend-row" key={s.status} onClick={() => onPick(s.status)}>
                <span class="ofw-dot" style={{ background: m.color }} />
                <span class="ofw-legend-label">{m.label}</span>
                <strong>{s.count}</strong>
                <em>{pct(s.count, total)}%</em>
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}

// ── small: exit reasons mix ────────────────────────────────────────────────────────
function ReasonsMixCard({ stats }: { stats: OffboardingDashboardStats }): VNode {
  const total = stats.byReason.reduce((a, r) => a + r.count, 0) || 1;
  const rows = [...stats.byReason].sort((a, b) => b.count - a.count);
  return (
    <article class="ofw-card ofw-sm">
      <div class="ofw-card-head"><h3><i class="fas fa-scale-balanced" /> Exit reasons</h3></div>
      <div class="ofw-bars">
        {rows.length === 0 ? <p class="ofw-muted">No exits recorded.</p> : rows.map(r => {
          const m = REASON_META[r.reason];
          return (
            <div class="ofw-bar-row" key={r.reason}>
              <span class="ofw-bar-label">{m.label}</span>
              <span class="ofw-bar-track"><span class="ofw-bar-fill" style={{ width: `${pct(r.count, total)}%`, background: m.color }} /></span>
              <strong class="ofw-bar-val">{r.count}</strong>
            </div>
          );
        })}
      </div>
    </article>
  );
}

// ── large: cross-module clearance (handoffs) ───────────────────────────────────────
function ModuleClearanceCard({ stats }: { stats: OffboardingDashboardStats }): VNode {
  const h = stats.handoffs;
  return (
    <article class="ofw-card ofw-lg">
      <div class="ofw-card-head">
        <h3><i class="fas fa-arrow-right-arrow-left" /> Cross-module clearance</h3>
        <span class="ofw-head-meta">{h.delivered}/{h.total} delivered</span>
      </div>
      <div class="ofw-mod-summary">
        <div class="ofw-mod-chip amber"><strong>{h.pending}</strong><span>Pending</span></div>
        <div class="ofw-mod-chip green"><strong>{h.delivered}</strong><span>Delivered</span></div>
        <div class="ofw-mod-chip red"><strong>{stats.pendingAccessRemovals}</strong><span>Access cut-off</span></div>
      </div>
      <div class="ofw-mod-list">
        {stats.handoffsByModule.length === 0 ? <p class="ofw-muted">No cross-module handoffs raised yet.</p> : stats.handoffsByModule.map(m => {
          const meta = moduleMeta(m.module);
          const done = pct(m.delivered, m.total);
          return (
            <div class="ofw-mod-row" key={m.module}>
              <span class="ofw-mod-ico" style={{ background: `${meta.color}14`, color: meta.color }}><i class={`fas ${meta.icon}`} /></span>
              <div class="ofw-mod-copy">
                <strong>{meta.label}</strong>
                <span>{meta.sub}</span>
              </div>
              <div class="ofw-mod-progress">
                <span class="ofw-bar-track"><span class="ofw-bar-fill" style={{ width: `${done}%`, background: meta.color }} /></span>
                <em>{m.delivered}/{m.total}{m.pending > 0 ? ` · ${m.pending} pending` : ''}</em>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

// ── medium: upcoming exits (from live cases) ───────────────────────────────────────
function UpcomingExitsCard({ cases, onOpenCase }: { cases: OffboardingCaseRow[]; onOpenCase: (id: string) => void }): VNode {
  const upcoming = cases
    .filter(c => c.lastWorkingDay && c.status !== 'completed' && c.status !== 'cancelled')
    .sort((a, b) => (a.lastWorkingDay! < b.lastWorkingDay! ? -1 : 1))
    .slice(0, 6);
  return (
    <article class="ofw-card ofw-md">
      <div class="ofw-card-head"><h3><i class="fas fa-calendar-day" /> Upcoming last days</h3></div>
      {upcoming.length === 0 ? (
        <div class="ofw-empty"><i class="fas fa-calendar-check" /><span>No dated exits in flight.</span></div>
      ) : (
        <div class="ofw-exits">
          {upcoming.map(c => {
            const { mon, day } = fmtDay(c.lastWorkingDay!);
            const d = daysUntil(c.lastWorkingDay!);
            const rm = REASON_META[c.reason];
            return (
              <button class="ofw-exit-row" key={c.id} onClick={() => onOpenCase(c.id)}>
                <span class={`ofw-exit-date ${d < 0 ? 'overdue' : d <= 3 ? 'soon' : ''}`}><em>{mon}</em><strong>{day}</strong></span>
                <div class="ofw-exit-copy">
                  <strong>{c.employeeName ?? c.caseNo}</strong>
                  <span><span class="ofw-reason-dot" style={{ background: rm.color }} />{rm.label} · {c.caseNo}</span>
                </div>
                <span class={`ofw-exit-rel ${d < 0 ? 'overdue' : d <= 3 ? 'soon' : ''}`}>{relLabel(d)}</span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

// ── wide: blocked & at-risk exits ──────────────────────────────────────────────────
function BlockedAtRiskCard({ cases, onOpenCase }: { cases: OffboardingCaseRow[]; onOpenCase: (id: string) => void }): VNode {
  const atRisk = cases
    .filter(c => c.status === 'blocked' || c.blockerCount > 0 || c.status === 'paused')
    .sort((a, b) => b.blockerCount - a.blockerCount)
    .slice(0, 8);
  return (
    <article class="ofw-card ofw-xl">
      <div class="ofw-card-head"><h3><i class="fas fa-hand" /> Blocked &amp; at-risk exits</h3><span class="ofw-head-meta">{atRisk.length} case{atRisk.length === 1 ? '' : 's'}</span></div>
      {atRisk.length === 0 ? (
        <div class="ofw-empty ok"><i class="fas fa-circle-check" /><span>No blocked exits — clearance is on track.</span></div>
      ) : (
        <div class="ofw-risk-grid">
          {atRisk.map(c => {
            const m = statusMeta(c.status);
            const clearance = pct(c.taskCount - c.openTaskCount, c.taskCount);
            return (
              <button class="ofw-risk-card" key={c.id} onClick={() => onOpenCase(c.id)}>
                <div class="ofw-risk-top">
                  <span class="ofw-risk-pill" style={{ background: `${m.color}14`, color: m.color }}>{m.label}</span>
                  {c.blockerCount > 0 ? <span class="ofw-risk-blockers"><i class="fas fa-triangle-exclamation" />{c.blockerCount}</span> : null}
                </div>
                <strong class="ofw-risk-name">{c.employeeName ?? c.caseNo}</strong>
                <span class="ofw-risk-sub">{humanize(c.reason)} · {c.caseNo}</span>
                <div class="ofw-risk-meter"><span class="ofw-bar-track"><span class="ofw-bar-fill" style={{ width: `${clearance}%`, background: c.status === 'blocked' ? '#dc2626' : '#2563eb' }} /></span><em>{clearance}%</em></div>
                <span class="ofw-risk-owner"><i class="fas fa-user" />{c.ownerName ?? 'Unassigned'}</span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

// ── skeleton (cold path) ───────────────────────────────────────────────────────────
export function OffboardingDashboardSkeleton(): VNode {
  return (
    <div class="ofw" aria-hidden="true">
      <div class="ofw-strip">{[0, 1, 2, 3].map(i => <div class="ofw-metric ofw-skel" key={i} style={{ height: 132 }} />)}</div>
      <div class="ofw-grid">
        <div class="ofw-card ofw-lg ofw-skel" style={{ height: 220 }} />
        <div class="ofw-card ofw-md ofw-skel" style={{ height: 220 }} />
        <div class="ofw-card ofw-sm ofw-skel" style={{ height: 220 }} />
        <div class="ofw-card ofw-lg ofw-skel" style={{ height: 190 }} />
        <div class="ofw-card ofw-md ofw-skel" style={{ height: 190 }} />
      </div>
    </div>
  );
}

// ── composed dashboard ─────────────────────────────────────────────────────────────
export function OffboardingDashboard({ stats, cases, onOpenCase, onFilterStatus }: {
  stats: OffboardingDashboardStats;
  cases: OffboardingCaseRow[];
  onOpenCase: (id: string) => void;
  onFilterStatus: (status: OffboardingStatus) => void;
}): VNode {
  return (
    <div class="ofw">
      <MetricStrip stats={stats} />
      <div class="ofw-grid">
        <ExitReadinessCard stats={stats} onReviewBlocked={() => onFilterStatus('blocked')} />
        <StatusDonutCard stats={stats} onPick={onFilterStatus} />
        <ReasonsMixCard stats={stats} />
        <ModuleClearanceCard stats={stats} />
        <UpcomingExitsCard cases={cases} onOpenCase={onOpenCase} />
        <BlockedAtRiskCard cases={cases} onOpenCase={onOpenCase} />
      </div>
    </div>
  );
}
