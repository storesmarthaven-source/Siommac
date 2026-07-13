/**
 * src/lib/charts.ts
 *
 * Chart rendering — ported from assets/js/charts.js.
 * Wraps Chart.js (loaded as a CDN global) with the same public API as the
 * original IIFE and registers itself on window.SiomacCharts so Dashboard,
 * nav.js, and app.js callers keep working unchanged during the transition.
 *
 * Public API (identical to legacy):
 *   SiomacCharts.displayAttendanceChart(stats)
 *   SiomacCharts.displayTrendChart(records)
 *   SiomacCharts.renderDashboardCharts(data)
 *   SiomacCharts.updateDashboardCharts(data)
 *   SiomacCharts.hasAttendanceChart() → boolean
 *   SiomacCharts.hasTrendChart()      → boolean
 *   SiomacCharts.pinCanvas(canvas, fallbackW?, fallbackH?) → void
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

// ── Chart.js CDN-global type shim ─────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Chart: any;

// ── Module-local state ────────────────────────────────────────────────────────

let _attendanceChart: any = null;
let _trendChart:      any = null;
const _dashCharts: Record<string, any> = {};

function _destroyDash(key: string): void {
  if (_dashCharts[key]) { _dashCharts[key].destroy(); Reflect.deleteProperty(_dashCharts, key); }
}

// ── Palette (matches design spec) ─────────────────────────────────────────────

const PALETTE = [
  '#E40C0C', '#1B2D55', '#FFB712', '#2A6F9C',
  '#5E6F8D', '#B23C1C', '#2E7D32', '#7C3AED', '#0891B2', '#DB2777',
];

// ── Initialise Chart.js global defaults (runs once on module import) ──────────

Chart.defaults.font.family = "'Inter', 'Poppins', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.color       = '#5E6F8D';

// ── Canvas helpers ────────────────────────────────────────────────────────────

/**
 * Pin a canvas element's pixel buffer to its container's inner content size.
 * responsive:false prevents Chart.js ResizeObserver from interrupting animations.
 */
export function pinCanvas(
  canvas:    HTMLCanvasElement,
  fallbackW  = 280,
  fallbackH  = 260,
): void {
  const p = canvas.parentElement;
  if (p) {
    const cs = getComputedStyle(p);
    const pw = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const ph = parseFloat(cs.paddingTop)  + parseFloat(cs.paddingBottom);
    canvas.width  = Math.max((p.clientWidth  - pw) || fallbackW, 1);
    canvas.height = Math.max((p.clientHeight - ph) || fallbackH, 1);
  } else {
    canvas.width  = fallbackW;
    canvas.height = fallbackH;
  }
}

/** Inject a centred spinner into a canvas's container. Returns a removal fn. */
function _spinner(canvasId: string): () => void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  const box    = canvas?.parentElement;
  if (!box) return () => { /* noop */ };
  const el = document.createElement('div');
  el.className = 'chart-spinner-wrap';
  el.innerHTML = '<div class="chart-spinner"></div>';
  box.appendChild(el);
  return () => { el.parentNode?.removeChild(el); };
}

// ── Employee charts ───────────────────────────────────────────────────────────

/** Personal attendance donut (employee view). */
export function displayAttendanceChart(stats: {
  present: number; absent: number; sundays: number;
}): void {
  const canvas = document.getElementById('attendanceChart') as HTMLCanvasElement | null;
  if (!canvas) return;
  if (_attendanceChart) _attendanceChart.destroy();
  pinCanvas(canvas, 260, 260);
  _attendanceChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Present', 'Absent', 'Sundays'],
      datasets: [{
        data:            [stats.present, stats.absent, stats.sundays],
        backgroundColor: ['#2E7D32', '#E40C0C', '#1B2D55'],
        borderWidth:     0,
        hoverOffset:     8,
      }],
    },
    options: {
      responsive:          false,
      maintainAspectRatio: false,
      cutout:              '65%',
      animation:           { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 12 } },
      },
    },
  });
}

