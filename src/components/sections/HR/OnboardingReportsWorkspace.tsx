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
import { useMemo, useState } from 'preact/hooks';
import { PageHeader, exportCsv } from '@ui';
import { can } from '@lib/permissions';
import { useOnboardingReportList, useOnboardingReport, useOnboardingPackages, hrOnboardingApi } from '@api/hr/onboarding';
import type { OnboardingReportKey, RunOnboardingReportArgs, OnboardingReportColumn, OnboardingReportChart } from '../../../../types/hrOnboarding';
import { humanize } from './onboardingStatus';
import './onboardingCase.css';

const CASE_STATUSES = ['draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation', 'completed', 'cancelled'];
const BAR_COLORS = ['#2563eb', '#11a86b', '#f2a321', '#e11d48', '#6746f2', '#0ea5e9', '#64748b'];

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
  if (chart.type === 'donut') {
    const vals = chart.series[0]?.values ?? [];
    const total = vals.reduce((s, x) => s + x, 0) || 1;
    return (
      <div class="obx-repchart">
        <div class="obx-repdonut">
          {chart.labels.map((l, i) => (
            <div class="obx-repdonut-row" key={l}>
              <span class="obx-repdonut-dot" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} />
              <span>{humanize(l)}</span>
              <span><b>{vals[i] ?? 0}</b> ({Math.round(((vals[i] ?? 0) / total) * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  // bar (+ stacked_bar rendered as the first series bar; a second series shown inline)
  const series = chart.series[0];
  const max = Math.max(1, ...(series?.values ?? []));
  return (
    <div class="obx-repchart">
      {chart.labels.map((l, i) => (
        <div class="obx-repbar" key={l}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{humanize(l)}</span>
          <span class="obx-repbar-track"><i class="obx-repbar-fill" style={{ display: 'block', width: `${Math.round(((series?.values[i] ?? 0) / max) * 100)}%`, background: BAR_COLORS[0] }} /></span>
          <span class="obx-repbar-val">{series?.values[i] ?? 0}{chart.series[1] ? ` / ${chart.series[1].values[i] ?? 0}` : ''}</span>
        </div>
      ))}
      {chart.series[1] && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>{chart.series[0]?.name} / {chart.series[1].name}</div>}
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

  const pkgsQ = useOnboardingPackages(true);
  const packages = pkgsQ.data ?? [];

  const args = useMemo<RunOnboardingReportArgs>(() => ({
    reportKey,
    dateFrom: dateFrom || null, dateTo: dateTo || null,
    packageKeys: pkgKey ? [pkgKey] : undefined,
    status: status ? [status] : undefined,
  }), [reportKey, dateFrom, dateTo, pkgKey, status]);

  const reportQ = useOnboardingReport(args);
  const result = reportQ.data;
  const canExport = can('hr.onboarding.reports.export');

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
        title="Reports"
        sub="Operational analytics and compliance reporting."
        meta={result ? [{ icon: 'fa-table-list', label: `${result.totalRows} rows` }] : []}
        actions={canExport ? <button class="obx-btn" disabled={!result || exporting} onClick={() => void handleExport()}>{exporting ? 'Exporting…' : 'Export CSV'}</button> : undefined}
      />

      <div class="obx-toolbar">
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
