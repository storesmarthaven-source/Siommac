/**
 * src/ui/widgets/registry.hrOnboarding.tsx — HR Onboarding dashboard KPI widgets.
 *
 * FAITHFUL port of the OnboardPro overview KPI row
 * (onboarding_overview_exact_replica_no_sidebar_fluid_v3.html): each card is the mockup's `.kpi`
 * (cap row with tinted icon, big number, delta, and a sparkline / ring / growth chart on the right),
 * adapted to FILL its stack-grid board cell (styles in onboardingWidgets.css, scoped `.obw`).
 *
 * Data is REAL — every card reads useOnboardingDashboard (the dashboard-stats endpoint). Charts are
 * drawn from the data we actually have (Active Cases ← weeklyTrend; Blocked ← module split; Readiness
 * ← readyPercent ring); deltas show a real sub-stat, never a fabricated "vs last 7 days".
 * Auto-registered via the `widgets` export (see the widget guide).
 */
import type { WidgetDef } from './types';
import { useOnboardingDashboard, useOnboardingRecentActivity } from '@api/hr/onboarding';
import './onboardingWidgets.css';

const ONB_PAGES = ['hr.onboarding.overview'];
const ONB_ZONES = ['main', 'overview'];
const ONB_SOURCE = { sourceKey: 'hr_onboarding', label: 'HR Onboarding', refreshIntervalMs: 300000, permissions: ['hr.onboarding.view'] };

const KPI_SIZES = [
  { key: 'compact' as const, label: 'Compact', grid: { w: 3, h: 2 }, description: 'Metric + chart.' },
  { key: 'standard' as const, label: 'Standard', grid: { w: 4, h: 3 }, description: 'Metric + chart, roomier.' },
];
const LIST_SIZES = [
  { key: 'wide' as const, label: 'Wide', grid: { w: 6, h: 3 }, description: 'Full list.' },
  { key: 'standard' as const, label: 'Standard', grid: { w: 4, h: 3 }, description: 'Narrower list.' },
];