/** Personal hours trend bar chart (employee view). */
export function displayTrendChart(records: { date: string; hours: number | string }[]): void {
  const canvas = document.getElementById('attendanceTrendChart') as HTMLCanvasElement | null;
  if (!canvas) return;
  if (_trendChart) _trendChart.destroy();
  pinCanvas(canvas, 500, 240);
  const sorted = records.slice().reverse();
  _trendChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: sorted.map(r => r.date.slice(5)),
      datasets: [{
        label:           'Hours',
        data:            sorted.map(r => Number(r.hours) || 0),
        backgroundColor: 'rgba(228,12,12,0.75)',
        borderColor:     '#E40C0C',
        borderWidth:     0,
        borderRadius:    6,
        borderSkipped:   false,
        maxBarThickness: 28,
      }],
    },
    options: {
      responsive:          false,
      maintainAspectRatio: false,
      animation:           { duration: 800, easing: 'easeOutQuart' },
      plugins: {
        legend:  { display: false },
        tooltip: { callbacks: { label: (c: any) => ' ' + c.parsed.y + ' hrs' } },
      },
      scales: {
        y: { beginAtZero: true, suggestedMax: 10, ticks: { stepSize: 2, font: { size: 10 } }, grid: { color: '#E9EEF3' } },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

// ── Admin dashboard chart renderers ───────────────────────────────────────────

function _renderTrendLine(data: { date: string; present: number; late: number }[], rmSpinner: () => void): void {
  _destroyDash('trend');
  const canvas = document.getElementById('trendLineChart') as HTMLCanvasElement | null;
  if (!canvas) return;
  pinCanvas(canvas, 600, 260);
  _dashCharts.trend = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: data.map(d => d.date.slice(5)),
      datasets: [
        {
          label:                    'Present',
          data:                     data.map(d => d.present),
          borderColor:              '#E40C0C',
          backgroundColor:          'rgba(228,12,12,0.08)',
          borderWidth:              2.5,
          tension:                  0.5,
          cubicInterpolationMode:   'monotone',
          fill:                     true,
          pointBackgroundColor:     '#E40C0C',
          pointBorderColor:         'white',
          pointBorderWidth:         2,
          pointRadius:              4,
          pointHoverRadius:         6,
        },
        {
          label:                  'Late',
          data:                   data.map(d => d.late),
          borderColor:            '#FFB712',
          backgroundColor:        'transparent',
          borderWidth:            2,
          borderDash:             [5, 5],
          tension:                0.5,
          cubicInterpolationMode: 'monotone',
          fill:                   false,
          pointRadius:            3,
          pointHoverRadius:       5,
          pointBackgroundColor:   '#FFB712',
        },
      ],
    },
    options: {
      responsive:          false,
      maintainAspectRatio: false,
      animation:           { duration: 1000, easing: 'easeOutCubic' },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, padding: 16 } },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#E9EEF3' }, ticks: { font: { size: 10 } } },
        x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      },
    },
  });
  rmSpinner();
}

function _renderDeptDist(data: { name: string; count: number }[], rmSpinner: () => void): void {
  _destroyDash('dept');
  const canvas = document.getElementById('deptDistChart') as HTMLCanvasElement | null;
  if (!canvas) return;
  pinCanvas(canvas, 260, 260);
  _dashCharts.dept = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.name),
      datasets: [{
        data:            data.map(d => d.count),
        backgroundColor: data.map((_, i) => PALETTE[i % PALETTE.length]!),
        borderWidth:     0,
        hoverOffset:     8,
      }],
    },
    options: {
      responsive:          false,
      maintainAspectRatio: false,
      cutout:              '65%',
      animation:           { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } },
      },
    },
  });
  rmSpinner();
}

