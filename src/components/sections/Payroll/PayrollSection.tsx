/**
 * src/components/sections/Payroll/PayrollSection.tsx
 *
 * Replaces payroll.js payroll-run section (s-payroll).
 * Features:
 *   - Date range picker (flatpickr via useEffect)
 *   - Pay Cycle / Department filters
 *   - Employee picker dropdown (reports mode)
 *   - Run Payroll / Generate Report
 *   - Payroll register DataTable
 *   - Payslip modal (view)
 *   - Employee payroll settings modal (edit)
 *   - T&T constants modal (password-gated)
 *   - Submit for Approval
 *   - Reports toggle
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h, Fragment }       from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import { useQuery }          from '@tanstack/preact-query';
import { toast }             from '@store';
import { useSessionStore }   from '@store/session';
import { ConfirmDialog }     from '@shared/ConfirmDialog';
import {
  listPayrollRun,
  listDepartments,
  listEmployees,
  updateEmployeePayroll,
  approvePayroll,
  verifyPassword,
  getPayrollConstants,
  savePayrollConstants,
  calcStatutoryEstimate,
} from './api';
import type {
  PayrollRow,
  PayrollRunData,
  PayrollTotals,
  Department,
  EmployeeListItem,
  PayCycle,
  PayrollConstants,
} from './types';
import { DEFAULT_CONSTANTS } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const fmtTTD = (n: number) =>
  'TTD ' + Math.max(0, n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const CYCLE_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly',
};

function monthBounds(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { start, end };
}

// ── Stat cards ────────────────────────────────────────────────────────────────

function PayrollStats({ totals }: { totals: PayrollTotals }) {
  return (
    <div class="dashboard-grid-3" style="margin-bottom:20px">
      <div class="stat-card">
        <div class="stat-card-icon green"><i class="fas fa-dollar-sign"></i></div>
        <div class="stat-card-body">
          <div class="stat-card-value">{fmtMoney(totals.grossPay)}</div>
          <div class="stat-card-label">Total Gross Pay</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon blue"><i class="fas fa-wallet"></i></div>
        <div class="stat-card-body">
          <div class="stat-card-value">{fmtMoney(totals.netPay)}</div>
          <div class="stat-card-label">Total Net Pay</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon red"><i class="fas fa-arrow-trend-down"></i></div>
        <div class="stat-card-body">
          <div class="stat-card-value">{fmtMoney(totals.totalDeductions)}</div>
          <div class="stat-card-label">Total Deductions</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon gold"><i class="fas fa-landmark"></i></div>
        <div class="stat-card-body">
          <div class="stat-card-value">{fmtMoney(totals.paye)}</div>
          <div class="stat-card-label">PAYE Tax</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon green"><i class="fas fa-hand-holding-medical"></i></div>
        <div class="stat-card-body">
          <div class="stat-card-value">{fmtMoney(totals.nis)}</div>
          <div class="stat-card-label">NIS Contributions</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon gold"><i class="fas fa-stethoscope"></i></div>
        <div class="stat-card-body">
          <div class="stat-card-value">{fmtMoney(totals.healthSurcharge)}</div>
          <div class="stat-card-label">Health Surcharge</div>
        </div>
      </div>
    </div>
  );
}

// ── Payslip modal ─────────────────────────────────────────────────────────────

interface PayslipModalProps {
  row:      PayrollRow;
  dateFrom: string;
  dateTo:   string;
  onClose:  () => void;
}

function PayslipModal({ row, dateFrom, dateTo, onClose }: PayslipModalProps) {
  // Build a simple payslip view (mirrors _buildPayslipHtml structure)
  return (
    <div class="prs-overlay active" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="cpop-box--panel cpop-box--payslip" onClick={(e) => e.stopPropagation()} style="position:relative;max-width:560px;margin:40px auto">
        <button
          style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:#666"
          onClick={onClose}
        >
          <i class="fas fa-times"></i>
        </button>

        <div style="padding:24px 28px;font-family:sans-serif">
          <h3 style="margin:0 0 4px;font-size:20px">Payslip</h3>
          <p style="margin:0 0 20px;color:#666;font-size:13px">{dateFrom} — {dateTo}</p>

          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px">
            <tbody>
              <tr><td style="padding:4px 0;color:#888;width:50%">Employee</td><td style="padding:4px 0;font-weight:600">{row.name}</td></tr>
              <tr><td style="padding:4px 0;color:#888">Department</td><td style="padding:4px 0">{row.department}</td></tr>
              <tr><td style="padding:4px 0;color:#888">Position</td><td style="padding:4px 0">{row.position}</td></tr>
              <tr><td style="padding:4px 0;color:#888">Pay Cycle</td><td style="padding:4px 0">{CYCLE_LABEL[row.payCycle]}</td></tr>
              <tr><td style="padding:4px 0;color:#888">Pay Basis</td><td style="padding:4px 0">{row.payBasis === 'hourly' ? 'Hourly' : 'Salary'}</td></tr>
              {row.payBasis === 'hourly' && <tr><td style="padding:4px 0;color:#888">Hourly Rate</td><td style="padding:4px 0">{fmtMoney(row.hourlyRate)}/hr</td></tr>}
              <tr><td style="padding:4px 0;color:#888">Hours Worked</td><td style="padding:4px 0">{Number(row.hoursWorked || 0).toFixed(1)}{row.overridden ? ' (overridden)' : ''}</td></tr>
            </tbody>
          </table>

          <hr style="border:none;border-top:1px solid #eee;margin:12px 0" />

          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tbody>
              <tr>
                <td style="padding:6px 0;color:#444">Gross Pay</td>
                <td style="padding:6px 0;text-align:right;font-weight:600">{fmtMoney(row.grossPay)}</td>
              </tr>
              {row.nisApplicable && <tr>
                <td style="padding:6px 0;color:#888">NIS (6%)</td>
                <td style="padding:6px 0;text-align:right;color:#c00">−{fmtMoney(row.nis)}</td>
              </tr>}
              {row.hsApplicable && <tr>
                <td style="padding:6px 0;color:#888">Health Surcharge</td>
                <td style="padding:6px 0;text-align:right;color:#c00">−{fmtMoney(row.healthSurcharge)}</td>
              </tr>}
              <tr>
                <td style="padding:6px 0;color:#888">PAYE Tax</td>
                <td style="padding:6px 0;text-align:right;color:#c00">−{fmtMoney(row.paye)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#888">Total Deductions</td>
                <td style="padding:6px 0;text-align:right;color:#c00">−{fmtMoney(row.totalDeductions)}</td>
              </tr>
            </tbody>
          </table>

          <hr style="border:none;border-top:2px solid var(--siomac-navy,#1b2d55);margin:12px 0" />

          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:16px;font-weight: var(--font-weight-bold)">Net Pay</span>
            <span style="font-size:22px;font-weight:800;color:var(--siomac-navy,#1b2d55)">{fmtMoney(row.netPay)}</span>
          </div>

          <div style="margin-top:20px;text-align:right">
            <button
              onClick={() => {
                const w = window.open('', '_blank')!;
                w.document.write(`<html><head><title>Payslip</title></head><body style="font-family:sans-serif;padding:24px">${document.querySelector('.cpop-box--payslip')?.innerHTML ?? ''}</body></html>`);
                w.document.close();
                setTimeout(() => { w.print(); }, 300);
              }}
              style="background:var(--siomac-navy,#1b2d55);color:#fff;border:none;border-radius:6px;padding:8px 20px;cursor:pointer;font-size:14px"
            >
              <i class="fas fa-print"></i> Print
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Employee payroll settings modal ──────────────────────────────────────────

interface PrsModalProps {
  row:     PayrollRow;
  onClose: () => void;
  onSaved: () => void;
}

function PayrollSettingsModal({ row, onClose, onSaved }: PrsModalProps) {
  const [cycle,  setCycle]  = useState<PayCycle>(row.payCycle  || 'monthly');
  const [basis,  setBasis]  = useState(row.payBasis  || 'salary');
  const [salary, setSalary] = useState(String(row.monthlySalary || 0));
  const [rate,   setRate]   = useState(String(row.hourlyRate    || 0));
  const [stdHrs, setStdHrs] = useState(String(row.stdHours      || 8));
  const [nisOn,  setNisOn]  = useState(row.nisApplicable);
  const [hsOn,   setHsOn]   = useState(row.hsApplicable);
  const [taxOn,  setTaxOn]  = useState(row.taxResident);
  const [saving, setSaving] = useState(false);

  const est = useMemo(() => calcStatutoryEstimate({
    cycle, basis,
    salary:  parseFloat(salary)  || 0,
    rate:    parseFloat(rate)    || 0,
    stdHrs:  parseFloat(stdHrs)  || 8,
    nisOn, hsOn, taxOn,
  }), [cycle, basis, salary, rate, stdHrs, nisOn, hsOn, taxOn]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateEmployeePayroll({
        userId:                    row.userId,
        payCycle:                  cycle,
        payBasis:                  basis,
        hourlyRate:                rate,
        monthlySalary:             salary,
        standardHoursPerDay:       stdHrs,
        nisApplicable:             nisOn,
        healthSurchargeApplicable: hsOn,
        taxResident:               taxOn,
      });
      if (!res.success) { toast.error(res.message || 'Failed to save'); return; }
      toast.success('Payroll settings saved');
      onSaved();
      onClose();
    } catch {
      toast.error('Error saving payroll settings');
    } finally {
      setSaving(false);
    }
  };

  const initials = (row.name || '').split(' ').slice(0, 2).map((w: string) => w[0] || '').join('').toUpperCase() || '?';

  return (
    <div class="prs-overlay active" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="prs-modal" onClick={(e) => e.stopPropagation()}>
        <div class="prs-header">
          <div class="prs-emp-info">
            <div class="prs-avatar">{initials}</div>
            <div>
              <div class="prs-name">{row.name}</div>
              <div class="prs-meta">{row.department} · {row.position}</div>
            </div>
          </div>
          <button class="prs-close-btn" onClick={onClose}><i class="fas fa-times"></i></button>
        </div>

        <div class="prs-body">
          {/* Pay Cycle */}
          <div class="prs-field">
            <label class="prs-label">Pay Cycle</label>
            <div class="prs-pill-group" id="prsCycleGroup">
              {(['daily','weekly','fortnightly','monthly'] as PayCycle[]).map(c => (
                <button
                  key={c}
                  class={`prs-pill${cycle === c ? ' active' : ''}`}
                  onClick={() => setCycle(c)}
                >{CYCLE_LABEL[c]}</button>
              ))}
            </div>
          </div>

          {/* Pay Basis */}
          <div class="prs-field">
            <label class="prs-label">Pay Basis</label>
            <div class="prs-pill-group" id="prsBasisGroup">
              <button class={`prs-pill${basis === 'salary' ? ' active' : ''}`} onClick={() => setBasis('salary')}>Salary</button>
              <button class={`prs-pill${basis === 'hourly' ? ' active' : ''}`} onClick={() => setBasis('hourly')}>Hourly</button>
            </div>
          </div>

          {/* Rate fields */}
          {basis === 'salary' && (
            <div class="prs-field">
              <label class="prs-label">Monthly Salary (TTD)</label>
              <input class="prs-input" type="number" min="0" value={salary} onInput={(e) => setSalary((e.target as HTMLInputElement).value)} />
            </div>
          )}
          {basis === 'hourly' && (
            <div class="prs-field">
              <label class="prs-label">Hourly Rate (TTD)</label>
              <input class="prs-input" type="number" min="0" step="0.50" value={rate} onInput={(e) => setRate((e.target as HTMLInputElement).value)} />
            </div>
          )}

          <div class="prs-field">
            <label class="prs-label">Standard Hours / Day</label>
            <input class="prs-input" type="number" min="1" max="24" step="0.5" value={stdHrs} onInput={(e) => setStdHrs((e.target as HTMLInputElement).value)} />
          </div>

          {/* Statutory toggles */}
          <div class="prs-field prs-toggles">
            <label class="prs-toggle-row">
              <input type="checkbox" checked={nisOn} onChange={(e) => setNisOn((e.target as HTMLInputElement).checked)} />
              <span>NIS Applicable</span>
            </label>
            <label class="prs-toggle-row">
              <input type="checkbox" checked={hsOn} onChange={(e) => setHsOn((e.target as HTMLInputElement).checked)} />
              <span>Health Surcharge Applicable</span>
            </label>
            <label class="prs-toggle-row">
              <input type="checkbox" checked={taxOn} onChange={(e) => setTaxOn((e.target as HTMLInputElement).checked)} />
              <span>Tax Resident (PAYE)</span>
            </label>
          </div>

          {/* Live estimate */}
          <div class="prs-estimate">
            <div class="prs-est-title">Estimated Pay</div>
            <div class="prs-est-row"><span>Gross</span><span>{fmtTTD(est.gross)}</span></div>
            <div class="prs-est-row"><span>NIS</span><span>{nisOn ? fmtTTD(est.nis) : '—'}</span></div>
            <div class="prs-est-row"><span>Health Surcharge</span><span>{hsOn ? fmtTTD(est.hs) : '—'}</span></div>
            <div class="prs-est-row"><span>PAYE</span><span>{taxOn ? fmtTTD(est.paye) : '—'}</span></div>
            <div class="prs-est-row prs-est-net"><span>Net Pay</span><span>{fmtTTD(est.net)}</span></div>
          </div>
        </div>

        <div class="prs-footer">
          <button class="hr-btn-outline" onClick={onClose}>Cancel</button>
          <button class="hr-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><i class="fas fa-spinner fa-spin"></i> Saving…</> : <><i class="fas fa-save"></i> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── T&T Constants modal ───────────────────────────────────────────────────────

