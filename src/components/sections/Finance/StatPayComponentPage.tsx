/**
 * src/components/sections/Finance/StatPayComponentPage.tsx
 *
 * Finance ▸ Statutory Configuration ▸ Create / Edit Pay Component — FULL PAGE.
 *
 * Design pivot (2026-07-08): replaces the old `StatPayComponentDialog` modal with a
 * full page in the mockup design language (statutoryForms.css / .sfp), bound to the
 * REAL `finance_pay_components` model only. The mockup's extra fields (component type,
 * effective/retire dates, default amount, calc basis, linked version, description,
 * mapping-rules table) DO NOT exist in the backend and are intentionally omitted
 * (No-Band-Aids — no fake fields). The "Payroll Treatment" sidebar is derived LIVE
 * from the real flags, not faked.
 *
 * Fully wired: create/update/retire go through the statutory backbone server-side.
 * Code + kind are immutable after creation (mirrors the backend update contract).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import {
  useStatutoryMutation, financeStatutoryApi, type PayComponent,
} from '@api/finance/statutory';
import { fmtDate } from './financeShared';
import {
  IconEye, IconShield, IconClock, IconOkBadge, IconCoins,
  TextField, SelectField, ToggleField, StatFormShell, minLenError,
} from './_shared/sfpKit';
import './statutoryForms.css';

const CODE_RE = /^[A-Za-z0-9_]+$/;

export function StatPayComponentPage({ edit, onClose }: {
  edit?: PayComponent;
  onClose: () => void;
}): VNode {
  const createMut = useStatutoryMutation(financeStatutoryApi.createComponent);
  const updateMut = useStatutoryMutation(financeStatutoryApi.updateComponent);
  const retireMut = useStatutoryMutation(financeStatutoryApi.retireComponent);

  const canManage = can('finance.statutory.manage');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [f, setF] = useState({
    code:                   edit?.code ?? '',
    name:                   edit?.name ?? '',
    kind:                   edit?.kind ?? 'earning',
    isStatutory:            edit?.isStatutory ?? false,
    isTaxable:              edit?.isTaxable ?? true,
    reducesChargeable:      edit?.reducesChargeable ?? false,
    glAccountCode:          edit?.glAccountCode ?? '',
    costAllocationRequired: edit?.costAllocationRequired ?? false,
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF(p => ({ ...p, [k]: v }));

  const readOnly = !canManage;
  const retired = !!edit && !edit.isActive;

  // ── Validation ───────────────────────────────────────────────────────────────
  const err: Partial<Record<'code' | 'name', string>> = {};
  if (!f.code.trim()) err.code = 'Component code is required.';
  else if (!CODE_RE.test(f.code.trim())) err.code = 'Code must be letters, numbers or underscore only.';
  else { const m = minLenError(f.code, 2); if (m) err.code = m; }
  if (!f.name.trim()) err.name = 'Component name is required.';
  else { const m = minLenError(f.name, 2); if (m) err.name = m; }
  const hasErrors = Object.keys(err).length > 0;
  const show = submitAttempted;

  // ── Actions ──────────────────────────────────────────────────────────────────
  const save = async (): Promise<void> => {
    setSubmitAttempted(true);
    if (hasErrors || readOnly) return;
    try {
      if (edit) {
        await updateMut.mutateAsync({
          id: edit.id, name: f.name.trim(), isStatutory: f.isStatutory, isTaxable: f.isTaxable,
          reducesChargeable: f.reducesChargeable, glAccountCode: f.glAccountCode.trim() || null,
          costAllocationRequired: f.costAllocationRequired,
        });
        toast(`Update request for ${edit.code} submitted for approval.`);
      } else {
        await createMut.mutateAsync({
          code: f.code.trim().toUpperCase(), name: f.name.trim(), kind: f.kind as 'earning' | 'deduction',
          isStatutory: f.isStatutory, isTaxable: f.isTaxable, reducesChargeable: f.reducesChargeable,
          glAccountCode: f.glAccountCode.trim() || null, costAllocationRequired: f.costAllocationRequired,
        });
        toast(`New component request for ${f.code.trim().toUpperCase()} submitted for approval.`);
      }
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  const retire = async (): Promise<void> => {
    if (!edit) return;
    const ok = await dialog.confirm({
      title: `Submit retire request for ${edit.code}?`,
      text: 'A retire request will be sent for approval. The component remains active until a finance manager approves it.',
      danger: true, confirmText: 'Submit retire request',
    });
    if (!ok) return;
    try { await retireMut.mutateAsync({ id: edit.id }); toast(`Retire request for ${edit.code} submitted for approval.`); onClose(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const busy = createMut.isPending || updateMut.isPending || retireMut.isPending;
  const title = edit ? 'Edit Pay Component' : 'Create Pay Component';
  const isEarn = f.kind === 'earning';

  const flagRow = (label: string, on: boolean): VNode => (
    <div class="sfp-mrow"><span class="k">{label}</span><span class="v"><span class={`sfp-pill ${on ? 'yes' : 'no'}`}>{on ? 'Yes' : 'No'}</span></span></div>
  );

  return (
    <StatFormShell
      icon={<IconCoins size={20} />}
      title={title}
      sub="Define a pay component and how it applies in payroll calculations and statutory reporting."
      statusLabel={edit ? (retired ? 'Retired' : 'Active') : null}
      onBack={onClose}
    >
      <div class="sfp-body">
            {/* Form */}
            <div class="sfp-form">
              {readOnly && (
                <div class="sfp-banner warn">
                  <span class="ic"><IconClock size={15} /></span>
                  <span>You don’t have permission to manage pay components. This page is <b>read-only</b>.</span>
                </div>
              )}
              {!readOnly && (
                <div class="sfp-banner info">
                  <span class="ic"><IconShield size={15} /></span>
                  <span>
                    <b>Approval required.</b> Changes are submitted as a change request and must be approved by a different Finance Manager before taking effect.
                  </span>
                </div>
              )}

              <TextField label="Component Code" required show={show} disabled={readOnly || !!edit} mono minLength={2}
                hint={edit ? 'Code is immutable after creation.' : 'Unique code used in payroll and reports (UPPERCASE).'}
                value={f.code} onInput={set('code')} error={err.code} placeholder="e.g. HOUS_ALLOW" />

              <TextField label="Component Name" required show={show} disabled={readOnly} minLength={2}
                hint="Display name for payslips and reports."
                value={f.name} onInput={set('name')} error={err.name} placeholder="e.g. Housing Allowance" />

              <SelectField label="Payroll Category" required show={show} disabled={readOnly || !!edit}
                hint={edit ? 'Category is immutable after creation.' : 'Whether this is an earning or a deduction.'}
                value={f.kind} onChange={v => set('kind')(v as 'earning' | 'deduction')}
                options={[{ value: 'earning', label: 'Earning' }, { value: 'deduction', label: 'Deduction' }]} />

              <TextField label="GL Account Code" show={show} disabled={readOnly} mono
                hint="Optional — general-ledger account this component posts to."
                value={f.glAccountCode} onInput={set('glAccountCode')} placeholder="Optional" />

              <ToggleField label="Taxable" on={f.isTaxable} disabled={readOnly} onToggle={set('isTaxable')} />
              <ToggleField label="Statutory Component" on={f.isStatutory} disabled={readOnly} onToggle={set('isStatutory')} />
              <ToggleField label="Reduces PAYE Chargeable" on={f.reducesChargeable} disabled={readOnly} onToggle={set('reducesChargeable')} />
              <ToggleField label="Cost Allocation Required" on={f.costAllocationRequired} disabled={readOnly} onToggle={set('costAllocationRequired')} />
            </div>

            {/* Aside — derived live from the real flags (not faked) */}
            <div class="sfp-aside">
              <div class="sfp-panel">
                <div class="sfp-panel-head"><span class="ic"><IconEye /></span>Payroll Treatment</div>
                <div class="sfp-mrow"><span class="k">Category</span><span class="v"><span class={`sfp-pill ${isEarn ? 'earn' : 'deduct'}`}>{isEarn ? 'Earning' : 'Deduction'}</span></span></div>
                <div class="sfp-mrow"><span class="k">{isEarn ? 'Added to' : 'Deducted from'}</span><span class="v">{isEarn ? (f.isTaxable ? 'Gross (taxable) pay' : 'Gross (non-taxable) pay') : 'Net pay'}</span></div>
                <div class="sfp-mrow"><span class="k">GL account</span><span class="v">{f.glAccountCode.trim() || '—'}</span></div>
                <div class="sfp-xs">This is how the component will be treated in payroll, derived from the flags below.</div>
              </div>

              <div class="sfp-panel">
                <div class="sfp-panel-head"><span class="ic"><IconShield /></span>Compliance Flags</div>
                {flagRow('Taxable', f.isTaxable)}
                {flagRow('Statutory component', f.isStatutory)}
                {flagRow('Reduces PAYE chargeable', f.reducesChargeable)}
                {flagRow('Cost allocation required', f.costAllocationRequired)}
              </div>

              {edit && (
                <div class="sfp-panel">
                  <div class="sfp-panel-head"><span class="ic"><IconClock /></span>Record</div>
                  <div class="sfp-mrow"><span class="k">Created</span><span class="v">{fmtDate(edit.createdAt)}</span></div>
                  <div class="sfp-mrow"><span class="k">Last updated</span><span class="v">{edit.updatedAt ? fmtDate(edit.updatedAt) : '—'}</span></div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div class="sfp-footer">
            <button type="button" class="sfp-btn sfp-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <div class="right">
              {edit && canManage && !retired && (
                <button type="button" class="sfp-btn sfp-btn-danger" onClick={() => void retire()} disabled={busy}>
                  {retireMut.isPending ? <span class="sfp-spin" /> : null} Submit retire request
                </button>
              )}
              <button type="button" class="sfp-btn sfp-btn-primary" onClick={() => void save()} disabled={busy || readOnly || (show && hasErrors)}>
                {createMut.isPending || updateMut.isPending ? <span class="sfp-spin" /> : <IconOkBadge />}
                {edit ? 'Submit for approval' : 'Submit for approval'}
              </button>
            </div>
          </div>
    </StatFormShell>
  );
}