function _renderStatusBars(
  stats:     { present: number; late: number; absent: number; onLeave: number },
  rmSpinner: () => void,
): void {
  _destroyDash('status');
  const canvas = document.getElementById('statusBarChart') as HTMLCanvasElement | null;
  if (!canvas) return;
  pinCanvas(canvas, 320, 260);
  _dashCharts.status = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Present', 'Late', 'Absent', 'On Leave'],
      datasets: [{
        data:            [stats.present, stats.late, stats.absent, stats.onLeave],
        backgroundColor: [
          'rgba(46,125,50,0.85)',
          'rgba(255,183,18,0.85)',
          'rgba(228,12,12,0.85)',
          'rgba(27,45,85,0.75)',
        ],
        borderColor:     ['#2E7D32', '#FFB712', '#E40C0C', '#1B2D55'],
        borderWidth:     0,
        borderRadius:    8,
        borderSkipped:   false,
        maxBarThickness: 56,
      }],
    },
    options: {
      responsive:          false,
      maintainAspectRatio: false,
      animation:           { duration: 800, easing: 'easeOutQuart' },
      plugins: {
        legend:  { display: false },
        tooltip: { callbacks: { label: (c: any) => ' ' + c.parsed.y + ' employees' } },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#E9EEF3' }, ticks: { stepSize: 1, font: { size: 10 } } },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
  rmSpinner();
}

function _renderLeaveTypes(
  types:     { sick: number; casual: number; annual: number; medical: number },
  rmSpinner: () => void,
): void {
  _destroyDash('leaves');
  const canvas = document.getElementById('leaveTypesChart') as HTMLCanvasElement | null;
  if (!canvas) return;
  pinCanvas(canvas, 260, 260);
  _dashCharts.leaves = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Sick', 'Casual', 'Annual', 'Medical'],
      datasets: [{
        data:            [types.sick, types.casual, types.annual, types.medical],
        backgroundColor: ['#E40C0C', '#1B2D55', '#2E7D32', '#FFB712'],
        borderWidth:     0,
        hoverOffset:     8,
      }],
    },
    options: {
      responsive:          false,
      maintainAspectRatio: false,
      cutout:              '65%',
      animation:           { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } },
      },
    },
  });
  rmSpinner();
}

// ── Stat panel population helpers ─────────────────────────────────────────────

function _pct(n: number, total: number): string {
  return total > 0 ? Math.round((n / total) * 100) + '%' : '—';
}

function _setText(id: string, v: number | string | null | undefined): void {
  const el = document.getElementById(id);
  if (el) el.textContent = String(v ?? '—');
}

function _populateDeptStats(depts: { name: string; count?: number }[]): void {
  const list = document.getElementById('deptStatsList');
  if (!list) return;
  const total = depts.reduce((s, d) => s + (d.count ?? 0), 0);
  list.innerHTML = depts.map((d, i) => `
    <div class="dash-chart-stat-item">
      <span class="dash-stat-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <span class="dash-stat-label">${d.name}</span>
      <span class="dash-stat-pct">${_pct(d.count ?? 0, total)}</span>
      <span class="dash-stat-val">${d.count ?? '—'}</span>
    </div>`).join('');
}

function _populateStatusStats(s: { present?: number; late?: number; absent?: number; onLeave?: number }): void {
  const total = (s.present ?? 0) + (s.late ?? 0) + (s.absent ?? 0) + (s.onLeave ?? 0);
  _setText('statusStatPresent', s.present ?? '—');
  _setText('statusStatLate',    s.late    ?? '—');
  _setText('statusStatAbsent',  s.absent  ?? '—');
  _setText('statusStatLeave',   s.onLeave ?? '—');
  _setText('statusStatTotal',   total || '—');
  _setText('statusStatRate',    _pct((s.present ?? 0) + (s.late ?? 0), total));
}