// ── relative time + action humanizer (Recent Activity feed) ──────────────────────
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
function humanizeAction(action: string): string {
  const s = action.replace(/^hr\.onboarding\./, '').replace(/[_.]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── tiny self-contained charts (match the mockup's spark / ring / growth) ─────────
function sparkPath(points: number[], w = 110, h = 56, pad = 5): { line: string; area: string } {
  if (points.length < 2) return { line: '', area: '' };
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const xy = points.map((p, i) => [pad + i * stepX, pad + (h - pad * 2) * (1 - (p - min) / span)] as const);
  const first = xy[0]!, last = xy[xy.length - 1]!;
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${last[0].toFixed(1)} ${h} L${first[0].toFixed(1)} ${h} Z`;
  return { line, area };
}
function Spark({ points, color }: { points: number[]; color: string }) {
  const { line, area } = sparkPath(points);
  if (!line) return <div class="obw-spark" />;
  const gid = `obspark-${color.replace('#', '')}`;
  return (
    <div class="obw-spark">
      <svg viewBox="0 0 110 56" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop stop-color={color} stop-opacity=".18" /><stop offset="1" stop-color={color} stop-opacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
  );
}
function Growth({ values, color = '#14a06a' }: { values: number[]; color?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div class="obw-growth">
      {values.map((v, i) => <i key={i} style={{ height: `${Math.max(8, Math.round((v / max) * 46))}px`, background: color }} />)}
    </div>
  );
}
function Ring({ percent, color = '#0aa36c' }: { percent: number; color?: string }) {
  const r = 32, c = 2 * Math.PI * r, dash = Math.max(0, Math.min(100, percent)) / 100 * c;
  return (
    <div class="obw-ring">
      <svg viewBox="0 0 86 86">
        <circle cx="43" cy="43" r={r} fill="none" stroke="#e6ecf3" stroke-width="8" />
        <circle cx="43" cy="43" r={r} fill="none" stroke={color} stroke-width="8"
          stroke-dasharray={`${dash.toFixed(1)} ${(c - dash).toFixed(1)}`} stroke-linecap="round" transform="rotate(-90 43 43)" />
      </svg>
    </div>
  );
}
const pctChange = (pts: number[]): number => {
  const first = pts[0], last = pts[pts.length - 1];
  if (first === undefined || last === undefined || first === 0) return 0;
  return Math.round(((last - first) / first) * 1000) / 10;
};

export const widgets: WidgetDef[] = [
  // ── Active Cases ──────────────────────────────────────────────────────────────
  {
    id: 'hr.onboarding.activeCases', module: 'hr', area: 'onboarding',
    title: 'Active Cases',
    description: 'Onboarding cases in flight, with new-hire / transfer / contractor split + weekly trend.',
    icon: 'fa-folder-open', category: 'KPIs', tags: ['onboarding', 'cases', 'kpi', 'trend'],
    previewVariant: 'metric', chrome: 'none', supportedPages: ONB_PAGES, supportedZones: ONB_ZONES,
    defaultSize: 'compact', allowedSizes: KPI_SIZES,
    defaultConfig: {}, configSchema: [], dataSource: ONB_SOURCE, recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const a = q.data?.activeCases;
      const trend = (a?.weeklyTrend ?? []).map(t => t.count);
      const chg = pctChange(trend);
      return (
        <div class="obw">
          <div class="obw-kpi">
            <div class="obw-kpi-main">
              <div class="obw-cap"><span class="obw-kpi-icon"><i class="fas fa-folder-open" /></span>Active Cases</div>
              <h2 class="obw-num">{a?.total ?? 0}</h2>
              <div class={`obw-delta${chg < 0 ? ' red' : ''}`}>{chg >= 0 ? '↑' : '↓'} {Math.abs(chg)}% <span class="vs">over recent weeks</span></div>
            </div>
            <Spark points={trend} color="#0b63f6" />
          </div>
          <div class="obw-delta" style={{ padding: '0 16px 12px', marginTop: 0 }}>
            <span class="vs">{a?.newHires ?? 0} new · {a?.transfers ?? 0} transfers · {a?.contractors ?? 0} contractors</span>
          </div>
        </div>
      );
    },
    renderPreview: () => (
      <div class="obw">
        <div class="obw-kpi">
          <div class="obw-kpi-main">
            <div class="obw-cap"><span class="obw-kpi-icon"><i class="fas fa-folder-open" /></span>Active Cases</div>
            <h2 class="obw-num">248</h2>
            <div class="obw-delta">↑ 12.6% <span class="vs">over recent weeks</span></div>
          </div>
          <Spark points={[180, 196, 210, 225, 240, 248]} color="#0b63f6" />
        </div>
        <div class="obw-delta" style={{ padding: '0 16px 12px', marginTop: 0 }}><span class="vs">170 new · 42 transfers · 36 contractors</span></div>
      </div>
    ),
  },
  // ── Due This Week ─────────────────────────────────────────────────────────────
  {
    id: 'hr.onboarding.dueThisWeek', module: 'hr', area: 'onboarding',
    title: 'Due This Week',
    description: 'Onboarding tasks due in the next 7 days, with due-today / overdue / critical counts.',
    icon: 'fa-calendar-check', category: 'KPIs', tags: ['onboarding', 'due', 'overdue', 'kpi'],
    previewVariant: 'metric', chrome: 'none', supportedPages: ONB_PAGES, supportedZones: ONB_ZONES,
    defaultSize: 'compact', allowedSizes: KPI_SIZES,
    defaultConfig: {}, configSchema: [], dataSource: ONB_SOURCE, recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const d = q.data?.dueThisWeek;
      const overdue = d?.overdue ?? 0;
      return (
        <div class="obw">
          <div class="obw-kpi">
            <div class="obw-kpi-main">
              <div class="obw-cap"><span class="obw-kpi-icon purple"><i class="fas fa-calendar-check" /></span>Due This Week</div>
              <h2 class="obw-num">{d?.dueIn7Days ?? 0}</h2>
              <div class={`obw-delta${overdue > 0 ? ' red' : ''}`}>{overdue} overdue <span class="vs">· {d?.dueToday ?? 0} due today</span></div>
            </div>
            <Growth values={[d?.dueToday ?? 0, overdue, d?.criticalOverdue ?? 0, d?.dueIn7Days ?? 0]} color="#6746f2" />
          </div>
          <div class="obw-delta" style={{ padding: '0 16px 12px', marginTop: 0 }}>
            <span class="vs">{d?.dueToday ?? 0} today · {overdue} overdue · {d?.criticalOverdue ?? 0} critical</span>
          </div>
        </div>
      );
    },
    renderPreview: () => (
      <div class="obw">
        <div class="obw-kpi">
          <div class="obw-kpi-main">
            <div class="obw-cap"><span class="obw-kpi-icon purple"><i class="fas fa-calendar-check" /></span>Due This Week</div>
            <h2 class="obw-num">47</h2>
            <div class="obw-delta red">6 overdue <span class="vs">· 9 due today</span></div>
          </div>
          <Growth values={[9, 6, 2, 47]} color="#6746f2" />
        </div>
        <div class="obw-delta" style={{ padding: '0 16px 12px', marginTop: 0 }}><span class="vs">9 today · 6 overdue · 2 critical</span></div>
      </div>
    ),
  },
  // ── Blocked Cases ─────────────────────────────────────────────────────────────
  {
    id: 'hr.onboarding.blockedCases', module: 'hr', area: 'onboarding',
    title: 'Blocked Cases',
    description: 'Cases blocked by an open dependency, broken down by blocking module.',
    icon: 'fa-triangle-exclamation', category: 'KPIs', tags: ['onboarding', 'blocked', 'blockers', 'kpi'],
    previewVariant: 'status-stack', chrome: 'none', supportedPages: ONB_PAGES, supportedZones: ONB_ZONES,
    defaultSize: 'compact', allowedSizes: KPI_SIZES,
    defaultConfig: {}, configSchema: [], dataSource: ONB_SOURCE, recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const b = q.data?.blockingTasks;
      return (
        <div class="obw">
          <div class="obw-kpi">
            <div class="obw-kpi-main">
              <div class="obw-cap"><span class="obw-kpi-icon red"><i class="fas fa-triangle-exclamation" /></span>Blocked Cases</div>
              <h2 class="obw-num">{b?.blockedCases ?? 0}</h2>
              <div class="obw-delta red">{(b?.documents ?? 0) + (b?.training ?? 0) + (b?.hse ?? 0) + (b?.payroll ?? 0)} open dependencies</div>
            </div>
            <Growth values={[b?.documents ?? 0, b?.training ?? 0, b?.hse ?? 0, b?.payroll ?? 0]} color="#fb4e14" />
          </div>
          <div class="obw-delta" style={{ padding: '0 16px 12px', marginTop: 0 }}>
            <span class="vs">{b?.documents ?? 0} docs · {b?.training ?? 0} training · {b?.hse ?? 0} HSE · {b?.payroll ?? 0} payroll</span>
          </div>
        </div>
      );
    },
    renderPreview: () => (
      <div class="obw">
        <div class="obw-kpi">
          <div class="obw-kpi-main">
            <div class="obw-cap"><span class="obw-kpi-icon red"><i class="fas fa-triangle-exclamation" /></span>Blocked Cases</div>
            <h2 class="obw-num">18</h2>
            <div class="obw-delta red">18 open dependencies</div>
          </div>
          <Growth values={[7, 4, 5, 2]} color="#fb4e14" />
        </div>
        <div class="obw-delta" style={{ padding: '0 16px 12px', marginTop: 0 }}><span class="vs">7 docs · 4 training · 5 HSE · 2 payroll</span></div>
      </div>
    ),
  },
  // ── Activation Readiness ──────────────────────────────────────────────────────
  {
    id: 'hr.onboarding.activationReadiness', module: 'hr', area: 'onboarding',
    title: 'Activation Readiness',
    description: 'Share of cases ready to activate, with profile / documents / training / access readiness.',
    icon: 'fa-shield-halved', category: 'KPIs', tags: ['onboarding', 'readiness', 'activation', 'kpi'],
    previewVariant: 'donut', chrome: 'none', supportedPages: ONB_PAGES, supportedZones: ONB_ZONES,
    defaultSize: 'compact', allowedSizes: KPI_SIZES,
    defaultConfig: {}, configSchema: [], dataSource: ONB_SOURCE, recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const r = q.data?.activationReadiness;
      return (
        <div class="obw">
          <div class="obw-kpi">
            <div class="obw-kpi-main">
              <div class="obw-cap"><span class="obw-kpi-icon green"><i class="fas fa-shield-halved" /></span>Activation Readiness</div>
              <h2 class="obw-num">{r?.readyPercent ?? 0}%</h2>
              <div class="obw-delta">{r?.documentsReadyPercent ?? 0}% docs ready</div>
            </div>
            <Ring percent={r?.readyPercent ?? 0} />
          </div>
          <div class="obw-delta" style={{ padding: '0 16px 12px', marginTop: 0 }}>
            <span class="vs">{r?.profileReadyPercent ?? 0}% profile · {r?.trainingReadyPercent ?? 0}% training · {r?.accessReadyPercent ?? 0}% access</span>
          </div>
        </div>
      );
    },
    renderPreview: () => (
      <div class="obw">
        <div class="obw-kpi">
          <div class="obw-kpi-main">
            <div class="obw-cap"><span class="obw-kpi-icon green"><i class="fas fa-shield-halved" /></span>Activation Readiness</div>
            <h2 class="obw-num">78%</h2>
            <div class="obw-delta">84% docs ready</div>
          </div>
          <Ring percent={78} />
        </div>
        <div class="obw-delta" style={{ padding: '0 16px 12px', marginTop: 0 }}><span class="vs">90% profile · 71% training · 66% access</span></div>
      </div>
    ),
  },
  // ── Onboarding Health (derived) ───────────────────────────────────────────────
  {
    id: 'hr.onboarding.health', module: 'hr', area: 'onboarding',
    title: 'Onboarding Health',
    description: 'Overall onboarding health, derived from activation readiness and blocked-case load, with weekly trend.',
    icon: 'fa-heart-pulse', category: 'KPIs', tags: ['onboarding', 'health', 'kpi', 'trend'],
    previewVariant: 'metric', chrome: 'none', supportedPages: ONB_PAGES, supportedZones: ONB_ZONES,
    defaultSize: 'compact', allowedSizes: KPI_SIZES,
    defaultConfig: {}, configSchema: [], dataSource: ONB_SOURCE, recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const ready = q.data?.activationReadiness?.readyPercent ?? 0;
      const blocked = q.data?.blockingTasks?.blockedCases ?? 0;
      const total = q.data?.activeCases?.total ?? 0;
      const blockedShare = total ? blocked / total : 0;
      const trend = (q.data?.activeCases?.weeklyTrend ?? []).map(t => t.count);
      const health = ready >= 75 && blockedShare <= 0.1 ? { label: 'Good', color: '#0aa36c' }
        : ready >= 50 && blockedShare <= 0.25 ? { label: 'Watch', color: '#d97706' }
          : { label: 'At Risk', color: '#f04444' };
      return (
        <div class="obw">
          <div class="obw-kpi">
            <div class="obw-kpi-main">
              <div class="obw-cap"><span class="obw-kpi-icon green"><i class="fas fa-heart-pulse" /></span>Onboarding Health</div>
              <h2 class="obw-num word" style={{ color: health.color }}>{q.isLoading && !q.data ? '—' : health.label}</h2>
              <div class="obw-delta"><span class="vs">{ready}% ready · {blocked} blocked of {total}</span></div>
            </div>
            <Growth values={trend.length ? trend : [0]} color={health.color} />
          </div>
        </div>
      );
    },
    renderPreview: () => (
      <div class="obw">
        <div class="obw-kpi">
          <div class="obw-kpi-main">
            <div class="obw-cap"><span class="obw-kpi-icon green"><i class="fas fa-heart-pulse" /></span>Onboarding Health</div>
            <h2 class="obw-num word">Good</h2>
            <div class="obw-delta"><span class="vs">78% ready · 18 blocked of 248</span></div>
          </div>
          <Growth values={[13, 18, 24, 31, 38, 45]} color="#0aa36c" />
        </div>
      </div>
    ),
  },
  // ── Package Readiness ─────────────────────────────────────────────────────────
  {
    id: 'hr.onboarding.packageReadiness', module: 'hr', area: 'onboarding',
    title: 'Package Readiness',
    description: 'Activation readiness broken down by onboarding package.',
    icon: 'fa-chart-bar', category: 'KPIs', tags: ['onboarding', 'packages', 'readiness', 'kpi'],
    previewVariant: 'status-stack', chrome: 'none', supportedPages: ONB_PAGES, supportedZones: ONB_ZONES,
    defaultSize: 'wide', allowedSizes: LIST_SIZES,
    defaultConfig: {}, configSchema: [], dataSource: ONB_SOURCE, recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingDashboard();
      const rows = q.data?.packageReadiness ?? [];
      return (
        <div class="obw">
          <div class="obw-pt"><h3><i class="fas fa-chart-bar" style={{ color: '#0b63f6' }} />Package Readiness</h3><span class="obw-count">{rows.length}</span></div>
          <div class="obw-pb">
            {rows.length ? (
              <div class="obw-rl">
                {rows.map(r => (
                  <div class="obw-ready" key={r.packageKey}>
                    <span>{r.packageLabel} <span style={{ color: '#94a3b8' }}>({r.activeCount})</span></span>
                    <div class={`obw-bar${r.readyPercent >= 75 ? '' : r.readyPercent >= 40 ? ' orange' : ' red'}`}><span style={{ width: `${r.readyPercent}%` }} /></div>
                    <span>{r.readyPercent}%</span>
                  </div>
                ))}
              </div>
            ) : <div class="obw-empty">No active packages.</div>}
          </div>
        </div>
      );
    },
    renderPreview: () => (
      <div class="obw">
        <div class="obw-pt"><h3><i class="fas fa-chart-bar" style={{ color: '#0b63f6' }} />Package Readiness</h3><span class="obw-count">4</span></div>
        <div class="obw-pb">
          <div class="obw-rl">
            {[{ n: 'Remote new hire', a: 12, p: 91 }, { n: 'Standard new hire', a: 34, p: 82 }, { n: 'Contractor fast-track', a: 19, p: 64 }, { n: 'Executive onboarding', a: 3, p: 40 }].map(r => (
              <div class="obw-ready" key={r.n}>
                <span>{r.n} <span style={{ color: '#94a3b8' }}>({r.a})</span></span>
                <div class={`obw-bar${r.p >= 75 ? '' : r.p >= 40 ? ' orange' : ' red'}`}><span style={{ width: `${r.p}%` }} /></div>
                <span>{r.p}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
  },
  // ── Recent Activity ────────────────────────────────────────────────────────────
  {
    id: 'hr.onboarding.recentActivity', module: 'hr', area: 'onboarding',
    title: 'Recent Activity',
    description: 'The latest onboarding actions across all cases and packages.',
    icon: 'fa-timeline', category: 'KPIs', tags: ['onboarding', 'activity', 'audit', 'feed'],
    previewVariant: 'status-stack', chrome: 'none', supportedPages: ONB_PAGES, supportedZones: ONB_ZONES,
    defaultSize: 'wide', allowedSizes: LIST_SIZES,
    defaultConfig: {}, configSchema: [], dataSource: ONB_SOURCE, recommendedFor: ONB_PAGES,
    render: () => {
      const q = useOnboardingRecentActivity(8);
      const rows = q.data ?? [];
      return (
        <div class="obw">
          <div class="obw-pt"><h3><i class="fas fa-timeline" style={{ color: '#6746f2' }} />Recent Activity</h3></div>
          <div class="obw-pb">
            {rows.length ? (
              <div class="obw-acts">
                {rows.map(r => (
                  <div class="obw-act" key={r.id}>
                    <span class="obw-act-icon"><i class="fas fa-circle-check" /></span>
                    <div>
                      <div class="obw-act-title">{humanizeAction(r.action)}</div>
                      <div class="obw-act-meta">{r.actorName ?? 'System'}</div>
                    </div>
                    <span class="obw-act-time">{timeAgo(r.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : <div class="obw-empty">No recent activity.</div>}
          </div>
        </div>
      );
    },
    renderPreview: () => (
      <div class="obw">
        <div class="obw-pt"><h3><i class="fas fa-timeline" style={{ color: '#6746f2' }} />Recent Activity</h3></div>
        <div class="obw-pb">
          <div class="obw-acts">
            {[
              { t: 'Case marked ready for activation', w: 'A. Cole', a: '2h ago' },
              { t: 'Task completed: Provision laptop', w: 'IT bot', a: '4h ago' },
              { t: 'New case started', w: 'M. Reyes', a: '6h ago' },
              { t: 'Blocker escalated', w: 'System', a: '9h ago' },
            ].map((r, i) => (
              <div class="obw-act" key={i}>
                <span class="obw-act-icon"><i class="fas fa-circle-check" /></span>
                <div>
                  <div class="obw-act-title">{r.t}</div>
                  <div class="obw-act-meta">{r.w}</div>
                </div>
                <span class="obw-act-time">{r.a}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
  },
];
