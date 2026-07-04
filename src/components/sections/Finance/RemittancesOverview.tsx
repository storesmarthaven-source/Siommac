/**
 * src/components/sections/Finance/RemittancesOverview.tsx
 *
 * Finance ▸ Statutory Remittances & Filing (nav id `s-finance-remittances`).
 * Surfaces: Remittances register · Compute & Create · Filing Reports.
 *
 * Lifecycle: draft → submitted → approved → paid → filed (also cancellable).
 * Maker-checker: creator ≠ approver (enforced server-side; SoD).
 * All mutations are permission-gated.
 *
 * T&T authorities: PAYE/BIR, NIS/NIBTT, Health Surcharge.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import {
  useRemittances,
  useComputedRemittance,
  useRemittanceMutation,
  financeRemittancesApi,
  type Remittance,
  type RemittanceAuthority,
} from '@api/finance/remittances';
import { fmtMoney, fmtDate, humanize, statusTone } from './financeShared';
import { openActionModal, cancelAction, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import './finance.css';

type Surface = 'register' | 'create' | 'reports';

const SURFACES: { id: Surface; label: string }[] = [
  { id: 'register', label: 'Remittances' },
  { id: 'create',   label: 'Compute & Create' },
  { id: 'reports',  label: 'Filing Reports' },
];

const AUTHORITIES: { value: RemittanceAuthority; label: string }[] = [
  { value: 'paye_bir',        label: 'PAYE / BIR' },
  { value: 'nis_nibtt',       label: 'NIS / NIBTT' },
  { value: 'health_surcharge',label: 'Health Surcharge' },
];

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function authorityLabel(a: string): string {
  return AUTHORITIES.find(x => x.value === a)?.label ?? humanize(a);
}

function remittanceRecord(r: Remittance) {
  return toActionRecord({
    title:    r.remittanceNo,
    subtitle: `${authorityLabel(r.authority)} · ${MONTHS[(r.periodMonth - 1) % 12]} ${r.periodYear}`,
    icon:     'fa-file-invoice-dollar',
    badges:   [statusBadge(r.status)],
    fields: [
      { label: 'Total due', value: fmtMoney(r.totalDue) },
      { label: 'Authority', value: authorityLabel(r.authority) },
    ],
  });
}

export function RemittancesOverview(): VNode {
  const [surface, setSurface] = useState<Surface>('register');

  const remittancesQ = useRemittances();
  const remittances = remittancesQ.data ?? [];

  const total      = remittances.length;
  const pending    = remittances.filter(r => r.status === 'submitted').length;
  const approved   = remittances.filter(r => r.status === 'approved').length;
  const totalDue   = remittances.filter(r => !['cancelled', 'filed'].includes(r.status))
    .reduce((s, r) => s + r.totalDue, 0);

  const canManage  = can('finance.remittances.manage');
  const canApprove = can('finance.remittances.approve');

  const STAT_ROW = [
    { label: 'Total remittances', val: total },
    { label: 'Pending approval',  val: pending },
    { label: 'Approved / ready',  val: approved },
    { label: 'Outstanding dues',  val: fmtMoney(totalDue) },
  ];

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader
        icon="fa-file-invoice-dollar"
        module="Finance · Remittances"
        title="Statutory Remittances & Filing"
        sub="PAYE/BIR, NIS/NIBTT and Health Surcharge remittances derived from approved payroll runs."
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
          <button key={s.id} class={`obx-view-btn${surface === s.id ? ' active' : ''}`} onClick={() => setSurface(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {surface === 'register' && (
        <RegisterSurface
          remittances={remittances}
          loading={remittancesQ.isLoading}
          canManage={canManage}
          canApprove={canApprove}
        />
      )}
      {surface === 'create'   && <CreateSurface canManage={canManage} />}
      {surface === 'reports'  && <ReportsSurface />}
    </div>
  );
}

// ── Register ────────────────────────────────────────────────────────────────────

function RegisterSurface({ remittances, loading, canManage, canApprove }: {
  remittances: Remittance[];
  loading: boolean;
  canManage: boolean;
  canApprove: boolean;
}): VNode {
  const submitMut   = useRemittanceMutation(financeRemittancesApi.submit);
  const approveMut  = useRemittanceMutation(financeRemittancesApi.approve);
  const markPaidMut = useRemittanceMutation(financeRemittancesApi.markPaid);
  const markFiledMut= useRemittanceMutation(financeRemittancesApi.markFiled);
  const cancelMut   = useRemittanceMutation(financeRemittancesApi.cancel);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; dialog.success(ok); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {loading ? <div class="obx-empty">Loading…</div>
        : !remittances.length ? (
          <EmptyState
            icon="fa-file-invoice-dollar"
            title="No remittances yet"
            text="Use Compute & Create to derive remittances from an approved payroll run."
          />
        ) : (
          <table class="obx-table">
            <thead><tr>
              <th>Ref</th><th>Period</th><th>Authority</th><th>Employee</th>
              <th>Employer</th><th>Total due</th><th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr></thead>
            <tbody>{remittances.map(r => (
              <tr key={r.id}>
                <td><b>{r.remittanceNo}</b></td>
                <td class="obx-meta">{MONTHS[(r.periodMonth - 1) % 12]} {r.periodYear}</td>
                <td class="obx-meta">{authorityLabel(r.authority)}</td>
                <td class="obx-meta">{fmtMoney(r.employeePortion)}</td>
                <td class="obx-meta">{fmtMoney(r.employerPortion)}</td>
                <td><b>{fmtMoney(r.totalDue)}</b></td>
                <td><span class={`obx-pill ${statusTone(r.status)}`}>{humanize(r.status)}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <div class="obx-rowbtns" style={{ justifyContent: 'flex-end' }}>
                    {canManage && r.status === 'draft' && (
                      <>
                        <button class="obx-btn obx-btn-sm" onClick={() => run(submitMut.mutateAsync({ id: r.id }), 'Submitted for approval.')}>Submit</button>
                        <button class="obx-btn obx-btn-sm" onClick={async () => {
                          const res = await openActionModal(cancelAction({
                            noun: 'remittance',
                            record: remittanceRecord(r),
                            whatNext: ['The remittance is cancelled and no longer tracked.'],
                          }));
                          if (!res.confirmed) return;
                          await run(cancelMut.mutateAsync({ id: r.id, reason: res.reason || 'Cancelled.' }), 'Cancelled.');
                        }}>Cancel</button>
                      </>
                    )}
                    {canApprove && r.status === 'submitted' && (
                      <>
                        <button class="obx-btn obx-btn-sm" onClick={() => run(approveMut.mutateAsync({ id: r.id }), 'Approved.')}>Approve</button>
                        <button class="obx-btn obx-btn-sm" onClick={async () => {
                          const res = await openActionModal(cancelAction({
                            noun: 'remittance',
                            title: 'Return remittance',
                            record: remittanceRecord(r),
                            whatNext: ['The remittance is returned to draft for correction.'],
                          }));
                          if (!res.confirmed) return;
                          await run(cancelMut.mutateAsync({ id: r.id, reason: res.reason || 'Returned.' }), 'Returned to draft.');
                        }}>Return</button>
                      </>
                    )}
                    {canApprove && r.status === 'approved' && (
                      <MarkPaidButton remittance={r} markPaidMut={markPaidMut} />
                    )}
                    {canApprove && r.status === 'paid' && (
                      <button class="obx-btn obx-btn-sm" onClick={async () => {
                        const res = await openActionModal({
                          title:        'Mark as Filed',
                          icon:         'fa-stamp',
                          tone:         'success',
                          record:       remittanceRecord(r),
                          confirmLabel: 'Mark Filed',
                          whatNext:     ['Records the authority filing date and reference.'],
                        });
                        if (!res.confirmed) return;
                        await run(markFiledMut.mutateAsync({ id: r.id }), 'Marked as filed.');
                      }}>Mark Filed</button>
                    )}
                    {r.paidDate && <span class="obx-meta" style={{ marginLeft: 4 }}>Paid {fmtDate(r.paidDate)}</span>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
    </div></div>
  );
}

function MarkPaidButton({ remittance, markPaidMut }: {
  remittance: Remittance;
  markPaidMut: ReturnType<typeof useRemittanceMutation<{ id: string; paidDate?: string; authorityReference?: string }, Remittance>>;
}): VNode {
  const [open, setOpen] = useState(false);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState('');

  const submit = async (): Promise<void> => {
    try {
      await markPaidMut.mutateAsync({ id: remittance.id, paidDate, authorityReference: ref || undefined });
      dialog.success('Marked as paid.');
      setOpen(false);
    } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed.'); }
  };

  const ctxPaid: DialogContextPanelConfig = {
    eyebrow: 'Finance · Remittances', title: 'Payment Details', description: 'Record the payment date and authority reference.',
    preview: {
      icon: 'PAY', title: remittance.remittanceNo,
      subtitle: authorityLabel(remittance.authority),
      badges: [{ label: 'Marking Paid', tone: 'success' }],
    },
    metrics: [
      { label: 'Total due', value: fmtMoney(remittance.totalDue), tone: 'info' },
      { label: 'Paid date', value: paidDate || '—', tone: 'default' },
    ],
    validation: [
      ...(!paidDate ? [{ message: 'Payment date is required.', tone: 'danger' as const }] : []),
    ],
    whatNext: [{ label: 'Status → Paid', description: 'Ready for filing once paid.' }],
  };

  return (
    <>
      <button class="obx-btn obx-btn-sm" onClick={() => setOpen(true)}>Mark Paid</button>
      {open && (
        <EnterpriseFormModal open
          title="Mark Remittance Paid"
          subtitle="Record the payment date and authority receipt reference."
          icon={<i class="fas fa-money-bill-transfer" />}
          context={ctxPaid}
          primaryLabel="Mark Paid"
          loading={markPaidMut.isPending}
          disabled={!paidDate}
          onCancel={() => setOpen(false)}
          onSubmit={() => void submit()}>
          <div class="fin-form-grid fin-form-grid--tight">
            <label class="fin-field"><span>Payment date</span>
              <input type="date" value={paidDate} onInput={e => setPaidDate((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <label class="fin-field"><span>Authority reference (receipt #)</span>
              <input type="text" placeholder="e.g. BIR-2026-00123" value={ref} onInput={e => setRef((e.currentTarget as HTMLInputElement).value)} />
            </label>
          </div>
        </EnterpriseFormModal>
      )}
    </>
  );
}

// ── Compute & Create ────────────────────────────────────────────────────────────

function CreateSurface({ canManage }: { canManage: boolean }): VNode {
  const [runId, setRunId]       = useState('');
  const [authority, setAuthority] = useState<RemittanceAuthority>('paye_bir');
  const [dueDate, setDueDate]   = useState('');
  const [showForm, setShowForm] = useState(false);

  const computeQ = useComputedRemittance(
    showForm && runId.length === 36 ? runId : null,
    showForm && runId.length === 36 ? authority : null,
  );
  const computed = computeQ.data;

  const createMut = useRemittanceMutation(financeRemittancesApi.create);

  const create = async (): Promise<void> => {
    if (!runId.trim() || !authority) { dialog.error('Payroll run ID and authority are required.'); return; }
    try {
      await createMut.mutateAsync({ payrollRunId: runId.trim(), authority, dueDate: dueDate || null });
      dialog.success('Remittance created as draft.');
      setShowForm(false); setRunId(''); setDueDate('');
    } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to create remittance.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'Finance · Remittances', title: 'Computed Totals', description: 'Preview computed amounts before creating.',
    preview: {
      icon: 'REM', title: `${authorityLabel(authority)} Remittance`,
      subtitle: computed ? `${computed.periodYear}-${String(computed.periodMonth).padStart(2, '0')}` : 'Enter run ID',
      badges: [{ label: 'Draft', tone: 'muted' }],
    },
    metrics: computed ? [
      { label: 'Employee portion', value: fmtMoney(computed.employeePortion), tone: 'info' },
      { label: 'Employer portion', value: fmtMoney(computed.employerPortion), tone: 'default' },
      { label: 'Total due',        value: fmtMoney(computed.totalDue),        tone: 'success' },
      { label: 'Employees',        value: String(computed.lineCount),          tone: 'default' },
    ] : [],
    validation: [
      ...(!runId.trim() ? [{ message: 'Payroll run ID is required.', tone: 'danger' as const }] : []),
      ...(computeQ.error ? [{ message: (computeQ.error as Error).message, tone: 'danger' as const }] : []),
    ],
    approval: { required: true, risk: 'medium', message: 'Created as draft → submit → a different finance_manager approves (SoD).' },
    whatNext: [
      { label: 'Maker-checker', description: 'Submit for approval; a different finance_manager approves.' },
      { label: 'Mark paid', description: 'Once approved, record the payment date and authority reference.' },
    ],
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {!canManage ? (
        <EmptyState icon="fa-lock" title="Permission required" text="You need finance.remittances.manage to create remittances." />
      ) : (
        <>
          <div class="obx-toolbar" style={{ marginBottom: 10 }}>
            <button class="obx-btn" onClick={() => setShowForm(v => !v)}>
              <i class={`fas ${showForm ? 'fa-xmark' : 'fa-plus'}`} />
              {showForm ? ' Cancel' : ' Compute & Create remittance'}
            </button>
          </div>

          {showForm && (
            <EnterpriseFormModal open
              title="Compute Remittance from Payroll Run"
              subtitle="Derive PAYE, NIS, or Health Surcharge totals from a locked/approved payroll run."
              icon={<i class="fas fa-calculator" />}
              context={context}
              primaryLabel="Create draft"
              loading={createMut.isPending}
              disabled={!runId.trim()}
              onCancel={() => setShowForm(false)}
              onSubmit={() => void create()}>
              <div class="fin-form-grid">
                <label class="fin-field"><span>Payroll run ID (UUID)</span>
                  <input type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={runId}
                    onInput={e => setRunId((e.currentTarget as HTMLInputElement).value.trim())}
                  />
                </label>
                <label class="fin-field"><span>Authority</span>
                  <select value={authority} onChange={e => setAuthority((e.currentTarget as HTMLSelectElement).value as RemittanceAuthority)}>
                    {AUTHORITIES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </label>
                <label class="fin-field"><span>Due date (optional)</span>
                  <input type="date" value={dueDate} onInput={e => setDueDate((e.currentTarget as HTMLInputElement).value)} />
                </label>
              </div>
              {computeQ.isLoading && runId.length === 36 && <div class="obx-meta" style={{ marginTop: 8 }}>Computing…</div>}
            </EnterpriseFormModal>
          )}
        </>
      )}
    </div></div>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────────

function ReportsSurface(): VNode {
  const reportQ = useRemittanceMutation(financeRemittancesApi.listReport);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof financeRemittancesApi.listReport>> | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async (): Promise<void> => {
    try { const r = await financeRemittancesApi.listReport({}); setRows(r); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to load report.'); }
    finally { setLoaded(true); }
  };
  if (!loaded) void load();

  const cols: Array<[string, string]> = [
    ['remittanceNo', 'Ref'], ['periodYear', 'Year'], ['periodMonth', 'Month'],
    ['authority', 'Authority'], ['status', 'Status'], ['totalDue', 'Total Due'],
    ['paidDate', 'Paid'], ['filedDate', 'Filed'], ['authorityReference', 'Ref #'],
  ];

  return (
    <div class="obx-section"><div class="obx-section-body">
      {!rows ? <div class="obx-empty">Loading…</div>
        : !rows.length ? <EmptyState icon="fa-chart-bar" title="No remittance history" text="Remittance records will appear here once created." />
        : (
          <table class="obx-table">
            <thead><tr>{cols.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>{cols.map(([key, label]) => {
                const v = r[key as keyof typeof r];
                if (key === 'status') return <td key={label}><span class={`obx-pill ${statusTone(String(v))}`}>{humanize(String(v))}</span></td>;
                if (key === 'authority') return <td key={label} class="obx-meta">{authorityLabel(String(v))}</td>;
                if (key === 'totalDue')  return <td key={label}><b>{fmtMoney(Number(v))}</b></td>;
                return <td key={label} class="obx-meta">{v == null || v === '' ? '—' : String(v)}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        )}
    </div></div>
  );
}
