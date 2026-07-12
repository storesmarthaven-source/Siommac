/**
 * src/components/sections/Attendance/AttendanceCharts.tsx
 *
 * Two Chart.js charts for the Attendance section:
 *   1. Daily Attendance Trend — line (bar when single day)
 *   2. Status Distribution    — doughnut
 *
 * Chart.js is a CDN global accessed via (window as any).Chart.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Spinner } from '@shared/Spinner';
import { fmtDate } from './utils';
import type { DailyTrend, AttendanceRow } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const COLOR_PRESENT = '#2E7D32';
const COLOR_LATE    = '#FFB712';
const COLOR_ABSENT  = '#E40C0C';

// ── ChartJS global type shim ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyChart = any;

function getChartConstructor(): (new (...args: unknown[]) => AnyChart) | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Chart ?? null;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AttendanceChartsProps {
  trend:   DailyTrend[];
  rows:    AttendanceRow[];
  loading: boolean;
}

// ── Trend chart ───────────────────────────────────────────────────────────────

function TrendChart({ trend, loading }: { trend: DailyTrend[]; loading: boolean }): VNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef  = useRef<AnyChart>(null);

  useEffect(() => {
    if (loading) return;
    const ChartCtor = getChartConstructor();
    if (!ChartCtor || !canvasRef.current) return;

    // Destroy previous instance
    if (chartRef.current) {
      try { chartRef.current.destroy(); } catch { /* ignore */ }
      chartRef.current = null;
    }

    const isSingleDay = trend.length === 1;
    const labels      = trend.map((t) => fmtDate(t.date));

    chartRef.current = new ChartCtor(canvasRef.current, {
      type: isSingleDay ? 'bar' : 'line',
      data: {
        labels,
        datasets: [
          {
            label:           'Present',
            data:            trend.map((t) => t.present),
            borderColor:     COLOR_PRESENT,
            backgroundColor: isSingleDay ? `${COLOR_PRESENT}CC` : `${COLOR_PRESENT}22`,
            fill:            !isSingleDay,
            tension:         0.3,
            pointRadius:     trend.length > 20 ? 2 : 4,
          },
          {
            label:           'Late',
            data:            trend.map((t) => t.late),
            borderColor:     COLOR_LATE,
            backgroundColor: isSingleDay ? `${COLOR_LATE}CC` : 'transparent',
            fill:            false,
            tension:         0.3,
            pointRadius:     trend.length > 20 ? 2 : 4,
          },
          {
            label:           'Absent',
            data:            trend.map((t) => t.absent),
            borderColor:     COLOR_ABSENT,
            backgroundColor: isSingleDay ? `${COLOR_ABSENT}CC` : 'transparent',
            fill:            false,
            tension:         0.3,
            pointRadius:     trend.length > 20 ? 2 : 4,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
          tooltip: { mode: 'index' },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 12,
              font: { size: 11 },
            },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11 } },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        try { chartRef.current.destroy(); } catch { /* ignore */ }
        chartRef.current = null;
      }
    };
   
  }, [trend, loading]);

  return (
    <div class="ea-chart-card">
      <div class="ea-section-title">Daily Attendance Trend</div>
      <div class="att-chart-container">
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Spinner size={36} label="Loading trend chart…" />
          </div>
        ) : trend.length === 0 ? (
          <div class="att-empty">No trend data available.</div>
        ) : (
          <canvas ref={canvasRef} style={{ width: '100%', height: '240px' }} />
        )}
      </div>
    </div>
  );
}

// ── Doughnut chart ────────────────────────────────────────────────────────────

function DistributionChart({ rows, loading }: { rows: AttendanceRow[]; loading: boolean }): VNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef  = useRef<AnyChart>(null);

  useEffect(() => {
    if (loading) return;
    const ChartCtor = getChartConstructor();
    if (!ChartCtor || !canvasRef.current) return;

    if (chartRef.current) {
      try { chartRef.current.destroy(); } catch { /* ignore */ }
      chartRef.current = null;
    }

    let present = 0;
    let late    = 0;
    let absent  = 0;
    for (const row of rows) {
      if (row.status === 'Present') present++;
      else if (row.status === 'Late') late++;
      else if (row.status === 'Absent') absent++;
    }

    const total = present + late + absent;

    chartRef.current = new ChartCtor(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels:   ['Present', 'Late', 'Absent'],
        datasets: [{
          data:            [present, late, absent],
          backgroundColor: [COLOR_PRESENT, COLOR_LATE, COLOR_ABSENT],
          borderWidth:     2,
          borderColor:     '#fff',
          hoverBorderWidth: 3,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        cutout:              '65%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label(ctx: { label: string; parsed: number }) {
                const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
              },
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        try { chartRef.current.destroy(); } catch { /* ignore */ }
        chartRef.current = null;
      }
    };
   
  }, [rows, loading]);

  return (
    <div class="ea-chart-card" style={{ minWidth: '220px', maxWidth: '340px' }}>
      <div class="ea-section-title">Status Distribution</div>
      <div class="att-chart-container">
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Spinner size={36} label="Loading distribution chart…" />
          </div>
        ) : rows.length === 0 ? (
          <div class="att-empty">No data.</div>
        ) : (
          <canvas ref={canvasRef} style={{ width: '100%', height: '240px' }} />
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AttendanceCharts({ trend, rows, loading }: AttendanceChartsProps): VNode {
  return (
    <div class="ea-charts-row">
      <TrendChart trend={trend} loading={loading} />
      <DistributionChart rows={rows} loading={loading} />
    </div>
  );
}
