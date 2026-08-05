/**
 * src/components/sections/HR/OnboardingReportsWorkspace.tsx
 *
 * HR ▸ Onboarding ▸ Reports (Phase 6) — the analytics/compliance workspace: a left
 * catalog of 9 reports, a filter bar, report-specific summary cards, a chart, and a
 * dynamic data table. "Export CSV" hits the audited export endpoint (data egress is
 * logged) then serialises the returned rows client-side via @ui exportCsv.
 *
 * All report data is computed LIVE server-side from the onboarding tables — no
 * fabricated numbers. Reports need hr.onboarding.reports.view; export additionally
 * needs hr.onboarding.reports.export.
 */
import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController,
  Legend, LinearScale, Tooltip,
} from 'chart.js';
import { PageHeader, exportCsv } from '@ui';
import { can } from '@lib/permissions';
import { useOnboardingReportList, useOnboardingReport, useOnboardingPackages, hrOnboardingApi } from '@api/hr/onboarding';
import type { OnboardingReportKey, RunOnboardingReportArgs, OnboardingReportColumn, OnboardingReportChart } from '../../../../types/hrOnboarding';
import { humanize } from './onboardingStatus';
import { OnboardingScopeSelector } from './OnboardingScopeSelector';
import { useOnboardingScope } from './useOnboardingScope';
import './onboardingCase.css';

const CASE_STATUSES = ['draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation', 'completed', 'cancelled'];
const BAR_COLORS = ['#2563eb', '#11a86b', '#f2a321', '#e11d48', '#6746f2', '#0ea5e9', '#64748b'];

Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Legend, LinearScale, Tooltip);

function fmtCell(v: unknown, type?: OnboardingReportColumn['type']): string {
  if (v === null || v === undefined || v === '') return '—';
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- v is pre-screened for null/undefined/''; remaining values are string|number from API report rows
  if (type === 'percent') return `${String(v)}%`;
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- v is pre-screened for null/undefined/''; remaining values are string|number from API report rows
  if (type === 'status') return humanize(String(v));
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- v is pre-screened for null/undefined/''; remaining values are string|number from API report rows
  return String(v);
}

