/**
 * src/components/sections/HR/CompensationOverview.tsx
 *
 * HR ▸ Compensation (nav id `s-hr-compensation`).
 * Surfaces:
 *   • Pay Items — recurring earnings/deductions per employee (effective-dated,
 *     maker-checker: draft → submit → approve). Uses the Finance pay-component catalogue.
 *   • Statutory Profile — HR captures NIS continuity data and submits it for Finance
 *     verification (HR can never mark verified — that's Finance's `nis/*` queue).
 * Reads/writes the real `hr/compensation/*` and `hr/employee-statutory/*` backends.
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import { usePayItems, useCompensationMutation, hrCompensationApi, type CreatePayItemArgs, type PayItem } from '@api/hr/compensation';
import { openActionModal, rejectAction, retireAction, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import { usePayComponents, type PayComponent } from '@api/finance/statutory';
import { useStatutoryProfile, useStatutoryProfileMutation, hrStatutoryProfileApi, type CaptureStatutoryProfileArgs } from '@api/hr/statutoryProfile';
import { useHrEmployees, type HrEmployeeRow } from '@api/hr/employees';
import { fmtMoney, fmtDate, humanize, statusTone } from '../Finance/financeShared';
import '../Finance/finance.css';

type Surface = 'items' | 'statutory';

const empName = (e: HrEmployeeRow): string => e.display_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.username || e.id;

export function CompensationOverview(): VNode {
  const [surface, setSurface] = useState<Surface>('items');
  const empsQ = useHrEmployees({ limit: 500 });
  const emps = empsQ.data ?? [];
  const nameOf = useMemo(() => {
    const m = new Map(emps.map(e => [e.id, empName(e)]));
    return (id: string) => m.get(id) ?? id;
  }, [emps]);

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader
        icon="fa-scale-balanced" module="HR · Compensation" title="Compensation"
        sub="Recurring pay items and employee statutory (NIS continuity) profiles — the compensation inputs that feed payroll."
      />

      <div class="obx-viewswitch" style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <button class={`obx-view-btn${surface === 'items' ? ' active' : ''}`} onClick={() => setSurface('items')}>Pay Items</button>
        <button class={`obx-view-btn${surface === 'statutory' ? ' active' : ''}`} onClick={() => setSurface('statutory')}>Statutory Profile</button>
      </div>

      {surface === 'items'
        ? <PayItemsSurface emps={emps} nameOf={nameOf} />
        : <StatutorySurface emps={emps} nameOf={nameOf} />}
    </div>
  );
}

// ── Pay Items ───────────────────────────────────────────────────────────────────

function PayItemsSurface({ emps, nameOf }: { emps: HrEmployeeRow[]; nameOf: (id: string) => string }): VNode {
  const itemsQ = usePayItems();
  const componentsQ = usePayComponents({ activeOnly: true });
  const components = componentsQ.data ?? [];
  const compName = (id: string) => components.find(c => c.id === id)?.name ?? id;
  const payItemRecord = (it: PayItem) => toActionRecord({
    title: compName(it.componentId), subtitle: nameOf(it.employeeId), icon: 'fa-scale-balanced',
    badges: [statusBadge(it.status)],
    fields: [
      { label: 'Amount', value: it.amount != null ? fmtMoney(it.amount) : it.percent != null ? `${it.percent}%` : '—' },
      { label: 'Effective', value: fmtDate(it.effectiveFrom) + (it.effectiveTo ? ` → ${fmtDate(it.effectiveTo)}` : '') },
    ],
  });

  const submitMut  = useCompensationMutation(hrCompensationApi.submitPayItem);
  const approveMut = useCompensationMutation(hrCompensationApi.approvePayItem);
  const rejectMut  = useCompensationMutation(hrCompensationApi.rejectPayItem);
  const retireMut  = useCompensationMutation(hrCompensationApi.retirePayItem);

  const canManage = can('hr.compensation.manage');
  const canApprove = can('hr.compensation.approve');
  const [showForm, setShowForm] = useState(false);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; dialog.success(ok); } catch (e) { dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {canManage && (
        <div class="obx-toolbar" style={{ marginBottom: 10 }}>
          <button class="obx-btn" onClick={() => setShowForm(v => !v)}><i class={`fas ${showForm ? 'fa-xmark' : 'fa-plus'}`} /> {showForm ? 'Cancel' : 'New pay item'}</button>
        </div>
      )}
      {showForm && <NewPayItemForm emps={emps} components={components} onDone={() => setShowForm(false)} />}

      {itemsQ.isLoading && !itemsQ.data ? <div class="obx-empty">Loading…</div>
        : !(itemsQ.data?.length) ? <EmptyState icon="fa-scale-balanced" title="No pay items" text="Add recurring earnings or deductions for employees; they feed the payroll run." />
        : (
          <table class="obx-table">
            <thead><tr><th>Item #</th><th>Employee</th><th>Component</th><th>Amount</th><th>Effective</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>{itemsQ.data.map(it => (
              <tr key={it.id}>
                <td><b>{it.itemNo ?? '—'}</b></td>
                <td class="obx-meta">{nameOf(it.employeeId)}</td>
                <td class="obx-meta">{compName(it.componentId)}</td>
                <td class="obx-meta">{it.amount != null ? fmtMoney(it.amount) : it.percent != null ? `${it.percent}%` : '—'}</td>
                <td class="obx-meta">{fmtDate(it.effectiveFrom)}{it.effectiveTo ? ` → ${fmtDate(it.effectiveTo)}` : ''}</td>
                <td><span class={`obx-pill ${statusTone(it.status)}`}>{humanize(it.status)}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <div class="obx-rowbtns" style={{ justifyContent: 'flex-end' }}>
                    {canManage && it.status === 'draft' && <button class="obx-btn obx-btn-sm" onClick={() => run(submitMut.mutateAsync({ id: it.id }), 'Submitted for approval.')}>Submit</button>}
                    {canApprove && it.status === 'pending_approval' && (
                      <>
                        <button class="obx-btn obx-btn-sm" onClick={() => run(approveMut.mutateAsync({ id: it.id }), 'Approved.')}>Approve</button>
                        <button class="obx-btn obx-btn-sm" onClick={async () => {
                          const res = await openActionModal(rejectAction({ noun: 'pay item', record: payItemRecord(it), whatNext: ['Returns the pay item to draft for correction.'] }));
                          if (!res.confirmed) return;
                          await run(rejectMut.mutateAsync({ id: it.id, reason: res.reason || undefined }), 'Rejected.');
                        }}>Reject</button>
                      </>
                    )}
                    {canManage && (it.status === 'active' || it.status === 'approved') && <button class="obx-btn obx-btn-sm" onClick={async () => {
                      const res = await openActionModal(retireAction({ noun: 'pay item', record: payItemRecord(it), whatNext: ['Stops this recurring earning/deduction on future payroll runs.'] }));
                      if (!res.confirmed) return;
                      void run(retireMut.mutateAsync({ id: it.id }), 'Retired.');
                    }}>Retire</button>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
    </div></div>
  );
}

function NewPayItemForm({ emps, components, onDone }: {
  emps: HrEmployeeRow[]; components: PayComponent[]; onDone: () => void;
}): VNode {
  const createMut = useCompensationMutation(hrCompensationApi.createPayItem);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<{ employeeId: string; componentId: string; mode: 'amount' | 'percent'; value: string; effectiveFrom: string; effectiveTo: string; note: string }>(
    { employeeId: '', componentId: '', mode: 'amount', value: '', effectiveFrom: today, effectiveTo: '', note: '' });

  const submit = async (): Promise<void> => {
    if (!f.employeeId || !f.componentId) { dialog.error('Employee and component are required.'); return; }
    const args: CreatePayItemArgs = {
      employeeId: f.employeeId, componentId: f.componentId,
      amount: f.mode === 'amount' ? Number(f.value) || 0 : null,
      percent: f.mode === 'percent' ? Number(f.value) || 0 : null,
      effectiveFrom: f.effectiveFrom,
      effectiveTo: f.effectiveTo || null,
      note: f.note.trim() || null,
    };
    try { await createMut.mutateAsync(args); dialog.success('Pay item created as draft.'); onDone(); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to create pay item.'); }
  };

  const selectedEmp = emps.find(e => e.id === f.employeeId);
  const comp = components.find(c => c.id === f.componentId);
  // NOTE: effective-date overlap is NOT enforced server-side (see DIALOGS_BACKEND_HARDENING_TODO); client shows no overlap check here.
  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Compensation', title: 'Pay Item Preview', description: 'Preview the component and approval routing.',
    preview: {
      icon: 'PAY', title: comp?.name ?? 'Pay item', subtitle: selectedEmp ? empName(selectedEmp) : 'Select employee',
      badges: comp ? [{ label: humanize(comp.kind), tone: comp.kind === 'earning' ? 'success' : 'warning' }] : [],
    },
    derived: comp ? { title: 'Component', fields: [{ label: 'Taxable', value: comp.isTaxable }, { label: 'Reduces chargeable', value: comp.reducesChargeable }] } : undefined,
    metrics: [{ label: 'Basis', value: f.mode === 'amount' ? 'Fixed amount' : 'Percent', tone: 'info' }, { label: f.mode === 'amount' ? 'Amount' : 'Percent', value: f.value || '—', tone: 'default' }],
    validation: [
      ...(!f.employeeId ? [{ message: 'Select an employee.', tone: 'danger' as const }] : []),
      ...(!f.componentId ? [{ message: 'Select a pay component.', tone: 'danger' as const }] : []),
    ],
    approval: { required: true, risk: 'low', message: 'Created as draft → submit for approval (maker-checker; approver ≠ creator).' },
    whatNext: [
      { label: 'Created as draft', description: 'Submit it for approval; a different approver confirms.' },
      { label: 'Feeds payroll', description: 'Once active, it feeds the next payroll run at the effective date.' },
    ],
  };
  return (
    <EnterpriseFormModal open
      title="New Pay Item"
      subtitle="Add a recurring earning or deduction — routed through maker-checker."
      icon={<i class="fas fa-scale-balanced" />}
      context={context}
      primaryLabel="Create draft"
      loading={createMut.isPending}
      disabled={!f.employeeId || !f.componentId}
      onCancel={onDone}
      onSubmit={() => void submit()}>
      <div class="fin-form-grid">
        <label class="fin-field"><span>Employee</span>
          <select value={f.employeeId} onChange={e => setF(p => ({ ...p, employeeId: (e.currentTarget).value }))}>
            <option value="">— select —</option>
            {emps.map(em => <option value={em.id} key={em.id}>{empName(em)}</option>)}
          </select>
        </label>
        <label class="fin-field"><span>Component</span>
          <select value={f.componentId} onChange={e => setF(p => ({ ...p, componentId: (e.currentTarget).value }))}>
            <option value="">— select —</option>
            {components.map(c => <option value={c.id} key={c.id}>{c.name} ({humanize(c.kind)})</option>)}
          </select>
        </label>
        <label class="fin-field"><span>Basis</span>
          <select value={f.mode} onChange={e => setF(p => ({ ...p, mode: (e.currentTarget).value as 'amount' | 'percent' }))}>
            <option value="amount">Fixed amount</option><option value="percent">Percent of base</option>
          </select>
        </label>
        <label class="fin-field"><span>{f.mode === 'amount' ? 'Amount (TTD)' : 'Percent'}</span><input type="number" step="0.01" value={f.value} onInput={e => setF(p => ({ ...p, value: (e.currentTarget).value }))} /></label>
        <label class="fin-field"><span>Effective from</span><input type="date" value={f.effectiveFrom} onInput={e => setF(p => ({ ...p, effectiveFrom: (e.currentTarget).value }))} /></label>
        <label class="fin-field"><span>Effective to (optional)</span><input type="date" value={f.effectiveTo} onInput={e => setF(p => ({ ...p, effectiveTo: (e.currentTarget).value }))} /></label>
        <label class="fin-field" style={{ gridColumn: '1 / -1' }}><span>Note (optional)</span><input type="text" value={f.note} onInput={e => setF(p => ({ ...p, note: (e.currentTarget).value }))} placeholder="Context for approvers" /></label>
      </div>
    </EnterpriseFormModal>
  );
}

// ── Statutory Profile (HR captures; Finance verifies) ───────────────────────────

const EMPTY_PROFILE: Omit<CaptureStatutoryProfileArgs, 'employeeId'> = {
  nisNumber: '', nisApplicable: true, previousEmployerName: '', previousEmployerEndDate: '',
  openingYtdInsurableEarnings: 0, openingYtdNisEmployee: 0, openingYtdNisEmployer: 0, openingBalanceAsOf: '',
};

function StatutorySurface({ emps, nameOf }: { emps: HrEmployeeRow[]; nameOf: (id: string) => string }): VNode {
  const [employeeId, setEmployeeId] = useState('');
  const profileQ = useStatutoryProfile(employeeId || null);
  const profile = profileQ.data ?? null;
  const captureMut = useStatutoryProfileMutation(hrStatutoryProfileApi.capture);
  const submitMut  = useStatutoryProfileMutation(hrStatutoryProfileApi.submit);
  const canCapture = can('hr.employee.statutory.capture');

  const [f, setF] = useState({ ...EMPTY_PROFILE });
  const [editOpen, setEditOpen] = useState(false);
  const set = (k: keyof typeof f, v: string | number | boolean | null) => setF(prev => ({ ...prev, [k]: v }));

  // When a profile loads, seed the form from it (edit-in-place).
  const loadedFor = profile?.employeeId;
  if (loadedFor === employeeId && profile && f.nisNumber === EMPTY_PROFILE.nisNumber && profile.nisNumber) {
    setF({
      nisNumber: profile.nisNumber ?? '', nisApplicable: profile.nisApplicable,
      previousEmployerName: profile.previousEmployerName ?? '', previousEmployerEndDate: profile.previousEmployerEndDate ?? '',
      openingYtdInsurableEarnings: profile.openingYtdInsurableEarnings, openingYtdNisEmployee: profile.openingYtdNisEmployee,
      openingYtdNisEmployer: profile.openingYtdNisEmployer, openingBalanceAsOf: profile.openingBalanceAsOf ?? '',
    });
  }

  const capture = async (): Promise<void> => {
    if (!employeeId) { dialog.error('Select an employee first.'); return; }
    try {
      await captureMut.mutateAsync({
        employeeId, nisNumber: f.nisNumber?.trim() || null, nisApplicable: f.nisApplicable,
        previousEmployerName: f.previousEmployerName?.trim() || null, previousEmployerEndDate: f.previousEmployerEndDate || null,
        openingYtdInsurableEarnings: Number(f.openingYtdInsurableEarnings) || 0,
        openingYtdNisEmployee: Number(f.openingYtdNisEmployee) || 0,
        openingYtdNisEmployer: Number(f.openingYtdNisEmployer) || 0,
        openingBalanceAsOf: f.openingBalanceAsOf || null,
      });
      dialog.success('Statutory profile saved.');
      setEditOpen(false);
    } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to save profile.'); }
  };
  const submit = async (): Promise<void> => {
    if (!profile?.id) { dialog.error('Save the profile before submitting.'); return; }
    try { await submitMut.mutateAsync({ id: profile.id }); dialog.success('Submitted to Finance for verification.'); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to submit.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Compensation', title: 'Statutory Profile', description: 'HR captures NIS continuity; Finance verifies it.',
    preview: { icon: 'NIS', title: nameOf(employeeId), subtitle: 'NIS continuity profile', badges: profile ? [statusBadge(profile.nisStatus)] : [{ label: 'New', tone: 'muted' }] },
    derived: { title: 'Ownership', fields: [{ label: 'NIS applicable', value: f.nisApplicable }, { label: 'Previous employer', value: f.previousEmployerName || '—' }] },
    approval: { required: false, message: 'HR cannot mark this verified — Finance staff review and a Finance manager verifies.' },
    whatNext: [
      { label: 'Save', description: 'Saves the continuity profile against the employee.' },
      { label: 'Submit to Finance', description: 'Sends it for Finance verification (you cannot self-verify).' },
    ],
  };
  return (
    <div class="obx-section"><div class="obx-section-body">
      <div class="obx-toolbar" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span class="obx-meta">Employee:</span>
        <select class="obx-mini-select" style={{ maxWidth: 260 }} value={employeeId} onChange={e => { setEmployeeId((e.currentTarget).value); setF({ ...EMPTY_PROFILE }); }}>
          <option value="">— select —</option>
          {emps.map(em => <option value={em.id} key={em.id}>{nameOf(em.id)}</option>)}
        </select>
        {profile && <span class={`obx-pill ${statusTone(profile.nisStatus)}`}>{humanize(profile.nisStatus)}</span>}
        {canCapture && employeeId && <button class="obx-btn obx-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setEditOpen(true)}><i class="fas fa-pen" /> Capture / Edit profile</button>}
        {canCapture && profile && (profile.nisStatus === 'pending_verification' || profile.nisStatus === 'not_available') && (
          <button class="obx-btn obx-btn-sm" disabled={submitMut.isPending} onClick={submit}>Submit to Finance</button>
        )}
      </div>

      {!employeeId ? <EmptyState icon="fa-user-shield" title="Select an employee" text="Pick an employee to capture or review their NIS continuity profile." />
        : (
          <table class="obx-table">
            <tbody>
              <tr><td>NIS number</td><td class="obx-meta">{f.nisNumber || '—'}</td></tr>
              <tr><td>NIS applicable</td><td class="obx-meta">{f.nisApplicable ? 'Yes' : 'No'}</td></tr>
              <tr><td>Previous employer</td><td class="obx-meta">{f.previousEmployerName || '—'}{f.previousEmployerEndDate ? ` (to ${f.previousEmployerEndDate})` : ''}</td></tr>
              <tr><td>Opening YTD (insurable / EE / ER)</td><td class="obx-meta">{f.openingYtdInsurableEarnings} / {f.openingYtdNisEmployee} / {f.openingYtdNisEmployer}</td></tr>
              {profile?.verifiedAt && <tr><td>Verified</td><td class="obx-meta">{fmtDate(profile.verifiedAt)}{profile.verificationNote ? ` · ${profile.verificationNote}` : ''}</td></tr>}
            </tbody>
          </table>
        )}

      {editOpen && employeeId && (
        <EnterpriseFormModal open
          title="Statutory Profile"
          subtitle={`NIS continuity for ${nameOf(employeeId)}`}
          icon={<i class="fas fa-user-shield" />}
          context={context}
          primaryLabel="Save profile"
          loading={captureMut.isPending}
          disabled={!canCapture}
          onCancel={() => setEditOpen(false)}
          onSubmit={() => void capture()}>
          <div class="fin-form-grid">
            <label class="fin-field"><span>NIS number</span><input type="text" value={f.nisNumber ?? ''} disabled={!canCapture} onInput={e => set('nisNumber', (e.currentTarget).value)} /></label>
            <label class="fin-field fin-field--check"><input type="checkbox" checked={!!f.nisApplicable} disabled={!canCapture} onChange={e => set('nisApplicable', (e.currentTarget).checked)} /><span>NIS applicable</span></label>
            <label class="fin-field"><span>Previous employer</span><input type="text" value={f.previousEmployerName ?? ''} disabled={!canCapture} onInput={e => set('previousEmployerName', (e.currentTarget).value)} /></label>
            <label class="fin-field"><span>Previous employer end date</span><input type="date" value={f.previousEmployerEndDate ?? ''} disabled={!canCapture} onInput={e => set('previousEmployerEndDate', (e.currentTarget).value)} /></label>
            <label class="fin-field"><span>Opening YTD insurable earnings</span><input type="number" step="0.01" value={f.openingYtdInsurableEarnings} disabled={!canCapture} onInput={e => set('openingYtdInsurableEarnings', Number((e.currentTarget).value))} /></label>
            <label class="fin-field"><span>Opening YTD NIS (employee)</span><input type="number" step="0.01" value={f.openingYtdNisEmployee} disabled={!canCapture} onInput={e => set('openingYtdNisEmployee', Number((e.currentTarget).value))} /></label>
            <label class="fin-field"><span>Opening YTD NIS (employer)</span><input type="number" step="0.01" value={f.openingYtdNisEmployer} disabled={!canCapture} onInput={e => set('openingYtdNisEmployer', Number((e.currentTarget).value))} /></label>
            <label class="fin-field"><span>Opening balance as of</span><input type="date" value={f.openingBalanceAsOf ?? ''} disabled={!canCapture} onInput={e => set('openingBalanceAsOf', (e.currentTarget).value)} /></label>
          </div>
        </EnterpriseFormModal>
      )}
    </div></div>
  );
}
