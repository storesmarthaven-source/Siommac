/**
 * src/components/sections/Finance/ExpensesOverview.tsx
 *
 * Finance -- Expense Claims (nav id `s-finance-expenses`).
 * Surfaces: Claims register - Create new claim - Reports.
 *
 * Lifecycle: draft -> submitted -> approved -> reimbursed (also rejectable/cancellable).
 * SoD: claimant != approver (enforced server-side).
 * Allocation lines must sum to the claim total (enforced server-side).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import {
  useExpenseClaims,
  useExpenseMutation,
  financeExpensesApi,
  type ExpenseClaim,
  type ExpenseCategory,
  type AllocationLine,
} from '@api/finance/expenses';
import { fmtMoney, fmtDate, humanize, statusTone } from './financeShared';
import { openActionModal, cancelAction, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import './finance.css';

type Surface = 'register' | 'create' | 'reports';

const SURFACES: { id: Surface; label: string }[] = [
  { id: 'register', label: 'Claims' },
  { id: 'create',   label: 'New Claim' },
  { id: 'reports',  label: 'Reports' },
];

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'travel',            label: 'Travel' },
  { value: 'accommodation',     label: 'Accommodation' },
  { value: 'meals',             label: 'Meals' },
  { value: 'equipment',         label: 'Equipment' },
  { value: 'supplies',          label: 'Supplies' },
  { value: 'professional_fees', label: 'Professional Fees' },
  { value: 'utilities',         label: 'Utilities' },
  { value: 'other',             label: 'Other' },
];

function categoryLabel(c: string): string {
  return CATEGORIES.find(x => x.value === c)?.label ?? humanize(c);
}

function claimRecord(r: ExpenseClaim) {
  return toActionRecord({
    title:    r.claimNo,
    subtitle: `${categoryLabel(r.category)} -- ${r.title}`,
    icon:     'fa-receipt',
    badges:   [statusBadge(r.status)],
    fields: [
      { label: 'Total', value: fmtMoney(r.totalAmount) },
      { label: 'Date',  value: fmtDate(r.expenseDate) },
    ],
  });
}

export function ExpensesOverview(): VNode {
  const [surface, setSurface] = useState<Surface>('register');

  const claimsQ = useExpenseClaims();
  const claims = claimsQ.data ?? [];

  const total          = claims.length;
  const pendingApproval = claims.filter(r => r.status === 'submitted').length;
  const approved       = claims.filter(r => r.status === 'approved').length;
  const pendingAmount  = claims
    .filter(r => ['submitted', 'approved'].includes(r.status))
    .reduce((s, r) => s + r.totalAmount, 0);

  const canManage  = can('finance.expenses.manage');
  const canApprove = can('finance.expenses.approve');

  const STAT_ROW = [
    { label: 'Total claims',      val: total },
    { label: 'Pending approval',  val: pendingApproval },
    { label: 'Approved',          val: approved },
    { label: 'Pending amount',    val: fmtMoney(pendingAmount) },
  ];

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader
        icon="fa-receipt"
        module="Finance -- Expenses"
        title="Expense Claims"
        sub="Employee expense claims with cost-centre allocation, approval workflow, and reimbursement tracking."
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
          claims={claims}
          loading={claimsQ.isLoading}
          canManage={canManage}
          canApprove={canApprove}
        />
      )}
      {surface === 'create'  && <CreateSurface canManage={canManage} />}
      {surface === 'reports' && <ReportsSurface />}
    </div>
  );
}

// -- Register -----------------------------------------------------------------

function RegisterSurface({ claims, loading, canManage, canApprove }: {
  claims: ExpenseClaim[];
  loading: boolean;
  canManage: boolean;
  canApprove: boolean;
}): VNode {
  const submitMut        = useExpenseMutation(financeExpensesApi.submit);
  const approveMut       = useExpenseMutation(financeExpensesApi.approve);
  const rejectMut        = useExpenseMutation(financeExpensesApi.reject);
  const markReimbMut     = useExpenseMutation(financeExpensesApi.markReimbursed);
  const cancelMut        = useExpenseMutation(financeExpensesApi.cancel);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; dialog.success(ok); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {loading ? <div class="obx-empty">Loading...</div>
        : !claims.length ? (
          <EmptyState
            icon="fa-receipt"
            title="No expense claims yet"
            text="Use New Claim to submit an expense claim for approval."
          />
        ) : (
          <table class="obx-table">
            <thead><tr>
              <th>Ref</th><th>Title</th><th>Category</th><th>Date</th>
              <th>Total</th><th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr></thead>
            <tbody>{claims.map(r => (
              <tr key={r.id}>
                <td><b>{r.claimNo}</b></td>
                <td>{r.title}</td>
                <td class="obx-meta">{categoryLabel(r.category)}</td>
                <td class="obx-meta">{fmtDate(r.expenseDate)}</td>
                <td><b>{fmtMoney(r.totalAmount)}</b></td>
                <td><span class={`obx-pill ${statusTone(r.status)}`}>{humanize(r.status)}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <div class="obx-rowbtns" style={{ justifyContent: 'flex-end' }}>
                    {canManage && r.status === 'draft' && (
                      <>
                        <button class="obx-btn obx-btn-sm" onClick={() => run(submitMut.mutateAsync({ id: r.id }), 'Submitted for approval.')}>Submit</button>
                        <button class="obx-btn obx-btn-sm" onClick={async () => {
                          const res = await openActionModal(cancelAction({
                            noun: 'expense claim',
                            record: claimRecord(r),
                            whatNext: ['The claim is cancelled and no longer tracked.'],
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
                          const res = await openActionModal({
                            title:        'Reject Expense Claim',
                            icon:         'fa-xmark-circle',
                            tone:         'danger',
                            record:       claimRecord(r),
                            confirmLabel: 'Reject',
                            reason: { required: true },
                            whatNext:     ['The claimant is notified. They may revise and resubmit.'],
                          });
                          if (!res.confirmed) return;
                          await run(rejectMut.mutateAsync({ id: r.id, reason: res.reason || 'Rejected.' }), 'Rejected.');
                        }}>Reject</button>
                      </>
                    )}
                    {canApprove && r.status === 'approved' && (
                      <button class="obx-btn obx-btn-sm" onClick={async () => {
                        const res = await openActionModal({
                          title:        'Mark Reimbursed',
                          icon:         'fa-money-bill-transfer',
                          tone:         'success',
                          record:       claimRecord(r),
                          confirmLabel: 'Mark Reimbursed',
                          whatNext:     ['Records the reimbursement. Cost entries are closed.'],
                        });
                        if (!res.confirmed) return;
                        await run(markReimbMut.mutateAsync({ id: r.id }), 'Marked as reimbursed.');
                      }}>Mark Reimbursed</button>
                    )}
                    {r.reimbursedAt && <span class="obx-meta" style={{ marginLeft: 4 }}>Reimbursed {fmtDate(r.reimbursedAt)}</span>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
    </div></div>
  );
}

// -- Create -------------------------------------------------------------------

function CreateSurface({ canManage }: { canManage: boolean }): VNode {
  const [showForm, setShowForm]   = useState(false);
  const [title, setTitle]         = useState('');
  const [expenseDate, setDate]    = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory]   = useState<ExpenseCategory>('travel');
  const [totalAmount, setTotal]   = useState('');
  const [reimbursable, setReimb]  = useState(true);
  const [lines, setLines]         = useState<Array<{ costCenterId: string; amount: string; description: string }>>([
    { costCenterId: '', amount: '', description: '' },
  ]);

  const createMut = useExpenseMutation(financeExpensesApi.create);

  const lineSum  = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const total    = parseFloat(totalAmount) || 0;
  const sumOk    = Math.abs(lineSum - total) <= 0.01;
  const formOk   = title.trim() && total > 0 && lines.every(l => l.costCenterId && parseFloat(l.amount) > 0) && sumOk;

  const addLine    = (): void => setLines(ls => [...ls, { costCenterId: '', amount: '', description: '' }]);
  const removeLine = (i: number): void => setLines(ls => ls.filter((_, j) => j !== i));
  const updateLine = (i: number, k: keyof typeof lines[0], v: string): void =>
    setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));

  const reset = (): void => {
    setTitle(''); setDate(new Date().toISOString().slice(0, 10));
    setCategory('travel'); setTotal(''); setReimb(true);
    setLines([{ costCenterId: '', amount: '', description: '' }]);
    setShowForm(false);
  };

  const create = async (): Promise<void> => {
    if (!formOk) { dialog.error('Please fill all required fields. Allocation lines must sum to the total.'); return; }
    try {
      await createMut.mutateAsync({
        claimantId:      'self',   // server resolves actorId; UI uses actor.id server-side
        title:           title.trim(),
        expenseDate,
        category,
        totalAmount:     total,
        reimbursable,
        allocationLines: lines.map(l => ({
          costCenterId: l.costCenterId,
          amount:       parseFloat(l.amount),
          description:  l.description || undefined,
        })),
      });
      dialog.success('Expense claim created as draft.');
      reset();
    } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to create expense claim.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'Finance -- Expenses', title: 'Claim Summary', description: 'Review before submitting.',
    preview: {
      icon: 'EXP', title: title || 'New Expense Claim',
      subtitle: categoryLabel(category),
      badges: [{ label: 'Draft', tone: 'muted' }],
    },
    metrics: [
      { label: 'Total amount', value: total ? fmtMoney(total) : '--', tone: 'info' },
      { label: 'Line sum',     value: lineSum ? fmtMoney(lineSum) : '--', tone: sumOk ? 'success' : 'danger' },
      { label: 'Lines',        value: String(lines.length), tone: 'default' },
    ],
    validation: [
      ...(!title.trim()    ? [{ message: 'Title is required.', tone: 'danger' as const }] : []),
      ...(!(total > 0)     ? [{ message: 'Total amount must be positive.', tone: 'danger' as const }] : []),
      ...(!sumOk && total > 0 ? [{ message: `Lines sum ${fmtMoney(lineSum)} does not equal total ${fmtMoney(total)}.`, tone: 'danger' as const }] : []),
    ],
    approval: { required: true, risk: 'low', message: 'Created as draft -- submit for approval; a different finance_manager approves (SoD).' },
    whatNext: [
      { label: 'Submit', description: 'Submit the draft for manager approval.' },
      { label: 'Approve', description: 'A different approver reviews and approves.' },
      { label: 'Reimburse', description: 'Finance marks as reimbursed once payment is made.' },
    ],
  };

  return (
    <div class="obx-section"><div class="obx-section-body">
      {!canManage ? (
        <EmptyState icon="fa-lock" title="Permission required" text="You need finance.expenses.manage to create expense claims." />
      ) : (
        <>
          <div class="obx-toolbar" style={{ marginBottom: 10 }}>
            <button class="obx-btn" onClick={() => setShowForm(v => !v)}>
              <i class={`fas ${showForm ? 'fa-xmark' : 'fa-plus'}`} />
              {showForm ? ' Cancel' : ' New Expense Claim'}
            </button>
          </div>

          {showForm && (
            <EnterpriseFormModal open
              title="New Expense Claim"
              subtitle="Submit an expense for cost-centre allocation and manager approval."
              icon={<i class="fas fa-receipt" />}
              context={context}
              primaryLabel="Create draft"
              loading={createMut.isPending}
              disabled={!formOk}
              onCancel={reset}
              onSubmit={() => void create()}>
              <div class="fin-form-grid">
                <label class="fin-field fin-field--span2"><span>Title</span>
                  <input type="text" placeholder="e.g. Travel to Port of Spain office" value={title}
                    onInput={e => setTitle((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label class="fin-field"><span>Expense date</span>
                  <input type="date" value={expenseDate} onInput={e => setDate((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label class="fin-field"><span>Category</span>
                  <select value={category} onChange={e => setCategory((e.currentTarget as HTMLSelectElement).value as ExpenseCategory)}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
                <label class="fin-field"><span>Total amount (TTD)</span>
                  <input type="number" min="0.01" step="0.01" placeholder="0.00" value={totalAmount}
                    onInput={e => setTotal((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label class="fin-field fin-field--inline"><span>Reimbursable</span>
                  <input type="checkbox" checked={reimbursable} onChange={e => setReimb((e.currentTarget as HTMLInputElement).checked)} />
                </label>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <b style={{ fontSize: 13 }}>Cost-centre allocation lines</b>
                  <button type="button" class="obx-btn obx-btn-sm" onClick={addLine}>+ Add line</button>
                </div>
                {lines.map((l, i) => (
                  <div key={i} class="fin-form-grid fin-form-grid--tight" style={{ marginBottom: 6 }}>
                    <label class="fin-field"><span>Cost centre (UUID)</span>
                      <input type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={l.costCenterId}
                        onInput={e => updateLine(i, 'costCenterId', (e.currentTarget as HTMLInputElement).value.trim())} />
                    </label>
                    <label class="fin-field"><span>Amount (TTD)</span>
                      <input type="number" min="0.01" step="0.01" placeholder="0.00" value={l.amount}
                        onInput={e => updateLine(i, 'amount', (e.currentTarget as HTMLInputElement).value)} />
                    </label>
                    <label class="fin-field fin-field--span2"><span>Description (optional)</span>
                      <input type="text" placeholder="e.g. Flight ticket" value={l.description}
                        onInput={e => updateLine(i, 'description', (e.currentTarget as HTMLInputElement).value)} />
                    </label>
                    {lines.length > 1 && (
                      <div class="fin-field">
                        <button type="button" class="obx-btn obx-btn-sm" style={{ marginTop: 18 }} onClick={() => removeLine(i)}>Remove</button>
                      </div>
                    )}
                  </div>
                ))}
                {total > 0 && (
                  <div class="obx-meta" style={{ marginTop: 4 }}>
                    Lines sum: <b>{fmtMoney(lineSum)}</b> / Total: <b>{fmtMoney(total)}</b>
                    {!sumOk && <span style={{ color: 'var(--color-danger)', marginLeft: 6 }}>-- must match</span>}
                  </div>
                )}
              </div>
            </EnterpriseFormModal>
          )}
        </>
      )}
    </div></div>
  );
}

// -- Reports ------------------------------------------------------------------

function ReportsSurface(): VNode {
  const reportQ  = useExpenseMutation(financeExpensesApi.listReport);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof financeExpensesApi.listReport>> | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async (): Promise<void> => {
    try { const r = await financeExpensesApi.listReport({}); setRows(r); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to load report.'); }
    finally { setLoaded(true); }
  };
  if (!loaded) void load();

  const cols: Array<[string, string]> = [
    ['claimNo', 'Ref'], ['title', 'Title'], ['category', 'Category'],
    ['expenseDate', 'Date'], ['totalAmount', 'Total'], ['status', 'Status'],
    ['reimbursable', 'Reimbursable'], ['reimbursedAt', 'Reimbursed'],
  ];

  return (
    <div class="obx-section"><div class="obx-section-body">
      {!rows ? <div class="obx-empty">Loading...</div>
        : !rows.length ? <EmptyState icon="fa-chart-bar" title="No expense history" text="Expense claim records will appear here once created." />
        : (
          <table class="obx-table">
            <thead><tr>{cols.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>{cols.map(([key, label]) => {
                const v = r[key as keyof typeof r];
                if (key === 'status')       return <td key={label}><span class={`obx-pill ${statusTone(String(v))}`}>{humanize(String(v))}</span></td>;
                if (key === 'category')     return <td key={label} class="obx-meta">{categoryLabel(String(v))}</td>;
                if (key === 'totalAmount')  return <td key={label}><b>{fmtMoney(Number(v))}</b></td>;
                if (key === 'reimbursable') return <td key={label} class="obx-meta">{v ? 'Yes' : 'No'}</td>;
                return <td key={label} class="obx-meta">{v == null || v === '' ? '--' : String(v)}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        )}
    </div></div>
  );
}