interface ConstantsModalProps {
  onClose: () => void;
}

function ConstantsModal({ onClose }: ConstantsModalProps) {
  const [step,      setStep]      = useState<'gate' | 'form'>('gate');
  const [pwd,       setPwd]       = useState('');
  const [gateErr,   setGateErr]   = useState('');
  const [verifying, setVerifying] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [tab,       setTab]       = useState(0);

  const [vals, setVals] = useState<PayrollConstants>({ ...DEFAULT_CONSTANTS });

  const pwdRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (step === 'gate') pwdRef.current?.focus(); }, [step]);

  const doVerify = async () => {
    if (!pwd) { setGateErr('Please enter your password.'); return; }
    setVerifying(true); setGateErr('');
    try {
      const res = await verifyPassword(pwd);
      if (!res.success) { setGateErr(res.message || 'Incorrect password.'); return; }
      const cres = await getPayrollConstants();
      if (Object.keys(cres).length) {
        setVals({
          nisRate:           cres.NIS_RATE                   != null ? +((cres.NIS_RATE * 100).toFixed(4)) : DEFAULT_CONSTANTS.nisRate,
          nisMonthlyCap:     cres.NIS_MONTHLY_CAP            ?? DEFAULT_CONSTANTS.nisMonthlyCap,
          hsThreshold:       cres.HS_THRESHOLD_WEEKLY        ?? DEFAULT_CONSTANTS.hsThreshold,
          hsHighDaily:       cres.HS_HIGH_DAILY              ?? DEFAULT_CONSTANTS.hsHighDaily,
          hsHighWeekly:      cres.HS_HIGH_WEEKLY             ?? DEFAULT_CONSTANTS.hsHighWeekly,
          hsHighFortnightly: cres.HS_HIGH_FORTNIGHTLY        ?? DEFAULT_CONSTANTS.hsHighFortnightly,
          hsHighMonthly:     cres.HS_HIGH_MONTHLY            ?? DEFAULT_CONSTANTS.hsHighMonthly,
          hsLowDaily:        cres.HS_LOW_DAILY               ?? DEFAULT_CONSTANTS.hsLowDaily,
          hsLowWeekly:       cres.HS_LOW_WEEKLY              ?? DEFAULT_CONSTANTS.hsLowWeekly,
          hsLowFortnightly:  cres.HS_LOW_FORTNIGHTLY         ?? DEFAULT_CONSTANTS.hsLowFortnightly,
          hsLowMonthly:      cres.HS_LOW_MONTHLY             ?? DEFAULT_CONSTANTS.hsLowMonthly,
          allowanceAnnual:   cres.PERSONAL_ALLOWANCE_ANNUAL  ?? DEFAULT_CONSTANTS.allowanceAnnual,
          payeRateLow:       cres.PAYE_RATE_LOW              != null ? +((cres.PAYE_RATE_LOW  * 100).toFixed(4)) : DEFAULT_CONSTANTS.payeRateLow,
          payeRateHigh:      cres.PAYE_RATE_HIGH             != null ? +((cres.PAYE_RATE_HIGH * 100).toFixed(4)) : DEFAULT_CONSTANTS.payeRateHigh,
          payeHighThreshold: cres.PAYE_HIGH_THRESHOLD_ANNUAL ?? DEFAULT_CONSTANTS.payeHighThreshold,
        });
      }
      setStep('form');
    } catch { setGateErr('Error verifying password.'); }
    finally  { setVerifying(false); }
  };

  const setVal = (k: keyof PayrollConstants, v: string) =>
    setVals(prev => ({ ...prev, [k]: parseFloat(v) || 0 }));

  const doSave = async () => {
    const payload: Record<string, number> = {
      PERSONAL_ALLOWANCE_ANNUAL:  vals.allowanceAnnual,
      PAYE_RATE_LOW:              vals.payeRateLow  / 100,
      PAYE_RATE_HIGH:             vals.payeRateHigh / 100,
      PAYE_HIGH_THRESHOLD_ANNUAL: vals.payeHighThreshold,
      NIS_RATE:                   vals.nisRate / 100,
      NIS_MONTHLY_CAP:            vals.nisMonthlyCap,
      HS_HIGH_DAILY:              vals.hsHighDaily,
      HS_HIGH_WEEKLY:             vals.hsHighWeekly,
      HS_HIGH_FORTNIGHTLY:        vals.hsHighFortnightly,
      HS_HIGH_MONTHLY:            vals.hsHighMonthly,
      HS_LOW_DAILY:               vals.hsLowDaily,
      HS_LOW_WEEKLY:              vals.hsLowWeekly,
      HS_LOW_FORTNIGHTLY:         vals.hsLowFortnightly,
      HS_LOW_MONTHLY:             vals.hsLowMonthly,
      HS_THRESHOLD_WEEKLY:        vals.hsThreshold,
    };
    for (const [k, v] of Object.entries(payload)) {
      if (v == null || isNaN(v) || v < 0) { toast.error(`Invalid value for "${k.replace(/_/g, ' ')}"`); return; }
    }
    setSaving(true);
    try {
      const res = await savePayrollConstants(payload);
      if (!res.success) { toast.error(res.message || 'Could not save constants'); return; }
      toast.success('T&T payroll constants updated. Re-run payroll to apply.');
      onClose();
    } catch { toast.error('Unexpected error'); }
    finally { setSaving(false); }
  };

  const restoreDefaults = () => setVals({ ...DEFAULT_CONSTANTS });

  const TABS = ['NIS', 'Health Surcharge', 'PAYE'];

  return (
    <div class="prs-overlay active" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="prc-modal" onClick={(e) => e.stopPropagation()} style="max-width:540px;background:#fff;border-radius:12px;overflow:hidden">
        <div class="prs-header" style="padding:16px 20px">
          <span style="font-weight: var(--font-weight-bold)"><i class="fas fa-scale-balanced" style="margin-right:8px"></i>T&amp;T Statutory Constants</span>
          <button class="prs-close-btn" onClick={onClose}><i class="fas fa-times"></i></button>
        </div>

        {step === 'gate' ? (
          <div style="padding:24px">
            <p style="margin:0 0 16px;color:#555;font-size:14px">Enter your admin password to view or edit statutory rates.</p>
            <input
              ref={pwdRef}
              type="password"
              class="prs-input"
              placeholder="Password"
              value={pwd}
              onInput={(e) => setPwd((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doVerify(); }}
              style="width:100%;box-sizing:border-box;margin-bottom:8px"
            />
            {gateErr && <p style="color:#c00;font-size:13px;margin:0 0 12px">{gateErr}</p>}
            <button class="hr-btn-primary" style="width:100%" onClick={doVerify} disabled={verifying}>
              {verifying ? <><i class="fas fa-spinner fa-spin"></i> Verifying…</> : 'Verify'}
            </button>
          </div>
        ) : (
          <div style="padding:20px">
            <div class="prc-tabs" style="display:flex;gap:4px;margin-bottom:16px">
              {TABS.map((t, i) => (
                <button
                  key={t}
                  class={`prc-tab${tab === i ? ' active' : ''}`}
                  onClick={() => setTab(i)}
                  style={`padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;${tab === i ? 'background:var(--siomac-navy,#1b2d55);color:#fff' : 'background:#f5f5f5;color:#333'}`}
                >{t}</button>
              ))}
            </div>

            {tab === 0 && (
              <div>
                <h4 style="margin:0 0 12px;font-size:14px">National Insurance (NIS)</h4>
                <div class="prs-field"><label class="prs-label">NIS Rate (%)</label>
                  <input class="prs-input" type="number" min="0" max="100" step="0.01" value={vals.nisRate} onInput={(e) => setVal('nisRate', (e.target as HTMLInputElement).value)} />
                </div>
                <div class="prs-field"><label class="prs-label">Monthly Cap (TTD)</label>
                  <input class="prs-input" type="number" min="0" value={vals.nisMonthlyCap} onInput={(e) => setVal('nisMonthlyCap', (e.target as HTMLInputElement).value)} />
                </div>
              </div>
            )}

            {tab === 1 && (
              <div>
                <h4 style="margin:0 0 12px;font-size:14px">Health Surcharge</h4>
                <div class="prs-field"><label class="prs-label">Weekly Gross Threshold (TTD)</label>
                  <input class="prs-input" type="number" min="0" step="0.01" value={vals.hsThreshold} onInput={(e) => setVal('hsThreshold', (e.target as HTMLInputElement).value)} />
                </div>
                <p style="font-size:12px;color:#888;margin:8px 0">High rates (above threshold):</p>
                {(['Daily','Weekly','Fortnightly','Monthly'] as const).map((lbl, i) => {
                  const key = `hsHigh${lbl}` as keyof PayrollConstants;
                  return (
                    <div class="prs-field" key={key}>
                      <label class="prs-label">{lbl} High (TTD)</label>
                      <input class="prs-input" type="number" min="0" step="0.01" value={vals[key]} onInput={(e) => setVal(key, (e.target as HTMLInputElement).value)} />
                    </div>
                  );
                })}
                <p style="font-size:12px;color:#888;margin:8px 0">Low rates (at/below threshold):</p>
                {(['Daily','Weekly','Fortnightly','Monthly'] as const).map((lbl) => {
                  const key = `hsLow${lbl}` as keyof PayrollConstants;
                  return (
                    <div class="prs-field" key={key}>
                      <label class="prs-label">{lbl} Low (TTD)</label>
                      <input class="prs-input" type="number" min="0" step="0.01" value={vals[key]} onInput={(e) => setVal(key, (e.target as HTMLInputElement).value)} />
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 2 && (
              <div>
                <h4 style="margin:0 0 12px;font-size:14px">Pay As You Earn (PAYE)</h4>
                <div class="prs-field"><label class="prs-label">Personal Allowance Annual (TTD)</label>
                  <input class="prs-input" type="number" min="0" value={vals.allowanceAnnual} onInput={(e) => setVal('allowanceAnnual', (e.target as HTMLInputElement).value)} />
                </div>
                <div class="prs-field"><label class="prs-label">Low Rate (%)</label>
                  <input class="prs-input" type="number" min="0" max="100" step="0.01" value={vals.payeRateLow} onInput={(e) => setVal('payeRateLow', (e.target as HTMLInputElement).value)} />
                </div>
                <div class="prs-field"><label class="prs-label">High Rate (%)</label>
                  <input class="prs-input" type="number" min="0" max="100" step="0.01" value={vals.payeRateHigh} onInput={(e) => setVal('payeRateHigh', (e.target as HTMLInputElement).value)} />
                </div>
                <div class="prs-field"><label class="prs-label">High Rate Threshold Annual (TTD)</label>
                  <input class="prs-input" type="number" min="0" value={vals.payeHighThreshold} onInput={(e) => setVal('payeHighThreshold', (e.target as HTMLInputElement).value)} />
                </div>
              </div>
            )}

            <div style="display:flex;justify-content:space-between;margin-top:20px">
              <button class="hr-btn-outline" style="font-size:13px" onClick={restoreDefaults}>
                <i class="fas fa-rotate-left"></i> Restore Defaults
              </button>
              <div style="display:flex;gap:8px">
                <button class="hr-btn-outline" onClick={onClose}>Cancel</button>
                <button class="hr-btn-primary" onClick={doSave} disabled={saving}>
                  {saving ? <><i class="fas fa-spinner fa-spin"></i> Saving…</> : <><i class="fas fa-save"></i> Save</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

const ZERO_TOTALS: PayrollTotals = { grossPay: 0, netPay: 0, paye: 0, nis: 0, healthSurcharge: 0, totalDeductions: 0 };

function sumTotals(rows: PayrollRow[]): PayrollTotals {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return rows.reduce((t, r) => ({
    grossPay:        r2(t.grossPay        + (r.grossPay        || 0)),
    paye:            r2(t.paye            + (r.paye            || 0)),
    nis:             r2(t.nis             + (r.nis             || 0)),
    healthSurcharge: r2(t.healthSurcharge + (r.healthSurcharge || 0)),
    totalDeductions: r2(t.totalDeductions + (r.totalDeductions || 0)),
    netPay:          r2(t.netPay          + (r.netPay          || 0)),
  }), { ...ZERO_TOTALS });
}

export function PayrollSection() {
  const session  = useSessionStore();
  const fullName = session.fullName || session.username || '';

  // ── Date range ──────────────────────────────────────────────────────────────
  const { start: initStart, end: initEnd } = monthBounds();
  const [dateFrom,  setDateFrom]  = useState(initStart);
  const [dateTo,    setDateTo]    = useState(initEnd);

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [cycleFilter, setCycleFilter] = useState('all');
  const [deptFilter,  setDeptFilter]  = useState('all');
  const [filterOpen,  setFilterOpen]  = useState(false);
  const [reportsMode, setReportsMode] = useState(false);

  // ── Run state ───────────────────────────────────────────────────────────────
  const [runData,       setRunData]       = useState<PayrollRunData | null>(null);
  const [displayRows,   setDisplayRows]   = useState<PayrollRow[]>([]);
  const [displayTotals, setDisplayTotals] = useState<PayrollTotals>({ ...ZERO_TOTALS });
  const [running,       setRunning]       = useState(false);
  const [ranThisSession, setRanThisSession] = useState(false);

  // ── Employee picker ─────────────────────────────────────────────────────────
  const [empSearch,    setEmpSearch]    = useState('');
  const [empSelected,  setEmpSelected]  = useState<Set<string>>(new Set());
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // ── Modals ──────────────────────────────────────────────────────────────────
  const [payslipRow,    setPayslipRow]    = useState<PayrollRow | null>(null);
  const [settingsRow,   setSettingsRow]   = useState<PayrollRow | null>(null);
  const [constantsOpen, setConstantsOpen] = useState(false);
  const [approvalConfirm, setApprovalConfirm] = useState(false);
  const [approvalSending, setApprovalSending] = useState(false);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn:  ({ signal }) => listDepartments(signal),
    staleTime: 5 * 60_000,
    enabled:  session.isAuthenticated,
  });

  const { data: allEmployees = [] } = useQuery<EmployeeListItem[]>({
    queryKey: ['employees', 'list'],
    queryFn:  ({ signal }) => listEmployees(signal),
    staleTime: 5 * 60_000,
    enabled:  session.isAuthenticated && reportsMode,
  });

  // ── flatpickr date inputs ────────────────────────────────────────────────────
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef   = useRef<HTMLInputElement>(null);
  const fpFrom  = useRef<{ setDate: (d: string|null) => void; destroy: () => void } | null>(null);
  const fpTo    = useRef<{ setDate: (d: string|null) => void; destroy: () => void } | null>(null);

  useEffect(() => {
    if (typeof (window as unknown as Record<string,unknown>).flatpickr !== 'function') return;
    const fp = (window as unknown as Record<string, unknown>).flatpickr as (el: HTMLElement, opts: unknown) => unknown;
    const { start, end } = monthBounds();

    const opts = reportsMode
      ? { dateFormat: 'Y-m-d', maxDate: 'today' }
      : { dateFormat: 'Y-m-d', minDate: start, maxDate: end };

    if (fromRef.current) {
      fpFrom.current = fp(fromRef.current, {
        ...opts,
        defaultDate: reportsMode ? undefined : start,
        onChange: (ds: Date[]) => {
          if (ds[0]) setDateFrom(ds[0].toISOString().slice(0, 10));
        },
      }) as typeof fpFrom.current;
    }
    if (toRef.current) {
      fpTo.current = fp(toRef.current, {
        ...opts,
        defaultDate: reportsMode ? undefined : end,
        onChange: (ds: Date[]) => {
          if (ds[0]) setDateTo(ds[0].toISOString().slice(0, 10));
        },
      }) as typeof fpTo.current;
    }
    return () => {
      fpFrom.current?.destroy();
      fpTo.current?.destroy();
    };
  }, [reportsMode]);

  // ── Employee picker helpers ─────────────────────────────────────────────────
  const filteredEmps: EmployeeListItem[] = useMemo(() => {
    if (!reportsMode) {
      const source = runData?.rows ?? [];
      return source
        .filter(r => {
          if (deptFilter !== 'all' && String(r.departmentId) !== String(deptFilter)) return false;
          if (cycleFilter !== 'all' && r.payCycle !== cycleFilter) return false;
          if (empSearch && !`${r.name} ${r.department}`.toLowerCase().includes(empSearch.toLowerCase())) return false;
          return true;
        })
        .map(r => ({
          id: r.userId, username: r.username, fullName: r.name,
          departmentId: r.departmentId, departmentName: r.department,
          payCycle: r.payCycle, profileImage: r.profileImage,
        }));
    }
    return allEmployees.filter(e => {
      if (deptFilter  !== 'all' && String(e.departmentId) !== String(deptFilter)) return false;
      if (cycleFilter !== 'all' && e.payCycle !== cycleFilter) return false;
      const q = empSearch.toLowerCase();
      if (q && !`${e.fullName || ''} ${e.firstName || ''} ${e.lastName || ''} ${e.departmentName || e.department || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [reportsMode, runData, allEmployees, deptFilter, cycleFilter, empSearch]);

  // ── Apply filters to displayed rows ────────────────────────────────────────
  useEffect(() => {
    if (!runData) return;
    let base = runData.rows;
    if (cycleFilter !== 'all') base = base.filter(r => r.payCycle === cycleFilter);
    if (deptFilter  !== 'all') base = base.filter(r => String(r.departmentId) === String(deptFilter));
    if (!reportsMode && empSelected.size > 0) {
      base = base.filter(r => empSelected.has(String(r.userId)));
    }
    setDisplayRows(base);
    setDisplayTotals(sumTotals(base));
  }, [runData, cycleFilter, deptFilter, empSelected, reportsMode]);

  // NOTE: DataTables is intentionally NOT used for payrollRunTable.
  // The tbody rows are owned by Preact (they carry onClick handlers for Payslip
  // and Edit that need live Preact closures). Mixing Preact-managed tbody content
  // with DataTables DOM ownership causes TN/18 "Incorrect column count" warnings
  // because DT reads the column count at init time before Preact has committed the
  // correct number of cells. Export buttons are TODO(phase-2g) via native Preact.

  // ── Run payroll ──────────────────────────────────────────────────────────────
  const runPayroll = async () => {
    if (!dateFrom || !dateTo) { toast.error('Please pick a date range first'); return; }
    setRunning(true);
    try {
      const data = await listPayrollRun({
        dateFrom, dateTo,
        cycle:    cycleFilter,
        overrides: {},
      });
      setRunData(data);
      setRanThisSession(true);
      setEmpSelected(new Set());
      setDisplayRows(data.rows);
      setDisplayTotals(data.totals);
    } catch (err) {
      toast.error((err as Error).message || 'Could not run payroll');
    } finally {
      setRunning(false);
    }
  };

  // ── Generate report ──────────────────────────────────────────────────────────
  const runReport = async () => {
    if (!dateFrom || !dateTo) { toast.error('Pick a date range to search'); return; }
    setRunning(true);
    try {
      const empIds = empSelected.size > 0 ? [...empSelected] : null;
      const data = await listPayrollRun({
        dateFrom, dateTo,
        cycle:    cycleFilter,
        department: deptFilter !== 'all' ? deptFilter : null,
        employeeIds: empIds,
        overrides: {},
      });
      let rows = data.rows;
      if (empIds) rows = rows.filter(r => empIds.includes(String(r.userId)));
      setRunData(data);
      setDisplayRows(rows);
      setDisplayTotals(sumTotals(rows));
      setDropdownOpen(false);
    } catch (err) {
      toast.error((err as Error).message || 'Report generation failed');
    } finally {
      setRunning(false);
    }
  };

  // ── Toggle reports mode ───────────────────────────────────────────────────
  const toggleReportsMode = () => {
    const next = !reportsMode;
    setReportsMode(next);
    setFilterOpen(next);
    setRunData(null);
    setDisplayRows([]);
    setDisplayTotals({ ...ZERO_TOTALS });
    setEmpSelected(new Set());
    setEmpSearch('');
    setRanThisSession(false);
    if (!next) {
      const { start, end } = monthBounds();
      setDateFrom(start);
      setDateTo(end);
      setCycleFilter('all');
      setDeptFilter('all');
    }
  };

  // ── Clear filters ────────────────────────────────────────────────────────────
  const clearFilters = () => {
    setCycleFilter('all');
    setDeptFilter('all');
    if (!reportsMode) {
      const { start, end } = monthBounds();
      setDateFrom(start);
      setDateTo(end);
      fpFrom.current?.setDate(start);
      fpTo.current?.setDate(end);
    } else {
      fpFrom.current?.setDate(null);
      fpTo.current?.setDate(null);
      setDateFrom('');
      setDateTo('');
    }
  };

  const filtersChanged = cycleFilter !== 'all' || deptFilter !== 'all' ||
    (reportsMode ? (!!dateFrom || !!dateTo) : (dateFrom !== initStart || dateTo !== initEnd));

  // ── Submit for approval ──────────────────────────────────────────────────────
  const doApproval = async () => {
    const rows = displayRows.length ? displayRows : (runData?.rows ?? []);
    if (!rows.length) { toast.error('Run payroll first before submitting for approval'); return; }
    setApprovalSending(true);
    try {
      const res = await approvePayroll({
        rows, dateFrom: runData?.dateFrom ?? dateFrom, dateTo: runData?.dateTo ?? dateTo,
        cycleFilter, approvedBy: fullName,
      });
      if (!res.success) { toast.error(res.message || 'Could not approve payroll'); return; }
      toast.success('Payroll submitted to Finance for approval ✅');
    } catch (err) {
      toast.error((err as Error).message || 'Error');
    } finally {
      setApprovalSending(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  const showApproval = !reportsMode && ranThisSession && displayRows.length > 0;
  const empCount = empSelected.size;

  return (
    <>
      <PayrollStats totals={displayTotals} />

      {/* Filters bar */}
      <div class="pr-filters-bar">
        <div class="pr-bar-main">
          {/* Employee search / picker */}
          <div class="pr-search-wrap pr-search-wrap--lg" style="position:relative">
            <i class="fas fa-magnifying-glass pr-search-icon"></i>
            <input
              type="text"
              class="pr-search-input pr-search-input--lg"
              placeholder={
                empCount > 0 ? `${empCount} employee${empCount > 1 ? 's' : ''} selected`
                : reportsMode ? 'Filter Employees…' : 'Search Payroll Register…'
              }
              disabled={!reportsMode}
              value={empSearch}
              onInput={(e) => setEmpSearch((e.target as HTMLInputElement).value)}
              onFocus={() => reportsMode && setDropdownOpen(true)}
            />
            {empCount > 0 && (
              <span class="pr-search-badge" style="display:block">{empCount}</span>
            )}

            {/* Employee dropdown (reports mode) */}
            {reportsMode && dropdownOpen && (
              <div class="pr-emp-dropdown open" style="position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:1000">
                <div class="pr-emp-dropdown-actions">
                  <span class="pr-emp-count">{empCount > 0 ? `${empCount} selected` : 'All employees'}</span>
                  <button class="pr-emp-action-btn" onClick={(e) => {
                    e.stopPropagation();
                    setEmpSelected(new Set(filteredEmps.map(e2 => String(e2.id))));
                  }}>Select all</button>
                  <button class="pr-emp-action-btn" onClick={(e) => {
                    e.stopPropagation();
                    setEmpSelected(new Set());
                  }}>Clear</button>
                </div>
                <ul class="pr-emp-list">
                  {filteredEmps.length === 0
                    ? <li class="pr-emp-list-empty">No employees match the current filters.</li>
                    : filteredEmps.map(emp => {
                        const name = emp.fullName || emp.username || '—';
                        const meta = [emp.departmentName || emp.department, emp.payCycle && CYCLE_LABEL[emp.payCycle]].filter(Boolean).join(' · ');
                        const checked = empSelected.has(String(emp.id));
                        const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                        return (
                          <li
                            key={emp.id}
                            class={checked ? 'selected' : ''}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEmpSelected(prev => {
                                const next = new Set(prev);
                                checked ? next.delete(String(emp.id)) : next.add(String(emp.id));
                                return next;
                              });
                            }}
                          >
                            <input type="checkbox" checked={checked} onChange={() => {}} />
                            <div class="pr-emp-avatar"><span class="pr-emp-initials">{initials}</span></div>
                            <div style="flex:1;min-width:0">
                              <div class="pr-emp-name">{name}</div>
                              {meta && <div class="pr-emp-meta">{meta}</div>}
                            </div>
                          </li>
                        );
                      })
                  }
                </ul>
              </div>
            )}
          </div>

          {/* Centre controls */}
          <div class="pr-bar-actions">
            <div class="pr-filters-divider"></div>
            <button
              class={`pr-filter-toggle${filterOpen ? ' active' : ''}`}
              onClick={() => setFilterOpen(o => !o)}
            >
              <i class="fas fa-sliders"></i> Filters
            </button>
            <div class="pr-apply-wrap">
              <button
                class="pr-apply-btn"
                onClick={reportsMode ? runReport : runPayroll}
                disabled={running}
              >
                {running
                  ? <><i class="fas fa-spinner fa-spin"></i> {reportsMode ? 'Searching…' : 'Running…'}</>
                  : reportsMode
                    ? <><i class="fas fa-chart-bar"></i> Generate Report</>
                    : <><i class="fas fa-play"></i> Run Payroll</>}
              </button>
            </div>
            <div class="pr-filters-divider" style="margin:0 20px"></div>
            <button
              class={`pr-report-btn${reportsMode ? ' active' : ''}`}
              onClick={toggleReportsMode}
            >
              <i class="fas fa-chart-bar"></i> Reports
            </button>
          </div>

          {/* Far right */}
          <div class="pr-bar-right">
            {showApproval && (
              <button
                class="pr-approval-btn"
                disabled={approvalSending}
                onClick={() => setApprovalConfirm(true)}
              >
                <i class="fas fa-paper-plane"></i> Submit for Approval
              </button>
            )}
            <button
              class="pr-statutory-btn"
              title="Statutory Rate Configuration"
              onClick={() => setConstantsOpen(true)}
            >
              <i class="fas fa-scale-balanced"></i>
            </button>
          </div>
        </div>

        {/* Collapsible filters */}
        {filterOpen && (
          <div class="pr-filter-expand open">
            <div class="pr-filter-fields">
              <div class="pr-filter-group">
                <span class="pr-date-label"><i class="fas fa-calendar-range" style="margin-right:6px"></i>Period</span>
                <input ref={fromRef} type="text" class="pr-date-input" placeholder="From" readonly />
                <span class="pr-arrow-sep">→</span>
                <input ref={toRef}   type="text" class="pr-date-input" placeholder="To"   readonly />
              </div>
              <div class="pr-filters-divider"></div>
              <div class="pr-filter-group">
                <span class="pr-date-label"><i class="fas fa-calendar-week" style="margin-right:6px"></i>Pay Cycle</span>
                <select class="pr-cycle-select" value={cycleFilter} onChange={(e) => setCycleFilter((e.target as HTMLSelectElement).value)}>
                  <option value="all">All Cycles</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div class="pr-filters-divider"></div>
              <div class="pr-filter-group">
                <span class="pr-date-label"><i class="fas fa-sitemap" style="margin-right:6px"></i>Department</span>
                <select class="pr-cycle-select" value={deptFilter} onChange={(e) => setDeptFilter((e.target as HTMLSelectElement).value)}>
                  <option value="all">All Departments</option>
                  {departments.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
                </select>
              </div>
              <div class="pr-filters-divider"></div>
              <button class="pr-clear-filters-btn" disabled={!filtersChanged} onClick={clearFilters}>
                <i class="fas fa-xmark"></i> Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Payroll table */}
      <div class="data-section">
        <div class="section-header">
          <h2>
            {reportsMode
              ? <><i class="fas fa-chart-bar" style="margin-right:8px;color:var(--siomac-red)"></i>Payroll Reports</>
              : <><i class="fas fa-money-check-dollar" style="margin-right:8px;color:var(--siomac-red)"></i>Payroll Register</>}
          </h2>
          <div class="section-actions"><div id="prTableBtns"></div></div>
        </div>
        <table id="payrollRunTable" class="table align-middle">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Cycle</th>
              <th>Basis</th>
              <th>Hours</th>
              <th>Gross Pay</th>
              <th>NIS</th>
              <th>Health</th>
              <th>PAYE</th>
              <th>Net Pay</th>
              <th class="dt-no-export"></th>
            </tr>
          </thead>
          <tbody>
            {!displayRows.length ? (
              <tr>
                <td colspan={11} class="pr-empty">
                  <i class={`fas fa-${reportsMode ? 'chart-bar' : 'play-circle'}`}></i>{' '}
                  {reportsMode
                    ? 'Open the Filters panel, pick a date range and click Generate Report.'
                    : 'Select a date range and click Run Payroll to generate.'}
                </td>
              </tr>
            ) : displayRows.map(r => (
              <tr key={r.userId}>
                <td>
                  <strong>{r.name}</strong><br />
                  <small class="text-muted">{r.position}</small>
                </td>
                <td>{r.department}</td>
                <td><span class={`pr-cycle-badge pr-cycle-${r.payCycle}`}>{CYCLE_LABEL[r.payCycle] || r.payCycle}</span></td>
                <td>{r.payBasis === 'hourly' ? 'Hourly' : 'Salary'}</td>
                <td>{Number(r.hoursWorked || 0).toFixed(1)}</td>
                <td>{fmtMoney(r.grossPay)}</td>
                <td>{r.nisApplicable ? fmtMoney(r.nis) : '—'}</td>
                <td>{r.hsApplicable  ? fmtMoney(r.healthSurcharge) : '—'}</td>
                <td>{fmtMoney(r.paye)}</td>
                <td><strong>{fmtMoney(r.netPay)}</strong></td>
                <td class="dt-no-export" style="white-space:nowrap">
                  <button class="pr-row-btn pr-payslip-btn" onClick={() => setPayslipRow(r)}>
                    <i class="fas fa-eye"></i> Payslip
                  </button>
                  {!reportsMode && (
                    <button class="pr-row-btn pr-edit-btn" onClick={() => setSettingsRow(r)}>
                      <i class="fas fa-sliders"></i> Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payslip modal */}
      {payslipRow && runData && (
        <PayslipModal
          row={payslipRow}
          dateFrom={runData.dateFrom}
          dateTo={runData.dateTo}
          onClose={() => setPayslipRow(null)}
        />
      )}

      {/* Employee settings modal */}
      {settingsRow && (
        <PayrollSettingsModal
          row={settingsRow}
          onClose={() => setSettingsRow(null)}
          onSaved={() => void runPayroll()}
        />
      )}

      {/* Constants modal */}
      {constantsOpen && (
        <ConstantsModal onClose={() => setConstantsOpen(false)} />
      )}

      {/* Submit for approval confirm */}
      {approvalConfirm && (
        <ConfirmDialog
          open={approvalConfirm}
          title="Submit for Approval"
          message={`Submit the ${cycleFilter !== 'all' ? cycleFilter.replace(/\b\w/g, c => c.toUpperCase()) : 'All Cycles'} payroll (${displayRows.length} employee${displayRows.length !== 1 ? 's' : ''}) to Finance Department for approval?`}
          confirmLabel="Yes, Submit"
          loading={approvalSending}
          onClose={() => setApprovalConfirm(false)}
          onConfirm={() => void doApproval()}
        />
      )}

      {/* Close dropdown on outside click */}
      {dropdownOpen && (
        <div
          style="position:fixed;inset:0;z-index:999"
          onClick={() => setDropdownOpen(false)}
        />
      )}
    </>
  );
}
