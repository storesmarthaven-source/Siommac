/**
 * src/components/sections/Finance/MyPayslipsOverview.tsx
 *
 * Finance ▸ My Payslips — Employee Self-Service (F3).
 *
 * Displays the signed-in employee's own payslips, sourced from
 * /api/finance/payroll/payslips/my (self-scope enforced server-side).
 * Download uses /api/finance/payroll/payslips/signed-url (also self-scoped
 * for view_own callers; Finance view_all callers get unconstrained access).
 *
 * Permission: finance.payroll.view_own (already on `employee` role).
 *
 * Privacy rules (matching §8.4 of spec):
 *   - Employee sees ONLY their own payslips.
 *   - Download is audited server-side via app_events.
 *   - No cross-employee access from this surface.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useQuery } from '@tanstack/preact-query';
import { dialog } from '@lib/dialog';
import { PageHeader, EmptyState } from '@ui';
import { financePayrollApi, type Payslip } from '@api/finance/payroll';
import { fmtDate, humanize, statusTone } from './financeShared';
import './finance.css';

// ── Query key ─────────────────────────────────────────────────────────────────

const MY_PAYSLIPS_KEY = ['finance', 'payroll', 'payslips', 'my'] as const;

// ── Root component ─────────────────────────────────────────────────────────────

export function MyPayslipsOverview(): VNode {
  const payslipsQ = useQuery({
    queryKey: MY_PAYSLIPS_KEY,
    queryFn:  () => financePayrollApi.myPayslips(),
  });

  const payslips        = payslipsQ.data ?? [];
  const latestGenerated = payslips[0]?.generatedAt ?? null;

  const STAT_ROW = [
    { label: 'Total payslips',   val: String(payslips.length) },
    { label: 'Latest generated', val: latestGenerated ? fmtDate(latestGenerated) : '—' },
  ];

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader
        icon="fa-file-invoice"
        module="Finance · My Payslips"
        title="My Payslips"
        sub="Your payslip history. Each download is audited for compliance."
      />

      <div class="obx-repstats" style={{ margin: '4px 0 12px' }}>
        {STAT_ROW.map(s => (
          <div class="obx-repstat" key={s.label}>
            <div class="obx-repstat-val">{s.val}</div>
            <div class="obx-repstat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div class="obx-section">
        <div class="obx-section-body">
          {payslipsQ.isLoading ? (
            <div class="obx-empty">Loading…</div>
          ) : !payslips.length ? (
            <EmptyState
              icon="fa-file-invoice"
              title="No payslips yet"
              text="Your payslips will appear here once your employer publishes a payroll run."
            />
          ) : (
            <table class="obx-table">
              <thead>
                <tr>
                  <th>Payslip No.</th>
                  <th>Generated</th>
                  <th>File</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map(p => (
                  <PayslipRow key={p.id} payslip={p} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payslip row ────────────────────────────────────────────────────────────────

function PayslipRow({ payslip }: { payslip: Payslip }): VNode {
  const [downloading, setDownloading] = useState(false);

  const download = async (): Promise<void> => {
    if (downloading) return;
    setDownloading(true);
    try {
      const result = await financePayrollApi.payslipSignedUrl({ id: payslip.id });
      // Open the signed URL in a new tab — browser handles the file download.
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      dialog.error(e instanceof Error ? e.message : 'Failed to generate download link.');
    } finally {
      setDownloading(false);
    }
  };

  // A payslip with no filePath cannot be downloaded yet (async file gen pending).
  const hasFile       = Boolean(payslip.filePath);
  // The payslip entity has no explicit status column — existence = ready; no file = pending.
  const displayStatus = hasFile ? 'ready' : 'pending';

  return (
    <tr>
      <td><b>{payslip.payslipNo}</b></td>
      <td class="obx-meta">{fmtDate(payslip.generatedAt)}</td>
      <td>
        <span class={`obx-pill ${statusTone(displayStatus)}`}>
          {humanize(displayStatus)}
        </span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <div class="obx-rowbtns" style={{ justifyContent: 'flex-end' }}>
          {hasFile ? (
            <button
              class="obx-btn obx-btn-sm"
              disabled={downloading}
              onClick={() => void download()}
            >
              <i class={`fas ${downloading ? 'fa-spinner fa-spin' : 'fa-download'}`} />
              {downloading ? ' Preparing…' : ' Download'}
            </button>
          ) : (
            <span class="obx-meta" style={{ fontSize: 12, fontStyle: 'italic' }}>
              Not yet available
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