function _populateLeaveStats(l: { sick?: number; casual?: number; annual?: number; medical?: number }): void {
  const total = (l.sick ?? 0) + (l.casual ?? 0) + (l.annual ?? 0) + (l.medical ?? 0);
  _setText('leaveStatSick',    l.sick    ?? '—');
  _setText('leaveStatCasual',  l.casual  ?? '—');
  _setText('leaveStatAnnual',  l.annual  ?? '—');
  _setText('leaveStatMedical', l.medical ?? '—');
  _setText('leaveStatTotal',   total || '—');
}

// ── Composite render / update ─────────────────────────────────────────────────

export interface DashboardChartData {
  dailyTrend:        { date: string; present: number; late: number }[];
  deptDistribution:  { name: string; count: number }[];
  statusBreakdown:   { present: number; late: number; absent: number; onLeave: number };
  leaveTypes:        { sick: number; casual: number; annual: number; medical: number };
}

/** Full render — spinners → double-rAF → draw all four charts. */
export function renderDashboardCharts(data: DashboardChartData): void {
  const rm = {
    trend:  _spinner('trendLineChart'),
    dept:   _spinner('deptDistChart'),
    status: _spinner('statusBarChart'),
    leaves: _spinner('leaveTypesChart'),
  };
  // Double rAF: first frame applies display:block, second frame the browser has
  // measured layout so canvases have real dimensions for animation.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    _renderTrendLine(data.dailyTrend ?? [],       rm.trend);
    _renderDeptDist(data.deptDistribution ?? [],  rm.dept);
    _renderStatusBars(data.statusBreakdown ?? {} as any, rm.status);
    _renderLeaveTypes(data.leaveTypes ?? {} as any,      rm.leaves);
    _populateDeptStats(data.deptDistribution ?? []);
    _populateStatusStats(data.statusBreakdown ?? {});
    _populateLeaveStats(data.leaveTypes ?? {});
  }));
}

/** Silent in-place update — patches existing chart instances without redraw flicker. */
export function updateDashboardCharts(data: Partial<DashboardChartData>): void {
  if (_dashCharts.trend && data.dailyTrend) {
    const t = _dashCharts.trend;
    t.data.labels              = data.dailyTrend.map(d => d.date.slice(5));
    t.data.datasets[0].data    = data.dailyTrend.map(d => d.present);
    t.data.datasets[1].data    = data.dailyTrend.map(d => d.late);
    t.update('none');
  }
  if (_dashCharts.dept && data.deptDistribution) {
    _dashCharts.dept.data.labels              = data.deptDistribution.map(d => d.name);
    _dashCharts.dept.data.datasets[0].data    = data.deptDistribution.map(d => d.count);
    _dashCharts.dept.update('none');
    _populateDeptStats(data.deptDistribution);
  }
  if (_dashCharts.status && data.statusBreakdown) {
    const s = data.statusBreakdown;
    _dashCharts.status.data.datasets[0].data = [s.present, s.late, s.absent, s.onLeave];
    _dashCharts.status.update('none');
    _populateStatusStats(s);
  }
  if (_dashCharts.leaves && data.leaveTypes) {
    const l = data.leaveTypes;
    _dashCharts.leaves.data.datasets[0].data = [l.sick, l.casual, l.annual, l.medical];
    _dashCharts.leaves.update('none');
    _populateLeaveStats(l);
  }
}

export function hasAttendanceChart(): boolean { return !!_attendanceChart; }
export function hasTrendChart():      boolean { return !!_trendChart; }

// ── Public API object ─────────────────────────────────────────────────────────

export const SiomacCharts = {
  displayAttendanceChart,
  displayTrendChart,
  renderDashboardCharts,
  updateDashboardCharts,
  hasAttendanceChart,
  hasTrendChart,
  pinCanvas,
};

// ── window shim — legacy callers use window.SiomacCharts ─────────────────────
(window as unknown as Record<string, unknown>).SiomacCharts = SiomacCharts;
