/**
 * src/components/sections/Finance/StatNisBandPage.tsx
 *
 * Finance ▸ Statutory Configuration ▸ Edit / Add NIS Contribution Band — FULL PAGE.
 *
 * Design pivot (2026-07-08): replaces the old `StatNisClassDialog` modal with a
 * full-page view in the new mockup design language (see statutoryForms.css).
 *
 * Bound to the REAL Trinidad & Tobago NIS model — fixed WEEKLY $ contributions per
 * earnings band, NOT the mockup's percentage-rate model (see memory
 * statutory-nis-model-reconciliation). Fields: class no, weekly earnings band
 * (min/max, max blank = open-ended top band), employee/employer weekly contribution.
 * Version-level concerns (effective date, status, NIS ceiling, lifecycle, audit,
 * linked payroll runs) are DISPLAY-ONLY context here; they live on the Rate Version.
 *
 * Fully wired: upsert/delete go through the statutory backbone server-side
 * (app_events + hr_audit_log + notify). FE enforces the same editability gate the
 * server enforces (draft/approved only) and raises toasts on success/error.
 */

import { type VNode } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { toast } from '@store';
import { useCan } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import {
  useVersionDetail, useStatutoryMutation, financeStatutoryApi,
  type NisClass, type StatutoryVersionStatus,
} from '@api/finance/statutory';
import { fmtMoney, fmtDate, humanize } from './financeShared';
import { StatFormShell, IconOkBadge, IconLayers } from './_shared/sfpKit';
import './statutoryForms.css';

const WEEKS_PER_MONTH = 52 / 12; // ≈ 4.333 — annualised monthly ESTIMATE, never stored.

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Version status → sfp-pill variant class. */
function pillClass(status: StatutoryVersionStatus): string {
  switch (status) {
    case 'active':           return 'active';
    case 'pending_approval': return 'pending';
    case 'approved':         return 'approved';
    case 'retired':          return 'retired';
    default:                 return 'draft';
  }
}

// ── Inline icons (ported from the mockup) ──────────────────────────────────────
const IconOk = (): VNode => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
);
const IconBad = (): VNode => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>
);
const IconCoins = (): VNode => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/></svg>
);
const IconBook = (): VNode => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/></svg>
);
const IconClock = (): VNode => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
);
const IconArrow = (): VNode => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
);
const IconInfo = (): VNode => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01" stroke-linecap="round"/></svg>
);

