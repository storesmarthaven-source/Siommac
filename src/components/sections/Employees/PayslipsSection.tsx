/**
 * PayslipsSection.tsx
 *
 * Employee self-service payslips grid.
 * Replaces: loadMyPayslips, _empOpenPayslip, _buildPayslipHtml, window._printPayslip
 * from employees.js.
 *
 * Features:
 *   ✓ Card grid with gross / net / deduction summary
 *   ✓ View payslip in a Modal (replaces the legacy cpop.fire() popup)
 *   ✓ Print to new window with full print CSS (mirrors legacy print function)
 *   ✓ YTD totals strip
 *   ✓ "Latest" badge on most recent payslip
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }                         from 'preact';
import { useState, useCallback }               from 'preact/hooks';
import { Modal }                               from '@shared/Modal';
import type { Payslip, CompanyInfo, StatutoryRates } from './types';
import { useMyPayslips }                       from './hooks';
import { fmtTTD, fmtAmount, PAY_CYCLE_LABEL } from './utils';

// ── Company info defaults (read from legacy _companyInfo / _statutoryRates globals if present) ──

function getCompanyInfo(): CompanyInfo {
  // Try to read from legacy global if available (populated by settings-view.js)
  const g = (window as unknown as Record<string, unknown>)._companyInfo as CompanyInfo | undefined;
  return g ?? { name: 'My Company', address: '', phone: '', email: '', nis: '', bir: '', logoUrl: '' };
}

function getStatutoryRates(): StatutoryRates {
  const g = (window as unknown as Record<string, unknown>)._statutoryRates as StatutoryRates | undefined;
  return g ?? { nisRate: 5.4, allowanceAnnual: 84000 };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PayslipsSection(): VNode {
  const { data: payslips = [], isLoading, error, refetch } = useMyPayslips();
  const [viewing, setViewing] = useState<Payslip | null>(null);

  const ytd = payslips.reduce((s, p) => s + (p.net_pay ?? p.netPay ?? 0), 0);

  if (error) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#dc2626' }}>
        <div>Failed to load payslips.</div>
        <button type="button" class="btn btn-primary btn-sm" onClick={() => void refetch()} style={{ marginTop: '10px' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 'var(--font-weight-bold)', color: '#111827' }}>My Payslips</h1>
        <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#6b7280' }}>View and print your pay statements.</p>
      </div>

      {/* YTD strip */}
      {payslips.length > 0 && (
        <div class="emp-ps-stats">
          <YtdItem label="Total Payslips"  value={String(payslips.length)} />
          <div class="emp-ps-stat-divider" />
          <YtdItem label="Latest Net Pay"  value={fmtTTD((payslips[0]?.net_pay ?? payslips[0]?.netPay ?? 0))} />
          <div class="emp-ps-stat-divider" />
          <YtdItem label="YTD Net Pay"     value={fmtTTD(ytd)} green />
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div class="emp-payslip-grid">
          {[0, 1, 2].map(n => <div key={n} class="emp-payslip-skeleton" />)}
        </div>
      ) : payslips.length === 0 ? (
        <div class="emp-payroll-empty">
          <div class="emp-payroll-empty-icon">
            <i class="fas fa-file-invoice-dollar" aria-hidden="true" />
          </div>
          <h3>No payslips yet</h3>
          <p>Your payslips will appear here once payroll has been processed.</p>
        </div>
      ) : (
        <div class="emp-payslip-grid">
          {payslips.map((p, i) => (
            <PayslipCard
              key={p.id}
              payslip={p}
              isLatest={i === 0}
              onView={() => setViewing(p)}
            />
          ))}
        </div>
      )}

      {/* View payslip modal */}
      {viewing && (
        <PayslipViewModal
          payslip={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

// ── Payslip card ──────────────────────────────────────────────────────────────

function PayslipCard({ payslip: p, isLatest, onView }: { payslip: Payslip; isLatest: boolean; onView: () => void }): VNode {
  const monthLabel = p.date_from
    ? new Date(p.date_from + 'T12:00:00').toLocaleDateString('en-TT', { month: 'long', year: 'numeric' })
    : '—';
  const cycleLabel = PAY_CYCLE_LABEL[p.pay_cycle] ?? p.pay_cycle ?? '—';
  const approvedDate = p.approved_at
    ? new Date(p.approved_at).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  const net  = (p.net_pay ?? p.netPay ?? 0);
  const gross = (p.gross_pay ?? p.grossPay ?? 0);
  const ded   = (p.total_deductions ?? p.totalDeductions ?? 0);

  return (
    <div class={`emp-payslip-card${isLatest ? ' emp-payslip-card--latest' : ''}`}>
      {/* Top strip — month + cycle tag */}
      <div class="emp-payslip-card-top">
        <div class="emp-payslip-card-month">{monthLabel}</div>
        <span class="emp-payslip-card-cycle-tag">{cycleLabel}</span>
      </div>

      {/* Net pay hero */}
      <div class="emp-payslip-card-net">
        <span class="emp-payslip-net-label">Net Pay</span>
        <span class="emp-payslip-net-val">TTD {fmtAmount(net)}</span>
      </div>

      {/* Breakdown */}
      <div class="emp-payslip-card-breakdown">
        <BreakRow label="Gross" value={`TTD ${fmtAmount(gross)}`} />
        <BreakRow label="Deductions" value={`− TTD ${fmtAmount(ded)}`} ded />
      </div>

      {/* Footer */}
      <div class="emp-payslip-card-footer">
        <span class="emp-payslip-approved">
          <i class="fas fa-check-circle" aria-hidden="true" />
          {approvedDate}
        </span>
        <button type="button" class="emp-payslip-view-btn" onClick={onView}>
          <i class="fas fa-eye" aria-hidden="true" /> View &amp; Print
        </button>
      </div>
    </div>
  );
}

function BreakRow({ label, value, ded }: { label: string; value: string; ded?: boolean }): VNode {
  return (
    <div class={`emp-payslip-brow${ded ? ' emp-payslip-brow--ded' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function YtdItem({ label, value, green }: { label: string; value: string; green?: boolean }): VNode {
  return (
    <div class="emp-ps-stat">
      <span class="emp-ps-stat-label">{label}</span>
      <span class={`emp-ps-stat-val${green ? ' green' : ''}`}>{value}</span>
    </div>
  );
}

// ── Payslip view modal ────────────────────────────────────────────────────────

function PayslipViewModal({ payslip: p, onClose }: { payslip: Payslip; onClose: () => void }): VNode {
  const ci     = getCompanyInfo();
  const rates  = getStatutoryRates();
  const cycleLabel = PAY_CYCLE_LABEL[p.pay_cycle] ?? p.pay_cycle;

  const gross = (p.gross_pay ?? p.grossPay ?? 0);
  const net   = (p.net_pay   ?? p.netPay   ?? 0);
  const ded   = (p.total_deductions ?? p.totalDeductions ?? 0);
  const paye  = (p.paye ?? 0);
  const nis   = (p.nis  ?? 0);
  const hs    = (p.health_surcharge ?? p.healthSurcharge ?? 0);
  const hrs   = (p.hours_worked ?? p.hoursWorked ?? 0);

  const handlePrint = useCallback(() => {
    const printCss = `
      @page { size: A4 landscape; margin: 10mm; }
      body { margin:0; font-family:'Segoe UI',Arial,sans-serif; font-size:12px; color:#1b2d55; background:#fff; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
      .ph { background:#1b2d55; color:#fff; display:flex; align-items:center; justify-content:space-between; padding:16px 24px; }
      .ph-name { font-size:18px; font-weight: var(--font-weight-bold); }
      .ph-role { font-size:11px; opacity:.7; margin-top:3px; }
      .section { border-bottom:1px solid #dce2ef; }
      .meta { display:grid; grid-template-columns:1fr 1fr; }
      .meta-col { padding:12px 18px; }
      .meta-col:first-child { border-right:1px solid #dce2ef; }
      .row { display:flex; justify-content:space-between; padding:5px 0; font-size:11px; border-bottom:1px dotted #dce2ef; }
      .row:last-child { border-bottom:none; }
      .row span { color:#6b7a99; }
      .row strong { color:#1b2d55; }
      .tables { display:grid; grid-template-columns:1fr 1fr; }
      .tbl-col { padding:10px 0; }
      .tbl-col:first-child { border-right:1px solid #dce2ef; }
      .tbl-title { padding:8px 18px 5px; font-size:9px; font-weight: var(--font-weight-bold); text-transform:uppercase; color:#6b7a99; border-bottom:1px solid #dce2ef; }
      table { width:100%; border-collapse:collapse; font-size:11px; }
      th { padding:5px 18px; text-align:left; font-size:9px; font-weight: var(--font-weight-bold); text-transform:uppercase; color:#6b7a99; background:#f5f7fc; border-bottom:1px solid #dce2ef; print-color-adjust:exact; }
      td { padding:6px 18px; border-bottom:1px solid rgba(0,0,0,.04); }
      .subtotal { display:flex; justify-content:space-between; padding:7px 18px; font-size:11px; font-weight: var(--font-weight-bold); color:#166534; background:rgba(22,101,52,.07); border-top:2px solid #dce2ef; print-color-adjust:exact; }
      .subtotal-ded { color:#b91c1c; background:rgba(185,28,28,.07); }
      .net { display:flex; justify-content:space-between; padding:11px 20px; font-size:15px; font-weight: var(--font-weight-bold); background:#1b2d55; color:#fff; print-color-adjust:exact; }
    `;

    const printHeader = `
      <div class="ph">
        <div><div class="ph-name">${p.name ?? ''}</div><div class="ph-role">${p.position ?? ''} &bull; ${p.department ?? ''}</div></div>
        <div style="text-align:right;font-size:10px;opacity:.88">
          ${ci.address ? ci.address + '<br>' : ''}${ci.phone ? 'Tel: ' + ci.phone + '<br>' : ''}${ci.email ?? ''}
        </div>
        ${ci.logoUrl ? `<img src="${ci.logoUrl}" style="height:72px;object-fit:contain">` : ''}
      </div>`;

    const html = `
      <div class="section meta">
        <div class="meta-col">
          <div class="row"><span>Pay Period</span><strong>${p.date_from} — ${p.date_to}</strong></div>
          <div class="row"><span>Pay Cycle</span><strong>${cycleLabel}</strong></div>
          <div class="row"><span>Pay Date</span><strong>${p.pay_date ?? '—'}</strong></div>
        </div>
        <div class="meta-col">
          <div class="row"><span>Rate</span><strong>${p.pay_basis === 'hourly' ? `TTD ${fmtAmount((p.hourly_rate ?? p.hourlyRate ?? 0))} / hr` : `TTD ${fmtAmount((p.monthly_salary ?? p.monthlySalary ?? 0))} / mo`}</strong></div>
          <div class="row"><span>Hours</span><strong>${hrs}h</strong></div>
          <div class="row"><span>Allowance</span><strong>TTD ${fmtAmount(rates.allowanceAnnual)} / yr</strong></div>
        </div>
      </div>
      <div class="section tables">
        <div class="tbl-col">
          <div class="tbl-title">Earnings</div>
          <table><thead><tr><th>Description</th><th>Amount</th></tr></thead>
          <tbody><tr><td>${p.pay_basis === 'hourly' ? 'Straight Time' : 'Monthly Salary'}</td><td>TTD ${fmtAmount(gross)}</td></tr></tbody></table>
          <div class="subtotal"><span>Gross Pay</span><span>TTD ${fmtAmount(gross)}</span></div>
        </div>
        <div class="tbl-col">
          <div class="tbl-title">Deductions</div>
          <table><thead><tr><th>Description</th><th>Amount</th></tr></thead>
          <tbody>
            <tr><td>Health Surcharge</td><td>${hs > 0 ? 'TTD ' + fmtAmount(hs) : 'N/A'}</td></tr>
            <tr><td>NIS (${rates.nisRate}%)</td><td>${nis > 0 ? 'TTD ' + fmtAmount(nis) : 'N/A'}</td></tr>
            <tr><td>PAYE</td><td>TTD ${fmtAmount(paye)}</td></tr>
          </tbody></table>
          <div class="subtotal subtotal-ded"><span>Total Deductions</span><span>TTD ${fmtAmount(ded)}</span></div>
        </div>
      </div>
      <div class="net"><span>Net Pay</span><span>TTD ${fmtAmount(net)}</span></div>
    `;

    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) return;
    const faUrl = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payslip</title><link rel="stylesheet" href="${faUrl}"><style>${printCss}</style></head><body>${printHeader}${html}</body></html>`);
    win.document.close();
    let printed = false;
    const doPrint = () => { if (!printed) { printed = true; win.focus(); win.print(); } };
    const fa = win.document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
    if (fa) {
      fa.onload  = () => setTimeout(doPrint, 200);
      fa.onerror = () => setTimeout(doPrint, 200);
    }
    setTimeout(doPrint, 1500);
  }, [p, ci, rates, cycleLabel]);

  const footer = (
    <>
      <button type="button" class="btn btn-primary" onClick={handlePrint}>
        <i class="fas fa-print" aria-hidden="true" /> Print
      </button>
      <button type="button" class="btn btn-outline-secondary" onClick={onClose}>
        Close
      </button>
    </>
  );

  const monthLabel = p.date_from
    ? new Date(p.date_from + 'T12:00:00').toLocaleDateString('en-TT', { month: 'long', year: 'numeric' })
    : '—';

  return (
    <Modal open onClose={onClose} title={`Payslip — ${monthLabel}`} size="lg" footer={footer}>
      <div style={{ fontFamily: "'Segoe UI', Arial, sans-serif", color: '#1b2d55' }}>

        {/* Company brand */}
        {ci.name && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 16px', borderBottom: '1px solid #dce2ef', marginBottom: '16px' }}>
            <div>
              <div style={{ fontWeight: 'var(--font-weight-bold)', fontSize: '15px' }}>{ci.name}</div>
              {ci.address && <div style={{ fontSize: '12px', color: '#6b7a99' }}>{ci.address}</div>}
            </div>
            {ci.logoUrl && <img src={ci.logoUrl} alt="Company logo" style={{ height: '48px', objectFit: 'contain' }} />}
          </div>
        )}

        {/* Meta grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', borderBottom: '1px solid #dce2ef', marginBottom: '16px' }}>
          <MetaCol>
            <MetaRow label="Pay Period"   value={`${p.date_from} — ${p.date_to}`} />
            <MetaRow label="Pay Cycle"    value={cycleLabel} />
            <MetaRow label="Pay Date"     value={p.pay_date ?? '—'} />
          </MetaCol>
          <MetaCol>
            <MetaRow label="Rate"         value={p.pay_basis === 'hourly' ? `TTD ${fmtAmount((p.hourly_rate ?? p.hourlyRate ?? 0))} / hr` : `TTD ${fmtAmount((p.monthly_salary ?? p.monthlySalary ?? 0))} / mo`} />
            <MetaRow label="Hours Worked" value={`${hrs}h`} />
            <MetaRow label="Allowance"    value={`TTD ${fmtAmount(rates.allowanceAnnual)} / yr`} />
          </MetaCol>
        </div>

        {/* Earnings / Deductions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', border: '1px solid #dce2ef', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px' }}>
          <div style={{ borderRight: '1px solid #dce2ef' }}>
            <div style={{ padding: '8px 16px', background: '#f5f7fc', fontSize: '11px', fontWeight: 'var(--font-weight-bold)', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7a99', borderBottom: '1px solid #dce2ef' }}>
              <i class="fas fa-plus-circle" style={{ marginRight: '4px' }} aria-hidden="true" />Earnings
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead><tr style={{ background: '#f9fafb' }}><th style={thStyle}>Description</th><th style={thStyle}>Amount</th></tr></thead>
              <tbody><tr><td style={tdStyle}>{p.pay_basis === 'hourly' ? 'Straight Time' : 'Monthly Salary'}</td><td style={tdStyle}>TTD {fmtAmount(gross)}</td></tr></tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 16px', fontWeight: 'var(--font-weight-bold)', fontSize: '12px', color: '#166534', background: 'rgba(22,101,52,.07)', borderTop: '2px solid #dce2ef' }}>
              <span>Gross Pay</span><span>TTD {fmtAmount(gross)}</span>
            </div>
          </div>
          <div>
            <div style={{ padding: '8px 16px', background: '#f5f7fc', fontSize: '11px', fontWeight: 'var(--font-weight-bold)', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7a99', borderBottom: '1px solid #dce2ef' }}>
              <i class="fas fa-minus-circle" style={{ marginRight: '4px' }} aria-hidden="true" />Deductions
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead><tr style={{ background: '#f9fafb' }}><th style={thStyle}>Description</th><th style={thStyle}>Amount</th></tr></thead>
              <tbody>
                <tr><td style={tdStyle}>Health Surcharge</td><td style={tdStyle}>{hs > 0 ? 'TTD ' + fmtAmount(hs) : 'N/A'}</td></tr>
                <tr><td style={tdStyle}>NIS ({rates.nisRate}%)</td><td style={tdStyle}>{nis > 0 ? 'TTD ' + fmtAmount(nis) : 'N/A'}</td></tr>
                <tr><td style={tdStyle}>PAYE</td><td style={tdStyle}>TTD {fmtAmount(paye)}</td></tr>
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 16px', fontWeight: 'var(--font-weight-bold)', fontSize: '12px', color: '#b91c1c', background: 'rgba(185,28,28,.07)', borderTop: '2px solid #dce2ef' }}>
              <span>Total Deductions</span><span>TTD {fmtAmount(ded)}</span>
            </div>
          </div>
        </div>

        {/* Net pay */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', fontWeight: 'var(--font-weight-bold)', fontSize: '16px', background: '#1b2d55', color: '#fff', borderRadius: '8px' }}>
          <span>Net Pay</span><span>TTD {fmtAmount(net)}</span>
        </div>

        <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '11px', color: '#9ca3af' }}>
          This is a computer-generated payslip — Trinidad &amp; Tobago
        </div>
      </div>
    </Modal>
  );
}

function MetaCol({ children }: { children: VNode | VNode[] }): VNode {
  return <div style={{ padding: '12px 16px' }}>{children}</div>;
}

function MetaRow({ label, value }: { label: string; value: string }): VNode {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', fontSize: '12px', borderBottom: '1px dotted #dce2ef' }}>
      <span style={{ color: '#6b7a99' }}>{label}</span>
      <strong style={{ fontWeight: '600', color: '#1b2d55' }}>{value}</strong>
    </div>
  );
}

const thStyle: Record<string, string> = { padding: '5px 16px', textAlign: 'left', fontSize: '10px', fontWeight: 'var(--font-weight-bold)', textTransform: 'uppercase', color: '#6b7a99', letterSpacing: '0.04em' };
const tdStyle: Record<string, string> = { padding: '6px 16px', borderBottom: '1px solid rgba(0,0,0,.04)', fontSize: '12px' };
