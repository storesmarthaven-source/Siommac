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
 * Styling: scoped `.mps-*` in the payroll-enterprise look (matches the Runs /
 * Exceptions / Reports re-skin) — no borrowed HR `obx-*` / `hr-offboarding`
 * classes (those live in HR's onboardingCase.css, not loaded in Finance).
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
import { financePayrollApi, type Payslip } from '@api/finance/payroll';
import { fmtDate } from './financeShared';
import './myPayslips.css';

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
  const readyCount      = payslips.filter(p => Boolean(p.filePath)).length;

  return (
    <div class="mps">
      <header class="mps-lead">
        <div>
          <div class="mps-crumbs"><span>Payroll</span><span class="sep">›</span><b>My Payslips</b></div>
          <h1>My Payslips</h1>
          <p>Your payslip history. Each download is audited for compliance.</p>
        </div>
      </header>

      <section class="mps-metrics" aria-label="Payslip summary">
        <div class="mps-metric">
          <div class="mps-mico blue"><i class="fa-solid fa-file-invoice" /></div>
          <div class="mps-m-body">
            <div class="mps-m-k">Total payslips</div>
            <div class="mps-m-v">{payslipsQ.isLoading && !payslipsQ.data ? '—' : String(payslips.length)}</div>
            <div class="mps-m-s">Across all runs</div>
          </div>
        </div>
        <div class="mps-metric">
          <div class="mps-mico green"><i class="fa-solid fa-circle-check" /></div>
          <div class="mps-m-body">
            <div class="mps-m-k">Ready to download</div>
            <div class="mps-m-v">{payslipsQ.isLoading && !payslipsQ.data ? '—' : String(readyCount)}</div>
            <div class="mps-m-s">Files available</div>
          </div>
        </div>
        <div class="mps-metric">
          <div class="mps-mico amber"><i class="fa-solid fa-calendar-day" /></div>
          <div class="mps-m-body">
            <div class="mps-m-k">Latest generated</div>
            <div class="mps-m-v">{latestGenerated ? fmtDate(latestGenerated) : '—'}</div>
            <div class="mps-m-s">Most recent payslip</div>
          </div>
        </div>
      </section>

      <section class="mps-card">
        <div class="mps-titlebar">
          <div><h2>Payslip history</h2><p>Download individual payslips — every download is audited.</p></div>
        </div>

        {payslipsQ.isLoading && !payslipsQ.data ? (
          <div class="mps-empty"><span class="mps-skel" /></div>
        ) : payslipsQ.isError ? (
          <div class="mps-empty"><i class="fa-solid fa-triangle-exclamation" />
            <strong>Couldn’t load your payslips</strong><small>Please retry in a moment.</small></div>
        ) : !payslips.length ? (
          <div class="mps-empty"><i class="fa-regular fa-file-lines" />
            <strong>No payslips yet</strong>
            <small>Your payslips will appear here once your employer publishes a payroll run.</small></div>
        ) : (
          <div class="mps-table-wrap">
            <table class="mps-table">
              <thead>
                <tr>
                  <th>Payslip No.</th>
                  <th>Generated</th>
                  <th>Status</th>
                  <th class="mps-actions-h">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map(p => <PayslipRow key={p.id} payslip={p} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
      void dialog.error(e instanceof Error ? e.message : 'Failed to generate download link.');
    } finally {
      setDownloading(false);
    }
  };

  // A payslip with no filePath cannot be downloaded yet (async file gen pending).
  const hasFile = Boolean(payslip.filePath);

  return (
    <tr>
      <td><strong>{payslip.payslipNo}</strong></td>
      <td class="mps-meta">{fmtDate(payslip.generatedAt)}</td>
      <td>
        <span class={`mps-pill ${hasFile ? 'green' : 'amber'}`}>
          <i class="mps-dot" />{hasFile ? 'Ready' : 'Pending'}
        </span>
      </td>
      <td class="mps-actions">
        {hasFile ? (
          <button type="button" class="mps-dl" disabled={downloading} onClick={() => void download()}>
            <i class={`fa-solid ${downloading ? 'fa-spinner fa-spin' : 'fa-download'}`} />
            {downloading ? ' Preparing…' : ' Download'}
          </button>
        ) : (
          <span class="mps-muted">Not yet available</span>
        )}
      </td>
    </tr>
  );
}