function ChartView({ chart }: { chart: OnboardingReportChart }): VNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartLabel = `${chart.series.map(series => series.name).join(' and ')} by ${chart.labels.map(humanize).join(', ')}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const isDonut = chart.type === 'donut';
    const instance = new Chart(canvas, {
      type: isDonut ? 'doughnut' : 'bar',
      data: {
        labels: chart.labels.map(humanize),
        datasets: chart.series.map((series, index) => ({
          label: series.name,
          data: series.values,
          backgroundColor: isDonut
            ? chart.labels.map((_, itemIndex) => BAR_COLORS[itemIndex % BAR_COLORS.length])
            : BAR_COLORS[index % BAR_COLORS.length],
          borderColor: isDonut ? '#ffffff' : BAR_COLORS[index % BAR_COLORS.length],
          borderWidth: isDonut ? 2 : 0,
          borderRadius: isDonut ? 0 : 5,
          maxBarThickness: 42,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: isDonut || chart.series.length > 1, position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, padding: 18 } },
          tooltip: { enabled: true },
        },
        scales: isDonut ? undefined : {
          x: { stacked: chart.type === 'stacked_bar', grid: { display: false } },
          y: { stacked: chart.type === 'stacked_bar', beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
    return () => instance.destroy();
  }, [chart]);

  return (
    <div class="obx-repchart" style={{ height: 320 }}>
      <canvas ref={canvasRef} role="img" aria-label={chartLabel} />
    </div>
  );
}

export function OnboardingReportsWorkspace({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }): VNode {
  const catalogQ = useOnboardingReportList();
  const catalog = catalogQ.data ?? [];
  const [reportKey, setReportKey] = useState<OnboardingReportKey>('cycle_time');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pkgKey, setPkgKey] = useState('');
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const scopeState = useOnboardingScope();

  const pkgsQ = useOnboardingPackages(true);
  const packages = pkgsQ.data ?? [];

  const args = useMemo<RunOnboardingReportArgs>(() => ({
    reportKey, scope: scopeState.scope,
    dateFrom: dateFrom || null, dateTo: dateTo || null,
    packageKeys: pkgKey ? [pkgKey] : undefined,
    status: status ? [status] : undefined,
  }), [reportKey, scopeState.scope, dateFrom, dateTo, pkgKey, status]);

  const reportQ = useOnboardingReport(args);
  const result = reportQ.data;
  const canExport = can('hr.onboarding.reports.export');
  useEffect(() => {
    if (scopeState.changing && !reportQ.isFetching) scopeState.settled();
  }, [reportQ.isFetching, scopeState.changing, scopeState.settled]);

  async function handleExport(): Promise<void> {
    if (!result) return;
    setExporting(true);
    try {
      const fresh = await hrOnboardingApi.exportReport(args);
      exportCsv(
        fresh.rows,
        fresh.columns.map(col => ({ header: col.label, value: (row: Record<string, unknown>) => fmtCell(row[col.key], col.type) })),
        `onboarding_${reportKey}`,
      );
      onToast('Report exported');
    } catch (e) { onToast(e instanceof Error ? e.message : 'Export failed'); }
    finally { setExporting(false); }
  }

  return (
    <div class="hr-onboarding-reports">
      <button class="obx-back" onClick={onBack}>← Onboarding</button>

      <PageHeader
        icon="fa-chart-column"
        module="HR · Onboarding"
        title="Onboarding Insights"
        sub="Readiness, capacity, package performance and bottleneck analysis for HR managers."
        actions={canExport ? <button class="obx-btn" disabled={!result || exporting} onClick={() => void handleExport()}>{exporting ? 'Exporting…' : 'Export CSV'}</button> : undefined}
      />

      <div class="obx-toolbar">
        <OnboardingScopeSelector scope={scopeState.scope} options={scopeState.options} visible={scopeState.visible} onSelect={scopeState.select} busy={scopeState.changing} />
        <label class="obx-meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input class="ui-input" type="date" value={dateFrom} onInput={e => setDateFrom((e.target as HTMLInputElement).value)} /></label>
        <label class="obx-meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input class="ui-input" type="date" value={dateTo} onInput={e => setDateTo((e.target as HTMLInputElement).value)} /></label>
        <select class="ui-select" value={pkgKey} onChange={e => setPkgKey((e.target as HTMLSelectElement).value)}>
          <option value="">All packages</option>
          {packages.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select class="ui-select" value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="">All statuses</option>
          {CASE_STATUSES.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </div>

      <div class="obx-reports">
        <div class="obx-repcat">
          {catalog.map(r => (
            <button key={r.key} type="button" class={`obx-repcat-item ${r.key === reportKey ? 'active' : ''}`} onClick={() => setReportKey(r.key)}>
              <i class={`fas ${r.icon}`} />{r.title}
            </button>
          ))}
        </div>

        <div class="obx-repview">
          {reportQ.isLoading && !result ? <div class="obx-empty">Loading report…</div>
            : !result ? <div class="obx-empty">Select a report.</div>
            : (
              <>
                {result.summary.length > 0 && (
                  <div class="obx-repstats">
                    {result.summary.map((s, i) => (
                      <div class={`obx-repstat ${s.state ?? ''}`} key={i}>
                        <div class="obx-repstat-label">{s.label}</div>
                        <div class="obx-repstat-val">{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}
                {result.chart && <ChartView chart={result.chart} />}
                <div class="obx-section">
                  <div class="obx-section-body">
                    {result.rows.length === 0 ? <div class="obx-empty">No data for these filters.</div> : (
                      <table class="obx-table">
                        <thead><tr>{result.columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
                        <tbody>{result.rows.map((row, ri) => (
                          <tr key={ri}>{result.columns.map(c => <td key={c.key} class={c.type === 'text' || !c.type ? '' : 'obx-meta'}>{fmtCell(row[c.key], c.type)}</td>)}</tr>
                        ))}</tbody>
                      </table>
                    )}
                  </div>
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
}
