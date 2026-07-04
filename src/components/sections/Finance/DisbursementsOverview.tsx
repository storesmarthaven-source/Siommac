/**
 * src/components/sections/Finance/DisbursementsOverview.tsx
 *
 * Finance -- Payroll Bank Disbursements (F2).
 * Surfaces: Register (lifecycle table), Compute & Create, Bank Accounts, Reports.
 */
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import {
  useDisbursements, useComputedDisbursement, useDisbursementMutation,
  financeDisbursementsApi, type Disbursement,
} from '@api/finance/disbursements';
import { useBankAccountMutation, financeBankAccountsApi } from '@api/finance/bankAccounts';
import { fmtMoney, fmtDate, humanize, statusTone } from './financeShared';
import { openActionModal, cancelAction, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import './finance.css';

type Surface = 'register' | 'create' | 'bank-accounts' | 'reports';

const SURFACES: { id: Surface; label: string }[] = [
  { id: 'register',      label: 'Disbursements' },
  { id: 'create',        label: 'Compute & Create' },
  { id: 'bank-accounts', label: 'Bank Accounts' },
  { id: 'reports',       label: 'Reports' },
];

function disbursementRecord(d: Disbursement) {
  return toActionRecord({
    title:    d.disbursementNo,
    subtitle: `${d.employeeCount} employees � ${d.currency}`,
    icon:     'fa-building-columns',
    badges:   [statusBadge(d.status)],
    fields:   [{ label: 'Total', value: fmtMoney(d.totalAmount) }],
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export function DisbursementsOverview(): VNode {
  const [surface, setSurface] = useState<Surface>('register');
  const disbursementsQ = useDisbursements();
  const disbursements  = disbursementsQ.data ?? [];

  const total    = disbursements.length;
  const pending  = disbursements.filter(d => d.status === 'submitted').length;
  const approved = disbursements.filter(d => d.status === 'approved').length;
  const totalAmt = disbursements
    .filter(d => !['cancelled'].includes(d.status))
    .reduce((s, d) => s + d.totalAmount, 0);

  const canManage   = can('finance.disbursement.manage');
  const canApprove  = can('finance.disbursement.approve');
  const canBankMgmt = can('finance.bank_accounts.manage');

  const STAT_ROW = [
    { label: 'Total disbursements', val: total },
    { label: 'Pending approval',    val: pending },
    { label: 'Approved / ready',    val: approved },
    { label: 'Total disbursed',     val: fmtMoney(totalAmt) },
  ];

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader icon="fa-building-columns" module="Finance � Disbursements"
        title="Payroll Bank Disbursement"
        sub="Generate EFT bank files and disburse net pay to employees from approved payroll runs." />

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

      {surface === 'register'     && <RegisterSurface disbursements={disbursements} loading={disbursementsQ.isLoading} canManage={canManage} canApprove={canApprove} />}
      {surface === 'create'        && <CreateSurface canManage={canManage} />}
      {surface === 'bank-accounts' && <BankAccountsSurface canManage={canBankMgmt} />}
      {surface === 'reports'       && <ReportsSurface />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RegisterSurface
// ---------------------------------------------------------------------------
function RegisterSurface({ disbursements, loading, canManage, canApprove }: {
  disbursements: Disbursement[];
  loading: boolean;
  canManage: boolean;
  canApprove: boolean;
}): VNode {
  const submitMut   = useDisbursementMutation(financeDisbursementsApi.submit);
  const approveMut  = useDisbursementMutation(financeDisbursementsApi.approve);
  const genFileMut  = useDisbursementMutation(financeDisbursementsApi.generateFile);
  const markPaidMut = useDisbursementMutation(financeDisbursementsApi.markPaid);
  const cancelMut   = useDisbursementMutation(financeDisbursementsApi.cancel);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; dialog.success(ok); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {loading ? <div class="obx-empty">Loading...</div>
        : !disbursements.length ? (
          <EmptyState icon="fa-building-columns" title="No disbursements yet"
            text="Use Compute &amp; Create to derive a disbursement from an approved payroll run." />
        ) : (
          <table class="obx-table">
            <thead><tr>
              <th>Ref</th><th>Employees</th><th>Total</th><th>Currency</th>
              <th>Status</th><th>Created</th><th style={{ textAlign: 'right' }}>Actions</th>
            </tr></thead>
            <tbody>{disbursements.map(d => (
              <tr key={d.id}>
                <td><b>{d.disbursementNo}</b></td>
                <td class="obx-meta">{d.employeeCount}</td>
                <td><b>{fmtMoney(d.totalAmount)}</b></td>
                <td class="obx-meta">{d.currency}</td>
                <td><span class={`obx-pill ${statusTone(d.status)}`}>{humanize(d.status)}</span></td>
                <td class="obx-meta">{fmtDate(d.createdAt)}</td>
                <td style={{ textAlign: 'right' }}>
                  <div class="obx-rowbtns" style={{ justifyContent: 'flex-end' }}>
                    {canManage && d.status === 'draft' && (<>
                      <button class="obx-btn obx-btn-sm"
                        onClick={() => run(submitMut.mutateAsync({ id: d.id }), 'Submitted for approval.')}>
                        Submit
                      </button>
                      <button class="obx-btn obx-btn-sm" onClick={async () => {
                        const res = await openActionModal(cancelAction({
                          noun: 'disbursement',
                          record: disbursementRecord(d),
                          whatNext: ['The disbursement is cancelled.'],
                        }));
                        if (!res.confirmed) return;
                        await run(cancelMut.mutateAsync({ id: d.id, reason: res.reason ?? 'Cancelled.' }), 'Cancelled.');
                      }}>Cancel</button>
                    </>)}
                    {canApprove && d.status === 'submitted' && (<>
                      <button class="obx-btn obx-btn-sm"
                        onClick={() => run(approveMut.mutateAsync({ id: d.id }), 'Approved.')}>
                        Approve
                      </button>
                      <button class="obx-btn obx-btn-sm" onClick={async () => {
                        const res = await openActionModal(cancelAction({
                          noun: 'disbursement',
                          title: 'Return disbursement',
                          record: disbursementRecord(d),
                          whatNext: ['The disbursement is returned to draft for correction.'],
                        }));
                        if (!res.confirmed) return;
                        await run(cancelMut.mutateAsync({ id: d.id, reason: res.reason ?? 'Returned.' }), 'Returned to draft.');
                      }}>Return</button>
                    </>)}
                    {canApprove && d.status === 'approved' && (
                      <button class="obx-btn obx-btn-sm"
                        onClick={() => run(genFileMut.mutateAsync({ id: d.id }), 'Bank file generated.')}>
                        Generate File
                      </button>
                    )}
                    {canApprove && d.status === 'file_generated' && (
                      <button class="obx-btn obx-btn-sm" onClick={async () => {
                        const res = await openActionModal({
                          title: 'Mark as Paid',
                          icon:  'fa-circle-check',
                          tone:  'success',
                          record: disbursementRecord(d),
                          confirmLabel: 'Mark Paid',
                          whatNext: ['Confirms that the bank file has been processed and employees paid.'],
                        });
                        if (!res.confirmed) return;
                        await run(markPaidMut.mutateAsync({ id: d.id }), 'Marked as paid.');
                      }}>Mark Paid</button>
                    )}
                    {d.bankFilePath && (
                      <span class="obx-meta" style={{ marginLeft: 4 }}>
                        <i class="fas fa-file-csv" /> File ready
                      </span>
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

// ---------------------------------------------------------------------------
// CreateSurface
// ---------------------------------------------------------------------------
function CreateSurface({ canManage }: { canManage: boolean }): VNode {
  const [runId, setRunId]       = useState('');
  const [showForm, setShowForm] = useState(false);

  const computeQ = useComputedDisbursement(showForm && runId.length === 36 ? runId : null);
  const computed = computeQ.data;
  const createMut = useDisbursementMutation(financeDisbursementsApi.create);

  const create = async (): Promise<void> => {
    if (!runId.trim()) { dialog.error('Payroll run ID is required.'); return; }
    try {
      await createMut.mutateAsync({ payrollRunId: runId.trim() });
      dialog.success('Disbursement created as draft.');
      setShowForm(false);
      setRunId('');
    } catch (e) {
      dialog.error(e instanceof Error ? e.message : 'Failed to create disbursement.');
    }
  };

  const missingCount = computed?.missingBankAccounts.length ?? 0;

  const context: DialogContextPanelConfig = {
    eyebrow:     'Finance - Disbursements',
    title:       'Computed Net Pay',
    description: 'Preview net pay totals before creating disbursement.',
    preview: {
      icon:     'DSB',
      title:    'Payroll Disbursement',
      subtitle: computed ? `${computed.employeeCount} employees` : 'Enter run ID',
      badges:   [{ label: 'Draft', tone: 'muted' }],
    },
    metrics: computed
      ? [
          { label: 'Total net pay',   value: fmtMoney(computed.totalAmount), tone: 'success' },
          { label: 'Employees',        value: String(computed.employeeCount), tone: 'default' },
          { label: 'No bank account',  value: String(missingCount), tone: missingCount > 0 ? 'danger' : 'default' },
        ]
      : [],
    validation: [
      ...(!runId.trim() ? [{ message: 'Payroll run ID is required.', tone: 'danger' as const }] : []),
      ...(missingCount > 0 ? [{ message: `${missingCount} employee(s) have no primary bank account.`, tone: 'danger' as const }] : []),
      ...(computeQ.error ? [{ message: (computeQ.error as Error).message, tone: 'danger' as const }] : []),
    ],
    approval: {
      required: true,
      risk:     'high',
      message:  'Created as draft, submit, a different finance_manager approves (SoD), generate bank file, mark paid.',
    },
    whatNext: [
      { label: 'Maker-checker',    description: 'Submit for approval; a different finance_manager approves.' },
      { label: 'Generate bank file', description: 'Once approved, generate the CSV EFT file.' },
      { label: 'Mark paid',        description: 'Confirm bank file was processed.' },
    ],
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {!canManage ? (
        <EmptyState icon="fa-lock" title="Permission required"
          text="You need finance.disbursement.manage to create disbursements." />
      ) : (
        <>
          <div class="obx-toolbar" style={{ marginBottom: 10 }}>
            <button class="obx-btn" onClick={() => setShowForm(v => !v)}>
              <i class={`fas ${showForm ? 'fa-xmark' : 'fa-plus'}`} />
              {showForm ? ' Cancel' : ' Compute & Create disbursement'}
            </button>
          </div>

          {showForm && (
            <EnterpriseFormModal open
              title="Compute Disbursement from Payroll Run"
              subtitle="Derives net pay per employee from payslips for a locked/approved run."
              icon={<i class="fas fa-building-columns" />}
              context={context}
              primaryLabel="Create draft"
              loading={createMut.isPending}
              disabled={!runId.trim() || missingCount > 0}
              onCancel={() => setShowForm(false)}
              onSubmit={() => void create()}>

              <div class="fin-form-grid">
                <label class="fin-field"><span>Payroll run ID (UUID)</span>
                  <input type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={runId}
                    onInput={e => setRunId((e.currentTarget as HTMLInputElement).value.trim())} />
                </label>
              </div>

              {computeQ.isLoading && runId.length === 36 && (
                <div class="obx-meta" style={{ marginTop: 8 }}>Computing...</div>
              )}

              {computed && missingCount > 0 && (
                <div class="fin-alert fin-alert--warn" style={{ marginTop: 8 }}>
                  <i class="fas fa-triangle-exclamation" />
                  {' '}{missingCount} employee(s) have no primary bank account.
                  Add bank accounts in the Bank Accounts tab first.
                </div>
              )}
            </EnterpriseFormModal>
          )}
        </>
      )}
    </div></div>
  );
}

// ---------------------------------------------------------------------------
// BankAccountsSurface
// ---------------------------------------------------------------------------
function BankAccountsSurface({ canManage }: { canManage: boolean }): VNode {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId]   = useState<string | null>(null);
  const [form, setForm] = useState({
    employeeId:    '',
    bankName:      '',
    branch:        '',
    accountType:   'savings' as 'savings' | 'chequing',
    accountNumber: '',
    isPrimary:     true,
  });

  const upsertMut     = useBankAccountMutation(financeBankAccountsApi.upsert);
  const deactivateMut = useBankAccountMutation(financeBankAccountsApi.deactivate);
  void deactivateMut; // reserved for row-level deactivate

  const resetForm = () => {
    setForm({ employeeId: '', bankName: '', branch: '', accountType: 'savings', accountNumber: '', isPrimary: true });
    setEditId(null);
    setShowAdd(false);
  };

  const save = async (): Promise<void> => {
    if (!form.bankName.trim() || !form.accountNumber.trim()) {
      dialog.error('Bank name and account number are required.');
      return;
    }
    try {
      await upsertMut.mutateAsync({
        id:            editId ?? undefined,
        employeeId:    form.employeeId || undefined,
        bankName:      form.bankName,
        branch:        form.branch || null,
        accountType:   form.accountType,
        accountNumber: form.accountNumber,
        isPrimary:     form.isPrimary,
      });
      dialog.success(editId ? 'Bank account updated.' : 'Bank account added.');
      resetForm();
    } catch (e) {
      dialog.error(e instanceof Error ? e.message : 'Failed.');
    }
  };

  const ctx: DialogContextPanelConfig = {
    eyebrow:     'Finance - Bank Accounts',
    title:       'Account Details',
    description: 'The account number is masked before storage -- only the last 4 digits are displayed.',
    preview: {
      icon:     'BANK',
      title:    form.bankName || 'New Bank Account',
      subtitle: form.accountType === 'savings' ? 'Savings Account' : 'Chequing Account',
      badges:   [{ label: form.isPrimary ? 'Primary' : 'Secondary', tone: form.isPrimary ? 'success' : 'muted' }],
    },
    metrics: form.accountNumber
      ? [{ label: 'Masked number', value: '****' + form.accountNumber.replace(/\s/g, '').slice(-4), tone: 'default' }]
      : [],
    validation: [
      ...(!form.bankName.trim()      ? [{ message: 'Bank name is required.',      tone: 'danger' as const }] : []),
      ...(!form.accountNumber.trim() ? [{ message: 'Account number is required.', tone: 'danger' as const }] : []),
      ...(form.accountNumber.replace(/\s/g, '').length < 4
        ? [{ message: 'Account number must be at least 4 digits.', tone: 'danger' as const }]
        : []),
    ],
    whatNext: [
      { label: 'Masked storage', description: 'Only the last 4 digits will be visible in the system.' },
    ],
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {canManage && (
        <div class="obx-toolbar" style={{ marginBottom: 10 }}>
          <button class="obx-btn" onClick={() => { resetForm(); setShowAdd(true); }}>
            <i class="fas fa-plus" /> Add bank account
          </button>
        </div>
      )}

      {(showAdd || editId) && (
        <EnterpriseFormModal open
          title={editId ? 'Edit Bank Account' : 'Add Bank Account'}
          subtitle="Account number is masked -- only the last 4 digits are stored visibly."
          icon={<i class="fas fa-building-columns" />}
          context={ctx}
          primaryLabel={editId ? 'Save changes' : 'Add account'}
          loading={upsertMut.isPending}
          disabled={!form.bankName.trim() || form.accountNumber.replace(/\s/g, '').length < 4}
          onCancel={resetForm}
          onSubmit={() => void save()}>

          <div class="fin-form-grid">
            <label class="fin-field"><span>Employee ID (leave blank for self)</span>
              <input type="text"
                placeholder="Optional -- defaults to your account"
                value={form.employeeId}
                onInput={e => setForm(f => ({ ...f, employeeId: (e.currentTarget as HTMLInputElement).value }))} />
            </label>
            <label class="fin-field"><span>Bank name</span>
              <input type="text" placeholder="e.g. Republic Bank" value={form.bankName}
                onInput={e => setForm(f => ({ ...f, bankName: (e.currentTarget as HTMLInputElement).value }))} />
            </label>
            <label class="fin-field"><span>Branch (optional)</span>
              <input type="text" placeholder="e.g. Port of Spain" value={form.branch}
                onInput={e => setForm(f => ({ ...f, branch: (e.currentTarget as HTMLInputElement).value }))} />
            </label>
            <label class="fin-field"><span>Account type</span>
              <select value={form.accountType}
                onChange={e => setForm(f => ({
                  ...f,
                  accountType: (e.currentTarget as HTMLSelectElement).value as 'savings' | 'chequing',
                }))}>
                <option value="savings">Savings</option>
                <option value="chequing">Chequing</option>
              </select>
            </label>
            <label class="fin-field"><span>Account number</span>
              <input type="text" placeholder="Full account number" value={form.accountNumber}
                onInput={e => setForm(f => ({ ...f, accountNumber: (e.currentTarget as HTMLInputElement).value }))} />
            </label>
            <label class="fin-field fin-field--checkbox">
              <input type="checkbox" checked={form.isPrimary}
                onChange={e => setForm(f => ({ ...f, isPrimary: (e.currentTarget as HTMLInputElement).checked }))} />
              <span>Set as primary account</span>
            </label>
          </div>
        </EnterpriseFormModal>
      )}

      <EmptyState icon="fa-building-columns" title="Bank account management"
        text="Employees can add their bank accounts here. Finance can view masked account details for disbursement." />
    </div></div>
  );
}

// ---------------------------------------------------------------------------
// ReportsSurface
// ---------------------------------------------------------------------------
function ReportsSurface(): VNode {
  const [rows, setRows]     = useState<Awaited<ReturnType<typeof financeDisbursementsApi.listReport>> | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async (): Promise<void> => {
    try { setRows(await financeDisbursementsApi.listReport({})); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to load report.'); }
    finally { setLoaded(true); }
  };
  if (!loaded) void load();

  const colDefs: Array<{ key: string; label: string }> = [
    { key: 'disbursementNo', label: 'Ref' },
    { key: 'employeeCount',  label: 'Employees' },
    { key: 'totalAmount',    label: 'Total' },
    { key: 'currency',       label: 'Currency' },
    { key: 'status',         label: 'Status' },
    { key: 'createdAt',      label: 'Created' },
  ];

  return (
    <div class="obx-section"><div class="obx-section-body">
      {!rows ? (
        <div class="obx-empty">Loading...</div>
      ) : !rows.length ? (
        <EmptyState icon="fa-chart-bar" title="No disbursement history"
          text="Disbursement records will appear here once created." />
      ) : (
        <table class="obx-table">
          <thead><tr>
            {colDefs.map(c => <th key={c.key}>{c.label}</th>)}
          </tr></thead>
          <tbody>{(rows as unknown as Record<string, unknown>[]).map((r, i) => (
            <tr key={String(r['id'] ?? i)}>
              {colDefs.map(c => {
                const v = r[c.key];
                if (c.key === 'status') return (
                  <td key={c.key}><span class={`obx-pill ${statusTone(String(v))}`}>{humanize(String(v))}</span></td>
                );
                if (c.key === 'totalAmount') return <td key={c.key}><b>{fmtMoney(Number(v))}</b></td>;
                if (c.key === 'createdAt')   return <td key={c.key} class="obx-meta">{fmtDate(String(v))}</td>;
                return <td key={c.key} class="obx-meta">{v == null || v === '' ? '--' : String(v)}</td>;
              })}
            </tr>
          ))}</tbody>
        </table>
      )}
    </div></div>
  );
}