// ── Money field (currency-prefix group) ─────────────────────────────────────────
function MoneyField({ label, hint, value, onInput, error, show, required, disabled, placeholder }: {
  label: string; hint: string; value: string; onInput: (v: string) => void;
  error?: string; show: boolean; required?: boolean; disabled?: boolean; placeholder?: string;
}): VNode {
  const hasVal = value.trim() !== '';
  const bad = !!error && (hasVal || show);
  const ok = !error && hasVal;
  return (
    <div class="sfp-field">
      <label class="sfp-lab">{label}{required && <span class="sfp-req">*</span>} {hint ? <span class="sfp-info" data-tip={hint} tabIndex={0} role="img" aria-label={hint}><IconInfo /></span> : null}</label>
      <div class={`sfp-cur-grp${ok ? ' is-ok' : ''}${bad ? ' is-bad' : ''}`}>
        <span class="sfp-cur">TTD</span>
        <input type="number" step="0.01" inputMode="decimal" value={value} disabled={disabled} placeholder={placeholder}
          onInput={e => onInput((e.currentTarget).value)} />
        {ok && <span class="sfp-state ok"><IconOk /></span>}
        {bad && <span class="sfp-state bad"><IconBad /></span>}
      </div>
      {bad ? <span class="sfp-err-msg">{error}</span> : <span class="sfp-hint">{hint}</span>}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────
export function StatNisBandPage({ versionId, edit, onClose, onViewVersion }: {
  versionId: string;
  edit?: NisClass;
  onClose: () => void;
  onViewVersion?: () => void;
}): VNode {
  const detailQ = useVersionDetail(versionId);
  const version = detailQ.data;

  const upsertMut = useStatutoryMutation(financeStatutoryApi.upsertNisClass);
  const deleteMut = useStatutoryMutation(financeStatutoryApi.deleteNisClass);

  // Stable per-attempt idempotency key for the Shape-C re-approval path.
  // Generated once when the user first saves an approved version; cleared on success so
  // a subsequent save (e.g. after an error) gets a fresh key.
  const reapprovalKeyRef = useRef<string | null>(null);

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [f, setF] = useState({
    classNo:        edit ? String(edit.classNo) : '',
    weeklyMin:      edit ? String(edit.weeklyMin) : '',
    weeklyMax:      edit?.weeklyMax != null ? String(edit.weeklyMax) : '',
    employeeWeekly: edit ? String(edit.employeeWeekly) : '',
    employerWeekly: edit ? String(edit.employerWeekly) : '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF(p => ({ ...p, [k]: v }));

  const canManage = useCan('finance.statutory.manage');
  const canDelete = useCan('finance.statutory.nis_class.delete');
  // Server enforces this exact gate (upsertNisClasses): edits only on draft/approved.
  const editable = !!version && (version.status === 'draft' || version.status === 'approved');
  const readOnly = !canManage || !editable;

  // Siblings for uniqueness + overlap checks (exclude the band being edited).
  const siblings = (version?.nisClasses ?? []).filter(c => (edit ? c.id !== edit.id : true));

  // ── Validation (real T&T model) ──────────────────────────────────────────────
  const classNoNum = numOrNull(f.classNo);
  const minNum = numOrNull(f.weeklyMin);
  const maxBlank = f.weeklyMax.trim() === '';
  const maxNum = numOrNull(f.weeklyMax); // null when blank OR unparseable
  const empNum = numOrNull(f.employeeWeekly);
  const erNum  = numOrNull(f.employerWeekly);

  const err: Partial<Record<keyof typeof f, string>> = {};

  if (classNoNum == null || !Number.isInteger(classNoNum) || classNoNum < 1) {
    err.classNo = 'Class number is required and must be a whole number ≥ 1.';
  } else if (siblings.some(s => s.classNo === classNoNum)) {
    err.classNo = `Class number ${classNoNum} already exists in this version.`;
  }

  if (minNum == null || minNum < 0) {
    err.weeklyMin = 'Weekly minimum earnings is required and must be ≥ 0.';
  }

  const openEnded = maxBlank;
  if (!maxBlank && maxNum == null) {
    err.weeklyMax = 'Weekly maximum must be a number, or blank for an open-ended top band.';
  } else if (maxNum != null && minNum != null && maxNum <= minNum) {
    err.weeklyMax = 'Weekly maximum must be greater than the minimum.';
  } else if (openEnded && siblings.some(s => s.weeklyMax == null)) {
    err.weeklyMax = 'Another band is already open-ended. Only the top band may have no maximum.';
  }

  // Overlap: this band's [min, max?∞] must not intersect any sibling's range.
  if (!err.weeklyMin && !err.weeklyMax && minNum != null) {
    const aMax = maxNum ?? Number.POSITIVE_INFINITY;
    const clash = siblings.find(s => {
      const sMax = s.weeklyMax ?? Number.POSITIVE_INFINITY;
      return minNum < sMax && s.weeklyMin < aMax; // open-interval overlap
    });
    if (clash) {
      err.weeklyMax = `Band overlaps Class ${clash.classNo} (${fmtMoney(clash.weeklyMin)}–${clash.weeklyMax == null ? '∞' : fmtMoney(clash.weeklyMax)}).`;
    }
  }

  if (empNum == null || empNum < 0) {
    err.employeeWeekly = 'Employee weekly contribution is required and must be ≥ 0.';
  }
  if (erNum == null || erNum < 0) {
    err.employerWeekly = 'Employer weekly contribution is required and must be ≥ 0.';
  }

  const hasErrors = Object.keys(err).length > 0;
  const show = submitAttempted;

  // ── Sidebar estimates ────────────────────────────────────────────────────────
  const monthlyEmp = empNum != null ? empNum * WEEKS_PER_MONTH : null;
  const monthlyEr  = erNum  != null ? erNum  * WEEKS_PER_MONTH : null;
  const combinedWeekly = (empNum ?? 0) + (erNum ?? 0);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const save = async (): Promise<void> => {
    setSubmitAttempted(true);
    if (hasErrors || readOnly) return;

    // Shape-C re-approval: generate a stable per-attempt idempotency key so the
    // backend RPC can deduplicate retries. The key is cleared on success; if the
    // user retries after a network error the SAME key re-uses the existing workflow.
    const isReapprovalPath = version?.status === 'approved';
    if (isReapprovalPath && reapprovalKeyRef.current === null) {
      reapprovalKeyRef.current = crypto.randomUUID();
    }

    try {
      await upsertMut.mutateAsync({
        statutoryVersionId: versionId,
        classNo: classNoNum!,
        weeklyMin: minNum!,
        weeklyMax: maxNum, // null = open-ended
        employeeWeekly: empNum!,
        employerWeekly: erNum!,
        ...(isReapprovalPath && reapprovalKeyRef.current != null
          ? { idempotencyKey: reapprovalKeyRef.current }
          : {}),
      });
      reapprovalKeyRef.current = null; // clear so next save gets a fresh key
      toast(edit ? `NIS Contribution Band ${classNoNum} updated.` : `NIS Contribution Band ${classNoNum} added.`);
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  const remove = async (): Promise<void> => {
    if (!edit) return;
    const ok = await dialog.confirm({
      title: `Delete NIS Contribution Band ${edit.classNo}?`,
      text: 'This removes the band from this rate version. This cannot be undone.',
      danger: true, confirmText: 'Delete band',
    });
    if (!ok) return;
    try {
      await deleteMut.mutateAsync({ id: edit.id });
      toast(`NIS Contribution Band ${edit.classNo} deleted.`);
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  const busy = upsertMut.isPending || deleteMut.isPending;
  const title = edit ? 'Edit NIS Contribution Band' : 'Add NIS Contribution Band';

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <StatFormShell
      icon={<IconLayers size={20} />}
      title={title}
      sub="Define the weekly earnings band and the fixed NIS contribution amounts for this class. Contributions are applied per week worked in the pay period."
      statusLabel={version ? humanize(version.status) : null}
      onBack={onClose}
    >
      {detailQ.isLoading && !version ? (
            <div class="sfp-loading">Loading rate version…</div>
          ) : !version ? (
            <div class="sfp-loading">Rate version not found. It may have been removed.</div>
          ) : (
            <>
              <div class="sfp-body">
                {/* Form */}
                <div class="sfp-form">
                  {readOnly && (
                    <div class="sfp-banner warn">
                      <span class="ic"><IconInfo /></span>
                      <span>
                        {!canManage
                          ? <>You don't have permission to modify NIS contribution bands. This page is <b>read-only</b>.</>
                          : <>Bands can only be edited while the rate version is <b>draft</b> or <b>approved</b>. This version is <b>{humanize(version.status)}</b>, so it is locked.</>}
                      </span>
                    </div>
                  )}
                  {!readOnly && version.status === 'approved' && (
                    <div class="sfp-banner warn">
                      <span class="ic"><IconInfo /></span>
                      <span>
                        <b>Re-approval required.</b> This version is already <b>approved</b>. Saving will revert it to <b>Awaiting Approval</b> so the updated NIS figures can be re-approved before activation.
                      </span>
                    </div>
                  )}

                  {/* Class No */}
                  <div class="sfp-field">
                    <label class="sfp-lab">Class Number <span class="sfp-req">*</span> <span class="sfp-info" data-tip="The NIS earnings-class number for this weekly contribution band." tabIndex={0} role="img" aria-label="The NIS earnings-class number for this weekly contribution band."><IconInfo /></span></label>
                    <div class="sfp-ctl">
                      <input class={`sfp-inp${err.classNo && (f.classNo.trim() !== '' || show) ? ' is-bad' : !err.classNo && f.classNo.trim() !== '' ? ' is-ok' : ''}`}
                        type="number" step="1" inputMode="numeric" value={f.classNo} disabled={readOnly}
                        onInput={e => set('classNo')((e.currentTarget).value)} />
                      {err.classNo && (f.classNo.trim() !== '' || show) ? <span key="bad" class="sfp-state bad"><IconBad /></span>
                        : (!err.classNo && f.classNo.trim() !== '' ? <span key="ok" class="sfp-state ok"><IconOk /></span> : null)}
                    </div>
                    {show && err.classNo ? <span class="sfp-err-msg">{err.classNo}</span> : <span class="sfp-hint">Unique sequential class number within this rate version.</span>}
                  </div>

                  {/* Spacer field to keep the class-no on its own row-half */}
                  <div class="sfp-field" aria-hidden="true" />

                  <MoneyField label="Weekly Minimum Earnings" required show={show} disabled={readOnly}
                    hint="Inclusive lower bound of weekly insurable earnings for this band."
                    value={f.weeklyMin} onInput={set('weeklyMin')} error={err.weeklyMin} />

                  <MoneyField label="Weekly Maximum Earnings" show={show} disabled={readOnly}
                    hint="Inclusive upper bound. Leave blank for the open-ended top band (no ceiling)."
                    placeholder="No ceiling"
                    value={f.weeklyMax} onInput={set('weeklyMax')} error={err.weeklyMax} />

                  <MoneyField label="Employee Weekly Contribution" required show={show} disabled={readOnly}
                    hint="Fixed amount deducted from the employee per week."
                    value={f.employeeWeekly} onInput={set('employeeWeekly')} error={err.employeeWeekly} />

                  <MoneyField label="Employer Weekly Contribution" required show={show} disabled={readOnly}
                    hint="Fixed amount contributed by the employer per week."
                    value={f.employerWeekly} onInput={set('employerWeekly')} error={err.employerWeekly} />
                </div>

                {/* Context sidebar — DISPLAY ONLY, real data */}
                <div class="sfp-aside">
                  <div class="sfp-panel">
                    <div class="sfp-panel-head"><span class="ic"><IconCoins /></span>Contribution Summary</div>
                    <div class="sfp-mrow"><span class="k">Employee / week</span><span class="v">{empNum != null ? fmtMoney(empNum) : '—'}</span></div>
                    <div class="sfp-mrow"><span class="k">Employer / week</span><span class="v">{erNum != null ? fmtMoney(erNum) : '—'}</span></div>
                    <div class="sfp-mrow"><span class="k">Combined / week</span><span class="v">{fmtMoney(combinedWeekly)}</span></div>
                    <div class="sfp-mrow"><span class="k">Employee / month <span title="Estimate">*</span></span><span class="v est">{monthlyEmp != null ? fmtMoney(monthlyEmp) : '—'}</span></div>
                    <div class="sfp-mrow"><span class="k">Employer / month <span title="Estimate">*</span></span><span class="v est">{monthlyEr != null ? fmtMoney(monthlyEr) : '—'}</span></div>
                    <div class="sfp-xs">* Monthly figures are estimates (weekly × {WEEKS_PER_MONTH.toFixed(2)} wks). Payroll applies the exact weekly amount per week worked.</div>
                  </div>

                  <div class="sfp-panel">
                    <div class="sfp-panel-head"><span class="ic"><IconBook /></span>Rate Version</div>
                    <div class="sfp-mrow"><span class="k">Version</span><span class="v">{version.label}</span></div>
                    <div class="sfp-mrow"><span class="k">Status</span><span class="v"><span class={`sfp-pill ${pillClass(version.status)}`}>{version.status === 'active' && <span class="sfp-dot" />}{humanize(version.status)}</span></span></div>
                    <div class="sfp-mrow"><span class="k">Effective from</span><span class="v">{fmtDate(version.effectiveFrom)}</span></div>
                    <div class="sfp-mrow"><span class="k">NIS monthly ceiling</span><span class="v">{version.nisMonthyCeiling != null ? fmtMoney(version.nisMonthyCeiling) : '—'}</span></div>
                    <div class="sfp-mrow"><span class="k">Payroll runs linked</span><span class="v">{version.linkedPayrollRunCount ?? 0}</span></div>
                    {onViewVersion && (
                      <span class="sfp-sub" style={{ marginTop: 10, fontWeight: 600, color: 'var(--sfp-primary-600)', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }} onClick={onViewVersion}>
                        View rate version <IconArrow />
                      </span>
                    )}
                  </div>

                  {edit && (
                    <div class="sfp-panel">
                      <div class="sfp-panel-head"><span class="ic"><IconClock /></span>Record</div>
                      <div class="sfp-mrow"><span class="k">Band created</span><span class="v">{fmtDate(edit.createdAt)}</span></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div class="sfp-footer">
                <button type="button" class="sfp-btn sfp-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <div class="right">
                  {edit && canDelete && editable && (
                    <button type="button" class="sfp-btn sfp-btn-danger" onClick={() => void remove()} disabled={busy}>
                      {deleteMut.isPending ? <span class="sfp-spin" /> : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                      )}
                      Delete band
                    </button>
                  )}
                  <button type="button" class="sfp-btn sfp-btn-primary" onClick={() => void save()} disabled={busy || readOnly || (show && hasErrors)}>
                    {upsertMut.isPending ? <span class="sfp-spin" /> : <IconOkBadge />}
                    {edit ? 'Save changes' : 'Add band'}
                  </button>
                </div>
              </div>
        </>
      )}
    </StatFormShell>
  );
}
