/**
 * src/components/sections/Finance/StatutoryConfigOverview.tsx
 *
 * Finance ▸ Statutory Configuration (nav id `s-finance-statutory`).
 * Surfaces: Rate Versions · NIS Classes · Pay Components · NIS Verification · Approval History.
 * Reads/writes the real `finance/statutory/*`, `finance/payroll/components/*` and
 * `finance/payroll/nis/*` backends. Statutory rate versions move through a maker-checker
 * lifecycle (draft → pending_approval → approved → active → retired); NIS continuity profiles
 * captured by HR are verified here by Finance. All mutations are permission-gated.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import {
  useStatutoryVersions, useNisClasses, usePayComponents, useStatutoryMutation,
  financeStatutoryApi, type StatutoryVersion, type CreateStatutoryVersionArgs, type PayComponent,
} from '@api/finance/statutory';
import {
  useNisProfiles, usePayrollMutation, financePayrollApi, type NisProfileRow,
} from '@api/finance/payroll';
import { fmtMoney, fmtPercent, fmtDate, humanize, statusTone } from './financeShared';
import { openActionModal, rejectAction, retireAction, verifyAction, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import './finance.css';

type Surface = 'versions' | 'nis' | 'components' | 'verify' | 'history';

const SURFACES: { id: Surface; label: string }[] = [
  { id: 'versions',   label: 'Rate Versions' },
  { id: 'nis',        label: 'NIS Classes' },
  { id: 'components',  label: 'Pay Components' },
  { id: 'verify',     label: 'NIS Verification' },
  { id: 'history',    label: 'Approval History' },
];

const num = (v: string): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function versionRecord(v: StatutoryVersion) {
  return toActionRecord({
    title: v.label, subtitle: `Effective ${fmtDate(v.effectiveFrom)}`, icon: 'fa-file-shield',
    badges: [statusBadge(v.status)],
    fields: [
      { label: 'PAYE band 1 / 2', value: `${fmtPercent(v.payeBand1Rate)} / ${fmtPercent(v.payeBand2Rate)}` },
      { label: 'HS threshold', value: `${fmtMoney(v.hsMonthlyThreshold)}/mo` },
    ],
  });
}

export function StatutoryConfigOverview(): VNode {
  const [surface, setSurface] = useState<Surface>('versions');

  const versionsQ = useStatutoryVersions();
  const componentsQ = usePayComponents({ activeOnly: false });
  const versions = versionsQ.data ?? [];
  const active = versions.find(v => v.isActive) ?? null;
  const pending = versions.filter(v => v.status === 'pending_approval').length;

  const canManage  = can('finance.statutory.manage');
  const canApprove = can('finance.statutory.approve');

  const STAT_ROW = [
    { label: 'Rate versions',    val: versions.length },
    { label: 'Active version',   val: active ? active.label : '—' },
    { label: 'Pending approval', val: pending },
    { label: 'Pay components',   val: componentsQ.data?.length ?? 0 },
  ];

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader
        icon="fa-file-shield" module="Finance · Statutory" title="Statutory Configuration"
        sub="NIS, PAYE and Health Surcharge rate versions, the pay-component catalogue, and NIS continuity verification."
      />

      <div class="obx-repstats" style={{ margin: '4px 0 12px' }}>
        {STAT_ROW.map(s => (
          <div class="obx-repstat" key={s.label}>
            <div class="obx-repstat-val">{s.val}</div>
            <div class="obx-repstat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div class="obx-viewswitch" style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        {SURFACES.map(s => (
          <button key={s.id} class={`obx-view-btn${surface === s.id ? ' active' : ''}`} onClick={() => setSurface(s.id)}>{s.label}</button>
        ))}
      </div>

      {surface === 'versions'   && <VersionsSurface versions={versions} loading={versionsQ.isLoading} canManage={canManage} canApprove={canApprove} />}
      {surface === 'nis'        && <NisClassesSurface versions={versions} canManage={canManage} />}
      {surface === 'components'  && <ComponentsSurface canManage={canManage} />}
      {surface === 'verify'     && <VerifySurface />}
      {surface === 'history'    && <HistorySurface />}
    </div>
  );
}

// ── Rate Versions ───────────────────────────────────────────────────────────────

function VersionsSurface({ versions, loading, canManage, canApprove }: {
  versions: StatutoryVersion[]; loading: boolean; canManage: boolean; canApprove: boolean;
}): VNode {
  const [showForm, setShowForm] = useState(false);
  const submitMut   = useStatutoryMutation(financeStatutoryApi.submitVersion);
  const approveMut  = useStatutoryMutation(financeStatutoryApi.approveVersion);
  const rejectMut   = useStatutoryMutation(financeStatutoryApi.rejectVersion);
  const activateMut = useStatutoryMutation(financeStatutoryApi.activateVersion);
  const retireMut   = useStatutoryMutation(financeStatutoryApi.retireVersion);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; dialog.success(ok); } catch (e) { dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {canManage && (
        <div class="obx-toolbar" style={{ marginBottom: 10 }}>
          <button class="obx-btn" onClick={() => setShowForm(v => !v)}>
            <i class={`fas ${showForm ? 'fa-xmark' : 'fa-plus'}`} /> {showForm ? 'Cancel' : 'New rate version'}
          </button>
        </div>
      )}

      {showForm && <NewVersionForm onDone={() => setShowForm(false)} />}

      {loading ? <div class="obx-empty">Loading…</div>
        : !versions.length ? <EmptyState icon="fa-file-shield" title="No statutory versions" text="Create the first NIS / PAYE / Health Surcharge rate version to begin." />
        : (
          <table class="obx-table">
            <thead><tr>
              <th>Effective</th><th>Label</th><th>PAYE allowance</th><th>Band 1 / Band 2</th>
              <th>HS threshold</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th>
            </tr></thead>
            <tbody>{versions.map(v => (
              <tr key={v.id}>
                <td><b>{fmtDate(v.effectiveFrom)}</b></td>
                <td>{v.label}{v.isActive && <span class="obx-pill green" style={{ marginLeft: 6 }}>active</span>}</td>
                <td class="obx-meta">{fmtMoney(v.payePersonalAllowance)}</td>
                <td class="obx-meta">{fmtPercent(v.payeBand1Rate)} / {fmtPercent(v.payeBand2Rate)}</td>
                <td class="obx-meta">{fmtMoney(v.hsMonthlyThreshold)}/mo</td>
                <td><span class={`obx-pill ${statusTone(v.status)}`}>{humanize(v.status)}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <div class="obx-rowbtns" style={{ justifyContent: 'flex-end' }}>
                    {canManage && v.status === 'draft' && (
                      <button class="obx-btn obx-btn-sm" onClick={() => run(submitMut.mutateAsync({ id: v.id }), 'Submitted for approval.')}>Submit</button>
                    )}
                    {canApprove && v.status === 'pending_approval' && (
                      <>
                        <button class="obx-btn obx-btn-sm" onClick={() => run(approveMut.mutateAsync({ id: v.id }), 'Approved.')}>Approve</button>
                        <button class="obx-btn obx-btn-sm" onClick={async () => {
                          const res = await openActionModal(rejectAction({ noun: 'rate version', record: versionRecord(v), whatNext: ['The version returns to draft for correction.'] }));
                          if (!res.confirmed) return;
                          await run(rejectMut.mutateAsync({ id: v.id, reason: res.reason || undefined }), 'Rejected.');
                        }}>Reject</button>
                      </>
                    )}
                    {canApprove && v.status === 'approved' && (
                      <button class="obx-btn obx-btn-sm" onClick={async () => {
                        const res = await openActionModal({ title: 'Activate version', icon: 'fa-toggle-on', tone: 'warning', record: versionRecord(v), warning: 'The current active version will be retired.', whatNext: ['This becomes the active statutory version applied to every new payroll run.'], confirmLabel: 'Activate' });
                        if (!res.confirmed) return;
                        await run(activateMut.mutateAsync({ id: v.id }), 'Version activated.');
                      }}>Activate</button>
                    )}
                    {canManage && v.status === 'active' && (
                      <button class="obx-btn obx-btn-sm" onClick={async () => {
                        const res = await openActionModal({ title: 'Retire version', icon: 'fa-power-off', tone: 'danger', record: versionRecord(v), warning: 'Payroll will have no active statutory version until another is activated.', confirmLabel: 'Retire' });
                        if (!res.confirmed) return;
                        await run(retireMut.mutateAsync({ id: v.id }), 'Version retired.');
                      }}>Retire</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
    </div></div>
  );
}

const EMPTY_VERSION: CreateStatutoryVersionArgs = {
  effectiveFrom: '', label: '',
  payePersonalAllowance: 0, payeBand1Ceiling: 0, payeBand1Rate: 0, payeBand2Rate: 0,
  hsMonthlyThreshold: 0, hsWeeklyHigh: 0, hsWeeklyLow: 0, nisMonthyCeiling: null,
};

function NewVersionForm({ onDone }: { onDone: () => void }): VNode {
  const [f, setF] = useState<CreateStatutoryVersionArgs>({ ...EMPTY_VERSION });
  const createMut = useStatutoryMutation(financeStatutoryApi.createVersion);
  const set = (k: keyof CreateStatutoryVersionArgs, v: string | number | null) => setF(prev => ({ ...prev, [k]: v }));

  const submit = async (): Promise<void> => {
    if (!f.effectiveFrom || !f.label.trim()) { dialog.error('Effective date and label are required.'); return; }
    try {
      await createMut.mutateAsync({ ...f, label: f.label.trim() });
      dialog.success('Rate version created as draft.');
      onDone();
    } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to create version.'); }
  };

  const rateWarn = f.payeBand1Rate > 1 || f.payeBand2Rate > 1;
  const context: DialogContextPanelConfig = {
    eyebrow: 'Finance · Statutory', title: 'Rate Version Preview', description: 'Review the statutory rates before creating the draft.',
    preview: {
      icon: 'STA', title: f.label.trim() || 'Rate version', subtitle: f.effectiveFrom ? `Effective ${f.effectiveFrom}` : 'Set effective date',
      badges: [{ label: 'Draft', tone: 'muted' }],
    },
    derived: {
      title: 'Rates', fields: [
        { label: 'PAYE band 1 / 2', value: `${fmtPercent(f.payeBand1Rate)} / ${fmtPercent(f.payeBand2Rate)}` },
        { label: 'PAYE allowance', value: fmtMoney(f.payePersonalAllowance) },
        { label: 'HS threshold', value: `${fmtMoney(f.hsMonthlyThreshold)}/mo` },
      ],
    },
    validation: [
      ...(!f.effectiveFrom ? [{ message: 'Effective date is required.', tone: 'danger' as const }] : []),
      ...(!f.label.trim() ? [{ message: 'Label is required.', tone: 'danger' as const }] : []),
      ...(rateWarn ? [{ message: 'PAYE rates are fractions (0.25 = 25%); a value > 1 looks wrong.', tone: 'warning' as const }] : []),
    ],
    approval: { required: true, risk: 'medium', message: 'Created as draft → submit → approve (a second finance_manager must approve).' },
    whatNext: [
      { label: 'Maker-checker', description: 'Submit for approval; a different finance_manager approves.' },
      { label: 'Activate', description: 'Activating makes it the live statutory version (retires the current one).' },
    ],
  };
  return (
    <EnterpriseFormModal open
      title="New Rate Version"
      subtitle="Define NIS / PAYE / Health Surcharge rates — routed through maker-checker."
      icon={<i class="fas fa-file-shield" />}
      context={context}
      primaryLabel="Create draft"
      loading={createMut.isPending}
      disabled={!f.effectiveFrom || !f.label.trim()}
      onCancel={onDone}
      onSubmit={() => void submit()}>
      <div class="fin-form-grid">
        <label class="fin-field"><span>Effective from</span><input type="date" value={f.effectiveFrom} onInput={e => set('effectiveFrom', (e.currentTarget as HTMLInputElement).value)} /></label>
        <label class="fin-field"><span>Label</span><input type="text" placeholder="e.g. TT 2026 Statutory" value={f.label} onInput={e => set('label', (e.currentTarget as HTMLInputElement).value)} /></label>
        <label class="fin-field"><span>PAYE personal allowance (annual)</span><input type="number" step="0.01" value={f.payePersonalAllowance} onInput={e => set('payePersonalAllowance', num((e.currentTarget as HTMLInputElement).value))} /></label>
        <label class="fin-field"><span>PAYE band-1 ceiling (annual)</span><input type="number" step="0.01" value={f.payeBand1Ceiling} onInput={e => set('payeBand1Ceiling', num((e.currentTarget as HTMLInputElement).value))} /></label>
        <label class="fin-field"><span>Band-1 rate (fraction, 0.25 = 25%)</span><input type="number" step="0.001" value={f.payeBand1Rate} onInput={e => set('payeBand1Rate', num((e.currentTarget as HTMLInputElement).value))} /></label>
        <label class="fin-field"><span>Band-2 rate (fraction)</span><input type="number" step="0.001" value={f.payeBand2Rate} onInput={e => set('payeBand2Rate', num((e.currentTarget as HTMLInputElement).value))} /></label>
        <label class="fin-field"><span>HS monthly threshold</span><input type="number" step="0.01" value={f.hsMonthlyThreshold} onInput={e => set('hsMonthlyThreshold', num((e.currentTarget as HTMLInputElement).value))} /></label>
        <label class="fin-field"><span>HS weekly (high)</span><input type="number" step="0.01" value={f.hsWeeklyHigh} onInput={e => set('hsWeeklyHigh', num((e.currentTarget as HTMLInputElement).value))} /></label>
        <label class="fin-field"><span>HS weekly (low)</span><input type="number" step="0.01" value={f.hsWeeklyLow} onInput={e => set('hsWeeklyLow', num((e.currentTarget as HTMLInputElement).value))} /></label>
        <label class="fin-field"><span>NIS monthly ceiling (optional)</span><input type="number" step="0.01" value={f.nisMonthyCeiling ?? ''} onInput={e => { const v = (e.currentTarget as HTMLInputElement).value; set('nisMonthyCeiling', v === '' ? null : num(v)); }} /></label>
      </div>
    </EnterpriseFormModal>
  );
}

// ── NIS Classes ─────────────────────────────────────────────────────────────────

function NisClassesSurface({ versions, canManage }: { versions: StatutoryVersion[]; canManage: boolean }): VNode {
  const [versionId, setVersionId] = useState<string>(() => versions.find(v => v.isActive)?.id ?? versions[0]?.id ?? '');
  const effectiveId = versionId || (versions.find(v => v.isActive)?.id ?? versions[0]?.id ?? '');
  const classesQ = useNisClasses(effectiveId || null);
  const upsertMut = useStatutoryMutation(financeStatutoryApi.upsertNisClass);
  const editable = canManage && versions.find(v => v.id === effectiveId)?.status === 'draft';

  const [row, setRow] = useState({ classNo: '', weeklyMin: '', weeklyMax: '', employeeWeekly: '', employerWeekly: '' });
  const [formOpen, setFormOpen] = useState(false);
  const submit = async (): Promise<void> => {
    if (!effectiveId) { dialog.error('Select a version first.'); return; }
    try {
      await upsertMut.mutateAsync({
        statutoryVersionId: effectiveId,
        classNo: num(row.classNo), weeklyMin: num(row.weeklyMin),
        weeklyMax: row.weeklyMax === '' ? null : num(row.weeklyMax),
        employeeWeekly: num(row.employeeWeekly), employerWeekly: num(row.employerWeekly),
      });
      dialog.success('NIS class saved.');
      setRow({ classNo: '', weeklyMin: '', weeklyMax: '', employeeWeekly: '', employerWeekly: '' });
      setFormOpen(false);
    } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to save class.'); }
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      <div class="obx-toolbar" style={{ marginBottom: 10, gap: 8, display: 'flex', alignItems: 'center' }}>
        <span class="obx-meta">Version:</span>
        <select class="obx-mini-select" value={effectiveId} onChange={e => setVersionId((e.currentTarget as HTMLSelectElement).value)}>
          {versions.map(v => <option value={v.id} key={v.id}>{v.label} · {humanize(v.status)}</option>)}
        </select>
        {editable && <span class="obx-pill amber">draft — editable</span>}
        {editable && <button class="obx-btn obx-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setFormOpen(true)}><i class="fas fa-plus" /> Add / update class</button>}
      </div>

      {classesQ.isLoading ? <div class="obx-empty">Loading…</div>
        : !(classesQ.data?.length) ? <EmptyState icon="fa-layer-group" title="No NIS classes" text="This version has no NIS class bands yet." />
        : (
          <table class="obx-table">
            <thead><tr><th>Class</th><th>Weekly min</th><th>Weekly max</th><th>Employee/wk</th><th>Employer/wk</th></tr></thead>
            <tbody>{classesQ.data.map(c => (
              <tr key={c.id}>
                <td><b>{c.classNo}</b></td>
                <td class="obx-meta">{fmtMoney(c.weeklyMin)}</td>
                <td class="obx-meta">{c.weeklyMax == null ? '—' : fmtMoney(c.weeklyMax)}</td>
                <td class="obx-meta">{fmtMoney(c.employeeWeekly)}</td>
                <td class="obx-meta">{fmtMoney(c.employerWeekly)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}

      {formOpen && editable && (
        <EnterpriseFormModal open
          title="NIS Class"
          subtitle="Add or update a weekly NIS band for this draft version."
          icon={<i class="fas fa-layer-group" />}
          context={{
            eyebrow: 'Finance · Statutory', title: 'NIS Band Preview', description: 'Weekly earnings band and contribution split.',
            preview: { icon: 'NIS', title: `Class ${row.classNo || '?'}`, subtitle: 'Weekly NIS band' },
            metrics: [{ label: 'Employee / wk', value: row.employeeWeekly || '—', tone: 'info' }, { label: 'Employer / wk', value: row.employerWeekly || '—', tone: 'default' }],
            validation: [...(!row.classNo ? [{ message: 'Class number is required.', tone: 'danger' as const }] : [])],
            whatNext: [{ label: 'Upserts the band', description: 'Adds or updates the NIS class for this draft version.' }],
          }}
          primaryLabel="Save class"
          loading={upsertMut.isPending}
          disabled={!row.classNo}
          onCancel={() => setFormOpen(false)}
          onSubmit={() => void submit()}>
          <div class="fin-form-grid fin-form-grid--tight">
            <label class="fin-field"><span>Class #</span><input type="number" value={row.classNo} onInput={e => setRow(r => ({ ...r, classNo: (e.currentTarget as HTMLInputElement).value }))} /></label>
            <label class="fin-field"><span>Weekly min</span><input type="number" step="0.01" value={row.weeklyMin} onInput={e => setRow(r => ({ ...r, weeklyMin: (e.currentTarget as HTMLInputElement).value }))} /></label>
            <label class="fin-field"><span>Weekly max (blank = top)</span><input type="number" step="0.01" value={row.weeklyMax} onInput={e => setRow(r => ({ ...r, weeklyMax: (e.currentTarget as HTMLInputElement).value }))} /></label>
            <label class="fin-field"><span>Employee / wk</span><input type="number" step="0.01" value={row.employeeWeekly} onInput={e => setRow(r => ({ ...r, employeeWeekly: (e.currentTarget as HTMLInputElement).value }))} /></label>
            <label class="fin-field"><span>Employer / wk</span><input type="number" step="0.01" value={row.employerWeekly} onInput={e => setRow(r => ({ ...r, employerWeekly: (e.currentTarget as HTMLInputElement).value }))} /></label>
          </div>
        </EnterpriseFormModal>
      )}
    </div></div>
  );
}

// ── Pay Components ──────────────────────────────────────────────────────────────

function ComponentsSurface({ canManage }: { canManage: boolean }): VNode {
  const componentsQ = usePayComponents({ activeOnly: false });
  const createMut = useStatutoryMutation(financeStatutoryApi.createComponent);
  const retireMut = useStatutoryMutation(financeStatutoryApi.retireComponent);
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ code: '', name: '', kind: 'earning' as 'earning' | 'deduction', isTaxable: true, reducesChargeable: false });

  const create = async (): Promise<void> => {
    if (!f.code.trim() || !f.name.trim()) { dialog.error('Code and name are required.'); return; }
    try {
      await createMut.mutateAsync({ code: f.code.trim().toUpperCase(), name: f.name.trim(), kind: f.kind, isTaxable: f.isTaxable, reducesChargeable: f.reducesChargeable });
      dialog.success('Pay component created.');
      setShowForm(false); setF({ code: '', name: '', kind: 'earning', isTaxable: true, reducesChargeable: false });
    } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to create component.'); }
  };
  const retire = async (c: PayComponent): Promise<void> => {
    const res = await openActionModal(retireAction({
      noun: 'pay component',
      record: toActionRecord({ title: c.name, subtitle: c.code, icon: 'fa-list', badges: [statusBadge(c.isActive ? 'active' : 'retired')], fields: [{ label: 'Kind', value: humanize(c.kind) }, { label: 'Taxable', value: c.isTaxable }] }),
      whatNext: ['It can no longer be added to new pay items. Existing usage is unaffected.'],
    }));
    if (!res.confirmed) return;
    try { await retireMut.mutateAsync({ id: c.id }); dialog.success('Component retired.'); } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed.'); }
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {canManage && (
        <div class="obx-toolbar" style={{ marginBottom: 10 }}>
          <button class="obx-btn" onClick={() => setShowForm(v => !v)}><i class={`fas ${showForm ? 'fa-xmark' : 'fa-plus'}`} /> {showForm ? 'Cancel' : 'New component'}</button>
        </div>
      )}
      {showForm && (
        <EnterpriseFormModal open
          title="New Pay Component"
          subtitle="Add an earning or deduction to the Finance-owned catalogue."
          icon={<i class="fas fa-list" />}
          context={{
            eyebrow: 'Finance · Statutory', title: 'Component Preview', description: 'Preview the tax treatment.',
            preview: { icon: 'CMP', title: f.name.trim() || 'Component', subtitle: f.code.trim().toUpperCase() || 'Set code', badges: [{ label: humanize(f.kind), tone: f.kind === 'earning' ? 'success' : 'warning' }] },
            derived: { title: 'Treatment', fields: [{ label: 'Taxable', value: f.isTaxable }, { label: 'Reduces chargeable', value: f.reducesChargeable }] },
            validation: [
              ...(!f.code.trim() ? [{ message: 'Code is required.', tone: 'danger' as const }] : []),
              ...(!f.name.trim() ? [{ message: 'Name is required.', tone: 'danger' as const }] : []),
            ],
            whatNext: [
              { label: 'Available to HR', description: 'HR can add it to employee pay items.' },
              { label: 'Unique code', description: 'The component code must be unique (enforced server-side).' },
            ],
          }}
          primaryLabel="Create component"
          loading={createMut.isPending}
          disabled={!f.code.trim() || !f.name.trim()}
          onCancel={() => setShowForm(false)}
          onSubmit={() => void create()}>
          <div class="fin-form-grid fin-form-grid--tight">
            <label class="fin-field"><span>Code</span><input type="text" value={f.code} onInput={e => setF(p => ({ ...p, code: (e.currentTarget as HTMLInputElement).value }))} /></label>
            <label class="fin-field"><span>Name</span><input type="text" value={f.name} onInput={e => setF(p => ({ ...p, name: (e.currentTarget as HTMLInputElement).value }))} /></label>
            <label class="fin-field"><span>Kind</span>
              <select value={f.kind} onChange={e => setF(p => ({ ...p, kind: (e.currentTarget as HTMLSelectElement).value as 'earning' | 'deduction' }))}>
                <option value="earning">Earning</option><option value="deduction">Deduction</option>
              </select>
            </label>
            <label class="fin-field fin-field--check"><input type="checkbox" checked={f.isTaxable} onChange={e => setF(p => ({ ...p, isTaxable: (e.currentTarget as HTMLInputElement).checked }))} /><span>Taxable</span></label>
            <label class="fin-field fin-field--check"><input type="checkbox" checked={f.reducesChargeable} onChange={e => setF(p => ({ ...p, reducesChargeable: (e.currentTarget as HTMLInputElement).checked }))} /><span>Reduces chargeable income</span></label>
          </div>
        </EnterpriseFormModal>
      )}

      {componentsQ.isLoading ? <div class="obx-empty">Loading…</div>
        : !(componentsQ.data?.length) ? <EmptyState icon="fa-list" title="No pay components" text="The pay-component catalogue is empty." />
        : (
          <table class="obx-table">
            <thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Taxable</th><th>Statutory</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>{componentsQ.data.map(c => (
              <tr key={c.id}>
                <td><b>{c.code}</b></td>
                <td>{c.name}</td>
                <td class="obx-meta">{humanize(c.kind)}</td>
                <td class="obx-meta">{c.isTaxable ? 'Yes' : 'No'}</td>
                <td class="obx-meta">{c.isStatutory ? 'Yes' : 'No'}</td>
                <td><span class={`obx-pill ${c.isActive ? 'green' : 'gray'}`}>{c.isActive ? 'active' : 'retired'}</span></td>
                <td style={{ textAlign: 'right' }}>
                  {canManage && c.isActive && !c.isStatutory && (
                    <button class="obx-btn obx-btn-sm" onClick={() => retire(c)}>Retire</button>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
    </div></div>
  );
}

// ── NIS Verification (Finance verifies HR-captured continuity) ──────────────────

function VerifySurface(): VNode {
  const profilesQ = useNisProfiles({ status: 'pending_verification' });
  const verifyMut = usePayrollMutation(financePayrollApi.verifyNisProfile);
  const rejectMut = usePayrollMutation(financePayrollApi.rejectNisProfile);
  const canVerify = can('finance.payroll.nis.verify');

  const val = (r: NisProfileRow, k: string): string => {
    const v = r[k];
    return v == null || v === '' ? '—' : String(v);
  };

  const nisRecord = (r: NisProfileRow) => toActionRecord({
    title: 'NIS continuity profile', icon: 'fa-user-shield',
    subtitle: val(r, 'employeeId') !== '—' ? val(r, 'employeeId') : val(r, 'employee_id'),
    fields: [
      { label: 'NIS #', value: val(r, 'nisNumber') !== '—' ? val(r, 'nisNumber') : val(r, 'nis_number') },
      { label: 'Previous employer', value: val(r, 'previousEmployerName') !== '—' ? val(r, 'previousEmployerName') : val(r, 'previous_employer_name') },
      { label: 'Opening YTD (EE)', value: val(r, 'openingYtdNisEmployee') !== '—' ? val(r, 'openingYtdNisEmployee') : val(r, 'opening_ytd_nis_employee') },
    ],
  });
  const verify = async (r: NisProfileRow): Promise<void> => {
    const id = String(r['id'] ?? '');
    const res = await openActionModal(verifyAction({ noun: 'NIS profile', record: nisRecord(r), whatNext: ['Verifying unlocks payroll continuity for this employee.'] }));
    if (!res.confirmed) return;
    try { await verifyMut.mutateAsync({ id, verificationNote: res.reason || null }); dialog.success('NIS profile verified.'); } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed.'); }
  };
  const reject = async (r: NisProfileRow): Promise<void> => {
    const id = String(r['id'] ?? '');
    const res = await openActionModal(rejectAction({ noun: 'NIS profile', title: 'Reject NIS profile', record: nisRecord(r), whatNext: ['The profile is sent back to HR for correction.'] }));
    if (!res.confirmed) return;
    try { await rejectMut.mutateAsync({ id, reason: res.reason || undefined }); dialog.success('Profile returned to HR.'); } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed.'); }
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {profilesQ.isLoading ? <div class="obx-empty">Loading…</div>
        : !(profilesQ.data?.length) ? <EmptyState icon="fa-user-shield" title="Nothing to verify" text="No NIS continuity profiles are awaiting Finance verification." />
        : (
          <table class="obx-table">
            <thead><tr><th>Employee</th><th>NIS #</th><th>Previous employer</th><th>Opening YTD (EE)</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>{profilesQ.data.map((r, i) => {
              const id = String(r['id'] ?? '');
              return (
                <tr key={id || i}>
                  <td class="obx-meta">{val(r, 'employeeId') !== '—' ? val(r, 'employeeId') : val(r, 'employee_id')}</td>
                  <td class="obx-meta">{val(r, 'nisNumber') !== '—' ? val(r, 'nisNumber') : val(r, 'nis_number')}</td>
                  <td class="obx-meta">{val(r, 'previousEmployerName') !== '—' ? val(r, 'previousEmployerName') : val(r, 'previous_employer_name')}</td>
                  <td class="obx-meta">{val(r, 'openingYtdNisEmployee') !== '—' ? val(r, 'openingYtdNisEmployee') : val(r, 'opening_ytd_nis_employee')}</td>
                  <td><span class={`obx-pill ${statusTone(String(r['nisStatus'] ?? r['nis_status'] ?? 'pending_verification'))}`}>{humanize(String(r['nisStatus'] ?? r['nis_status'] ?? 'pending'))}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    {canVerify && id && (
                      <div class="obx-rowbtns" style={{ justifyContent: 'flex-end' }}>
                        <button class="obx-btn obx-btn-sm" onClick={() => verify(r)}>Verify</button>
                        <button class="obx-btn obx-btn-sm" onClick={() => reject(r)}>Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
    </div></div>
  );
}

// ── Approval History ────────────────────────────────────────────────────────────

function HistorySurface(): VNode {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    try { const r = await financeStatutoryApi.listReports({}); setRows(r as Array<Record<string, unknown>>); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to load history.'); }
    finally { setLoading(false); setLoaded(true); }
  };
  if (!loaded && !loading) void load();

  const cols = rows && rows.length ? Object.keys(rows[0]!) : [];
  return (
    <div class="obx-section"><div class="obx-section-body">
      {loading ? <div class="obx-empty">Loading…</div>
        : !rows || !rows.length ? <EmptyState icon="fa-clock-rotate-left" title="No approval history" text="Statutory version approvals will appear here." />
        : (
          <table class="obx-table">
            <thead><tr>{cols.map(c => <th key={c}>{humanize(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>{cols.map(c => <td class="obx-meta" key={c}>{r[c] == null ? '—' : String(r[c])}</td>)}</tr>
            ))}</tbody>
          </table>
        )}
    </div></div>
  );
}
